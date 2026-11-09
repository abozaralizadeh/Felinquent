//! Native questions (macOS and Windows), shared by the updater (update.rs) and the model setup
//! (ollama.rs).
//!
//! Windows: a task dialog (the Windows question box with real button names), shown on the
//! asking thread, on top of the cat's windows. The rest of this note is about the Mac.
//!
//! An alert runs as a modal session that is looked at every 50 ms, so between looks the app goes
//! on as normal and the cat doesn't freeze while the question waits. A look never runs in the
//! middle of a click (see `poll`), or the click would be lost. The app comes to the front
//! for it, above the cat's windows so the cat can't sit on a button, and hands the focus back when
//! it closes. Return doesn't press the first button, so a key meant for another app can't start
//! anything; Escape presses the button the caller names. Only one question shows at a time: a
//! second one waits until the first is answered.

#[cfg(target_os = "macos")]
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::time::Duration;

use tauri::AppHandle;

static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// Shows a native question and returns which button was clicked (0 is the first, usize::MAX if it
/// couldn't show). Call it off the main thread. `escape` is the button Escape presses (only
/// when there is more than one button). `press` is for tests: press button n after s seconds,
/// with `performClick:` on the alert's own button, so no input event is made.
pub fn ask(app: &AppHandle, title: &str, text: &str, buttons: &[&str], escape: usize, press: Option<(usize, f64)>) -> usize {
    let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
    #[cfg(windows)]
    {
        let _ = app;
        return win::ask(title, text, buttons, escape, press);
    }
    #[cfg(target_os = "macos")]
    let (tx, rx) = std::sync::mpsc::channel();
    #[cfg(target_os = "macos")]
    {
    let (title, text) = (title.to_string(), text.to_string());
    let buttons: Vec<String> = buttons.iter().map(|b| b.to_string()).collect();
    if app.run_on_main_thread(move || session::open(&title, &text, &buttons, escape, press, tx)).is_err() {
        return usize::MAX;
    }
    loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(index) => return index,
            Err(RecvTimeoutError::Timeout) => {
                if app.run_on_main_thread(session::poll).is_err() {
                    return usize::MAX;
                }
            }
            Err(RecvTimeoutError::Disconnected) => return usize::MAX,
        }
    }
    }
}

/// Reads a test setting like "1" or "1@2.5": press button 1 after 2.5 seconds (3 unless given).
pub fn test_press(spec: &str) -> Option<(usize, f64)> {
    let (n, secs) = spec.split_once('@').map(|(n, s)| (n, s.parse().unwrap_or(3.0))).unwrap_or((spec, 3.0f64));
    n.trim().parse().ok().map(|n| (n, secs))
}

/// Cuts long text on a character and adds "…".
pub fn short(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    format!("{}…", cut.trim_end())
}

/// The open alert. Main thread only.
#[cfg(target_os = "macos")]
mod session {
    use std::cell::RefCell;
    use std::sync::mpsc::Sender;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
    use objc2::{msg_send, sel, MainThreadMarker};
    use objc2_app_kit::{NSAlert, NSApplication, NSButton, NSModalResponseContinue, NSModalSession};
    use objc2_foundation::{NSArray, NSRunLoop, NSString};

    /// acceptsFirstMouse: that says yes.
    extern "C-unwind" fn yes(_this: &AnyObject, _cmd: Sel, _event: *mut AnyObject) -> Bool {
        Bool::YES
    }

