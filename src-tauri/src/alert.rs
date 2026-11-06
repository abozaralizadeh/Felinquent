//! Native questions (macOS), shared by the updater (update.rs) and the model setup (ollama.rs).
//!
//! An alert runs as a modal session that is looked at every 50 ms, so between looks the app goes
//! on as normal and the cat doesn't freeze while the question waits. The app comes to the front
//! for it, above the cat's windows so the cat can't sit on a button, and hands the focus back when
//! it closes. Return doesn't press the first button, so a key meant for another app can't start
//! anything; Escape presses the button the caller names. Only one question shows at a time: a
//! second one waits until the first is answered.

use std::sync::mpsc::RecvTimeoutError;
use std::sync::Mutex;
use std::time::Duration;

use tauri::AppHandle;

static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// Shows a Mac alert and returns which button was clicked (0 is the first, usize::MAX if it
/// couldn't show). Call it off the main thread. `escape` is the button Escape presses (only
/// when there is more than one button). `press` is for tests: press button n after s seconds,
/// with `performClick:` on the alert's own button, so no input event is made.
pub fn ask(app: &AppHandle, title: &str, text: &str, buttons: &[&str], escape: usize, press: Option<(usize, f64)>) -> usize {
    let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
    let (tx, rx) = std::sync::mpsc::channel();
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
mod session {
    use std::cell::RefCell;
    use std::sync::mpsc::Sender;

    use objc2::rc::Retained;
    use objc2::{msg_send, sel, MainThreadMarker};
    use objc2_app_kit::{NSAlert, NSApplication, NSModalResponseContinue, NSModalSession};
    use objc2_foundation::{NSArray, NSString};

    struct Open {
        alert: Retained<NSAlert>,
        session: NSModalSession,
        buttons: usize,
        tx: Sender<usize>,
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
        OPEN.with(|o| *o.borrow_mut() = Some(Open { alert, session, buttons: added.len(), tx }));
    }

    /// Lets the alert handle its events. When a button was pressed, closes it and sends the answer.
    pub fn poll() {
        let Some(mtm) = MainThreadMarker::new() else { return };
        OPEN.with(|o| {
            let mut slot = o.borrow_mut();
            let Some(open) = slot.as_ref() else { return };
            let ns_app = NSApplication::sharedApplication(mtm);
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
            let _ = open.tx.send(index);
        });
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
