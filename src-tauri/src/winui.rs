//! Windows only: what makes the overlay windows behave like the Mac panels (ADR-060).
//!
//! - A tool window (WS_EX_TOOLWINDOW): Windows shows it on every virtual desktop and never in
//!   the taskbar or Alt+Tab, so the cat is on whichever desktop you switch to.
//! - Never activated (WS_EX_NOACTIVATE): a click on the cat doesn't take the keyboard from the
//!   app you're typing in.
//! - Click-through (WS_EX_TRANSPARENT and WS_EX_LAYERED) set here, not with Tauri's
//!   set_ignore_cursor_events: Tauri writes the whole extended style each time, which would drop
//!   the two bits above.
//!
//! These only change Felinquent's own windows. Nothing here touches another app's window.

use tauri::WebviewWindow;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_EX_APPWINDOW,
    WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

fn hwnd(w: &WebviewWindow) -> Option<HWND> {
    // Tauri's HWND may come from another version of the windows crate, so go through the pointer.
    w.hwnd().ok().map(|h| HWND(h.0 as _))
}

fn set_ex(h: HWND, f: impl FnOnce(u32) -> u32) {
    unsafe {
        let old = GetWindowLongW(h, GWL_EXSTYLE) as u32;
        let new = f(old);
        if new != old {
            SetWindowLongW(h, GWL_EXSTYLE, new as i32);
            let _ = SetWindowPos(h, None, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        }
    }
}

/// On every desktop, out of the taskbar, never activated, and on top.
pub fn tune(w: &WebviewWindow) {
    let Some(h) = hwnd(w) else { return };
    set_ex(h, |ex| (ex | WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) & !WS_EX_APPWINDOW.0);
    unsafe {
        let _ = SetWindowPos(h, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

/// true: clicks pass through to whatever is below. false: the cat catches them.
pub fn click_through(w: &WebviewWindow, on: bool) {
    let Some(h) = hwnd(w) else { return };
    let through = WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0;
    let keep = WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0;
    set_ex(h, |ex| if on { ex | through | keep } else { (ex & !through) | keep });
}

/// Kept out of screen shares, recordings and screenshots (the "Hide from screen sharing" switch):
/// Windows leaves the window out of every capture and shows it only on the screen itself. Before
/// Windows 10 2004 (build 19041) the same call would black the window out of a capture instead,
/// and these windows cover whole displays, so there it does nothing and says so (false).
pub fn hide_from_capture(w: &WebviewWindow, on: bool) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};
    let Some(h) = hwnd(w) else { return false };
    if on && build() < 19041 {
        return false;
    }
    let raw = h.0 as isize;
    let label = w.label().to_string();
    // The affinity is set from the window's own thread, like the subclass below.
    let _ = w.run_on_main_thread(move || {
        let ok = unsafe { SetWindowDisplayAffinity(HWND(raw as _), if on { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE }) }.is_ok();
        crate::logfile::write(&format!("capture: {label} {} {}", if on { "hidden from captures" } else { "in captures again" }, if ok { "" } else { "(Windows said no)" }));
    });
    true
}

/// The Windows build number (19045 for Windows 10 22H2, 22000 and up for Windows 11). 0 if unknown.
fn build() -> u32 {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", KEY_READ)
        .and_then(|k| k.get_value::<String, _>("CurrentBuildNumber"))
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(0)
}

/// Calls `f` when Windows ends the session (logging off, shutting down, an update of Windows).
/// Windows ends the app without the usual quit then, and with fast startup a shutdown doesn't
/// start a new boot, so without this the next launch would think the app had crashed (report.rs).
pub fn on_session_end(w: &WebviewWindow, f: fn()) {
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::WM_ENDSESSION;

    unsafe extern "system" fn proc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, data: usize) -> LRESULT {
        if msg == WM_ENDSESSION && wp.0 != 0 {
            // SAFETY: `data` is the fn pointer given to SetWindowSubclass below.
            let f: fn() = unsafe { std::mem::transmute::<usize, fn()>(data) };
            f();
        }
        unsafe { DefSubclassProc(h, msg, wp, lp) }
    }

    let Some(h) = hwnd(w) else { return };
    let raw = h.0 as isize;
    // A subclass has to be set on the window's own thread.
    let _ = w.run_on_main_thread(move || unsafe {
        let _ = SetWindowSubclass(HWND(raw as _), Some(proc), 0xF1E1, f as usize);
    });
}
