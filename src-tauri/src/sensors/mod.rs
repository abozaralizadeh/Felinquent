//! What the cat can sense, per operating system. Reads only: window geometry, idle seconds,
//! whether the mic or camera is in use, the display layout and the pointer. No screenshots, no key
//! contents, no window titles (titles need an opt-in permission and stay off).
//!
//! All coordinates are in "points" in one global space: the main display's top-left is 0,0 and y grows down.

use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct Win {
    pub id: String,
    pub app: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// 0 is the frontmost window.
    pub z: usize,
}

/// The desktop (a Space on the Mac) the main display shows, and its place in the row of desktops
/// (0 is the leftmost). spans: one row of desktops covers every display. app: it's an app in full
/// screen, not a desktop. hidden: the cat's window can't be shown there (main.rs sets it).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Space {
    pub id: String,
    pub index: i32,
    pub spans: bool,
    pub app: bool,
    pub hidden: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct Display {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "macos")]
pub use mac::*;

#[cfg(windows)]
mod win;
#[cfg(windows)]
pub use win::*;

/// Other systems (Linux) get an empty desktop, so the code at least compiles.
#[cfg(not(any(target_os = "macos", windows)))]
mod other {
    use super::{Display, Space, Win};
    pub fn space() -> Option<Space> {
        None
    }
    pub fn windows(_skip: &str) -> Vec<Win> {
        vec![]
    }
    pub fn idle_sec() -> f64 {
        0.0
    }
    pub fn since_key_sec() -> f64 {
        0.0
    }
    pub fn mic_in_use() -> bool {
        false
    }
    pub fn camera_in_use() -> bool {
        false
    }
    pub fn display_kept_awake() -> bool {
        false
    }
    pub fn displays() -> Vec<Display> {
        vec![Display { x: 0.0, y: 0.0, w: 1440.0, h: 900.0 }]
    }
    pub fn pointer() -> (f64, f64, bool) {
        (0.0, 0.0, false)
    }
}
#[cfg(not(any(target_os = "macos", windows)))]
pub use other::*;