    /// A subclass of `base` (made once, at run time) whose buttons take the first click.
    fn first_click_class(base: &'static AnyClass) -> Option<&'static AnyClass> {
        let name = std::ffi::CString::new(format!("Felinquent_{}", base.name().to_string_lossy())).ok()?;
        if let Some(made) = AnyClass::get(&name) {
            return Some(made);
        }
        let mut builder = ClassBuilder::new(&name, base)?;
        // SAFETY: the same signature as NSView's -(BOOL)acceptsFirstMouse:(NSEvent *).
        unsafe { builder.add_method(sel!(acceptsFirstMouse:), yes as extern "C-unwind" fn(_, _, _) -> _) };
        let made = builder.register();
        crate::logfile::write(&format!("alert: buttons take the first click ({})", made.name().to_string_lossy()));
        Some(made)
    }

    /// Makes an alert's button take the first click even when the app isn't in front. The question
    /// floats above every window, so a click on it is meant for it; a plain button spends that
    /// click on bringing the app forward and the user has to click again. The alert's buttons are
    /// a private class, so the subclass is made from whatever class the button really has.
    fn take_first_click(button: &NSButton) {
        let obj: &AnyObject = button;
        let Some(class) = first_click_class(obj.class()) else {
            crate::logfile::write("alert: couldn't make the buttons take the first click");
            return;
        };
        // SAFETY: the new class is a direct subclass of the object's own class, adds no instance
        // variables and only adds acceptsFirstMouse: with the same signature (what KVO does too).
        unsafe { AnyObject::set_class(obj, class) };
    }

    struct Open {
        alert: Retained<NSAlert>,
        session: NSModalSession,
        buttons: usize,
        tx: Sender<usize>,
        /// For the log: when it opened, and the last focus state seen (app active, alert key, level).
        since: std::time::Instant,
        seen: (bool, bool, isize),
        /// Whether a look already had to wait for a click (logged once).
        waited: bool,
    }

    fn state(ns_app: &NSApplication, alert: &NSAlert) -> (bool, bool, isize) {
        let w = alert.window();
        (ns_app.isActive(), w.isKeyWindow(), w.level())
    }

    /// The overlay windows sit at level 21. One above them, below the menu bar.
    const LEVEL: isize = 22;

    thread_local! {
        static OPEN: RefCell<Option<Open>> = const { RefCell::new(None) };
    }

    pub fn open(title: &str, text: &str, buttons: &[String], escape: usize, press: Option<(usize, f64)>, tx: Sender<usize>) {
        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(usize::MAX);
            return;
        };
        if OPEN.with(|o| o.borrow().is_some()) {
            let _ = tx.send(usize::MAX);
            return;
        }
        let alert = NSAlert::new(mtm);
        alert.setMessageText(&NSString::from_str(title));
        alert.setInformativeText(&NSString::from_str(text));
        let added: Vec<_> = buttons.iter().map(|b| alert.addButtonWithTitle(&NSString::from_str(b))).collect();
        for b in &added {
            take_first_click(b);
        }
        if added.len() > 1 {
            added[0].setKeyEquivalent(&NSString::from_str(""));
            added[escape.min(added.len() - 1)].setKeyEquivalent(&NSString::from_str("\u{1b}"));
        }
        if let (Some((n, secs)), false) = (press, added.is_empty()) {
            let modes = NSArray::from_retained_slice(&[NSString::from_str("kCFRunLoopCommonModes")]);
            let button = &added[n.min(added.len() - 1)];
            // SAFETY: performSelector:withObject:afterDelay:inModes: on a live NSButton, with a selector it answers.
            let _: () = unsafe { msg_send![&**button, performSelector: sel!(performClick:), withObject: std::ptr::null::<objc2::runtime::AnyObject>(), afterDelay: secs, inModes: &*modes] };
        }
        alert.layout();
        let window = alert.window();
        let ns_app = NSApplication::sharedApplication(mtm);
        #[allow(deprecated)]
        ns_app.activateIgnoringOtherApps(true);
        let session = ns_app.beginModalSessionForWindow(&window);
        window.setLevel(LEVEL);
        window.orderFrontRegardless();
        let seen = state(&ns_app, &alert);
        crate::logfile::write(&format!("alert: open, app active {}, key {}, level {}", seen.0, seen.1, seen.2));
        OPEN.with(|o| *o.borrow_mut() = Some(Open { alert, session, buttons: added.len(), tx, since: std::time::Instant::now(), seen, waited: false }));
    }

