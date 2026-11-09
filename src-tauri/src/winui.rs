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