    /// Lets the alert handle its events. When a button was pressed, closes it and sends the answer.
    pub fn poll() {
        let Some(mtm) = MainThreadMarker::new() else { return };
        OPEN.with(|o| {
            let mut slot = o.borrow_mut();
            let Some(open) = slot.as_mut() else { return };
            let ns_app = NSApplication::sharedApplication(mtm);
            // A look can come in the middle of a click: tao's wake-up fires in every run loop mode,
            // also while a button is tracking the mouse. A modal session run in there takes the
            // mouse-up away from the button, the click is lost and the user has to click again
            // (and again). So only look from the plain loop; the button's own loop finishes the
            // click, and the next look picks up the answer.
            let mode = NSRunLoop::currentRunLoop().currentMode().map(|m| m.to_string()).unwrap_or_default();
            if mode != "kCFRunLoopDefaultMode" {
                if !open.waited {
                    crate::logfile::write("alert: a click or a menu is in progress, waiting for it");
                    open.waited = true;
                }
                return;
            }
            let now = state(&ns_app, &open.alert);
            if now != open.seen {
                crate::logfile::write(&format!("alert: after {:.1} s, app active {}, key {}, level {}", open.since.elapsed().as_secs_f64(), now.0, now.1, now.2));
                open.seen = now;
            }
            // The modal session puts the alert back at the modal panel level (8), under the cat's
            // windows (21). Keep lifting it.
            let window = open.alert.window();
            if window.level() != LEVEL {
                window.setLevel(LEVEL);
            }
            // SAFETY: the session came from beginModalSessionForWindow and has not ended.
            let response = unsafe { ns_app.runModalSession(open.session) };
            if response == NSModalResponseContinue {
                return;
            }
            let open = slot.take().expect("checked above");
            // SAFETY: as above; it ends here, once.
            unsafe { ns_app.endModalSession(open.session) };
            open.alert.window().orderOut(None);
            ns_app.deactivate();
            // NSAlertFirstButtonReturn is 1000, the next ones count up. Anything else is no answer.
            let index = usize::try_from(response - 1000).ok().filter(|i| *i < open.buttons).unwrap_or(usize::MAX);
            crate::logfile::write(&format!("alert: answered after {:.1} s", open.since.elapsed().as_secs_f64()));
            let _ = open.tx.send(index);
        });
    }
}


/// The Windows question: TaskDialogIndirect from comctl32 version 6, looked up when it's needed
/// (a test binary without the app's manifest only has version 5, which lacks it), and a plain
/// message box with OK, or Yes and No, when it isn't there.
#[cfg(windows)]
mod win {
    use std::time::Instant;

    use windows::core::{w, BOOL, HRESULT, PCWSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, S_OK, WPARAM};
    use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress, LoadLibraryW};
    use windows::Win32::UI::Controls::{
        TASKDIALOGCONFIG, TASKDIALOG_BUTTON, TASKDIALOG_NOTIFICATIONS, TDF_ALLOW_DIALOG_CANCELLATION, TDF_CALLBACK_TIMER, TDF_SIZE_TO_CONTENT, TDM_CLICK_BUTTON,
        TDN_CREATED, TDN_TIMER,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        LoadIconW, MessageBoxW, SendMessageW, SetForegroundWindow, SetWindowPos, HWND_TOPMOST, ICON_BIG, ICON_SMALL, IDCANCEL, IDYES, MB_ICONINFORMATION, MB_OK,
        MB_SETFOREGROUND, MB_TOPMOST, MB_YESNO, SWP_NOMOVE, SWP_NOSIZE, WM_SETICON,
    };

    type TaskDialogIndirect = unsafe extern "system" fn(*const TASKDIALOGCONFIG, *mut i32, *mut i32, *mut BOOL) -> HRESULT;

    /// Button n has the id FIRST + n.
    const FIRST: i32 = 100;
    /// Where Tauri puts the app's icon in the exe's resources.
    const APP_ICON: u16 = 32512;

    struct Press {
        id: i32,
        after_ms: u32,
        done: bool,
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn task_dialog() -> Option<TaskDialogIndirect> {
        unsafe {
            let lib = LoadLibraryW(w!("comctl32.dll")).ok()?;
            let f = GetProcAddress(lib, windows::core::s!("TaskDialogIndirect"))?;
            Some(std::mem::transmute::<unsafe extern "system" fn() -> isize, TaskDialogIndirect>(f))
        }
    }

    unsafe extern "system" fn callback(hwnd: HWND, msg: TASKDIALOG_NOTIFICATIONS, wparam: WPARAM, _lparam: LPARAM, data: isize) -> HRESULT {
        if msg == TDN_CREATED {
            // Above the cat's windows (they're topmost too), so it can't sit on a button.
            let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
            let _ = SetForegroundWindow(hwnd);
            // The cat in the title bar and the taskbar, not Windows' blank program icon.
            if let Ok(icon) = GetModuleHandleW(None).and_then(|m| LoadIconW(Some(m.into()), PCWSTR(APP_ICON as usize as *const u16))) {
                for size in [ICON_SMALL, ICON_BIG] {
                    SendMessageW(hwnd, WM_SETICON, Some(WPARAM(size as usize)), Some(LPARAM(icon.0 as isize)));
                }
            }
        } else if msg == TDN_TIMER && data != 0 {
            // The test hook: press the dialog's own button, a message to this window, no input event.
            let press = &mut *(data as *mut Press);
            if !press.done && wparam.0 as u32 >= press.after_ms {
                press.done = true;
                SendMessageW(hwnd, TDM_CLICK_BUTTON.0 as u32, Some(WPARAM(press.id as usize)), Some(LPARAM(0)));
            }
        }
        S_OK
    }

    pub fn ask(title: &str, text: &str, buttons: &[&str], escape: usize, press: Option<(usize, f64)>) -> usize {
        let since = Instant::now();
        let answer = match task_dialog() {
            Some(f) => dialog(f, title, text, buttons, escape, press),
            None => fallback(title, text, buttons, escape),
        };
        crate::logfile::write(&format!("alert: answered after {:.1} s", since.elapsed().as_secs_f64()));
        answer
    }

    fn dialog(f: TaskDialogIndirect, title: &str, text: &str, buttons: &[&str], escape: usize, press: Option<(usize, f64)>) -> usize {
        let (title_w, text_w, app_w) = (wide(title), wide(text), wide("Felinquent"));
        let names: Vec<Vec<u16>> = buttons.iter().map(|b| wide(b)).collect();
        let list: Vec<TASKDIALOG_BUTTON> =
            names.iter().enumerate().map(|(i, n)| TASKDIALOG_BUTTON { nButtonID: FIRST + i as i32, pszButtonText: PCWSTR(n.as_ptr()) }).collect();
        let mut tick = press.filter(|(n, _)| *n < buttons.len()).map(|(n, s)| Press { id: FIRST + n as i32, after_ms: (s.max(0.0) * 1000.0) as u32, done: false });
        let config = TASKDIALOGCONFIG {
            cbSize: std::mem::size_of::<TASKDIALOGCONFIG>() as u32,
            dwFlags: TDF_ALLOW_DIALOG_CANCELLATION | TDF_SIZE_TO_CONTENT | TDF_CALLBACK_TIMER,
            pszWindowTitle: PCWSTR(app_w.as_ptr()),
            pszMainInstruction: PCWSTR(title_w.as_ptr()),
            pszContent: PCWSTR(text_w.as_ptr()),
            cButtons: list.len() as u32,
            pButtons: list.as_ptr(),
            // Enter presses the safe button (Escape's), never the first one, so a key meant for
            // another app can't start anything.
            nDefaultButton: FIRST + escape.min(buttons.len().saturating_sub(1)) as i32,
            pfCallback: Some(callback),
            lpCallbackData: tick.as_mut().map(|p| p as *mut Press as isize).unwrap_or(0),
            ..Default::default()
        };
        let mut pressed = 0i32;
        let ok = unsafe { f(&config, &mut pressed, std::ptr::null_mut(), std::ptr::null_mut()) };
        if ok.is_err() {
            crate::logfile::write(&format!("alert: the task dialog didn't show ({ok:?})"));
            return fallback(title, text, buttons, escape);
        }
        if pressed == IDCANCEL.0 {
            return if buttons.len() > 1 { escape } else { 0 };
        }
        usize::try_from(pressed - FIRST).ok().filter(|i| *i < buttons.len()).unwrap_or(usize::MAX)
    }

    /// OK for one button, Yes (the first) or No (Escape's) for more.
    fn fallback(title: &str, text: &str, buttons: &[&str], escape: usize) -> usize {
        let body = if buttons.len() > 1 { format!("{text}\n\nYes: {}\nNo: {}", buttons[0], buttons[escape.min(buttons.len() - 1)]) } else { text.to_string() };
        let (t, b) = (wide(title), wide(&body));
        let style = if buttons.len() > 1 { MB_YESNO } else { MB_OK } | MB_ICONINFORMATION | MB_TOPMOST | MB_SETFOREGROUND;
        let r = unsafe { MessageBoxW(None, PCWSTR(b.as_ptr()), PCWSTR(t.as_ptr()), style) };
        if buttons.len() < 2 {
            0
        } else if r == IDYES {
            0
        } else {
            escape
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_press_reads_a_button_and_a_delay() {
        assert_eq!(test_press("0"), Some((0, 3.0)));
        assert_eq!(test_press("2@1.5"), Some((2, 1.5)));
        assert_eq!(test_press("1@soon"), Some((1, 3.0)));
        assert_eq!(test_press("yes"), None);
    }
}
