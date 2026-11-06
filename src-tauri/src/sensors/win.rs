//! Windows sensors. Written to match the Mac ones. This code has been compile-checked on a Mac
//! but never run on a Windows machine, so treat it as untested.
//!
//! Units: Windows reports pixels. Everything is divided by the main display's scale (the system DPI
//! divided by 96), so the page sees the same "points" as on a Mac. Mixed-DPI setups are not handled.

use super::{Display, Win};
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::HiDpi::GetDpiForSystem;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetCursorPos, GetWindowLongW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

fn scale() -> f64 {
    let dpi = unsafe { GetDpiForSystem() };
    if dpi == 0 { 1.0 } else { dpi as f64 / 96.0 }
}

fn app_name(hwnd: HWND) -> Option<(String, u32)> {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return None;
    }
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 520];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let stem = std::path::Path::new(&path).file_stem()?.to_string_lossy().into_owned();
        Some((stem, pid))
    }
}

struct Collect {
    out: Vec<Win>,
    skip: String,
    own_pid: u32,
    scale: f64,
}

unsafe extern "system" fn each_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let c = &mut *(lparam.0 as *mut Collect);
    if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
        return BOOL(1);
    }
    let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    if ex & (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) != 0 {
        return BOOL(1);
    }
    let mut cloaked = 0u32;
    let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, 4);
    if cloaked != 0 {
        return BOOL(1);
    }
    let mut r = RECT::default();
    if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut RECT as *mut _, std::mem::size_of::<RECT>() as u32).is_err() {
        return BOOL(1);
    }
    let Some((app, pid)) = app_name(hwnd) else { return BOOL(1) };
    if pid == c.own_pid || app.eq_ignore_ascii_case(&c.skip) || app == "TextInputHost" || app == "ShellExperienceHost" {
        return BOOL(1);
    }
    let (x, y) = (r.left as f64 / c.scale, r.top as f64 / c.scale);
    let (w, h) = ((r.right - r.left) as f64 / c.scale, (r.bottom - r.top) as f64 / c.scale);
    if w < 120.0 || h < 60.0 {
        return BOOL(1);
    }
    let z = c.out.len();
    c.out.push(Win { id: format!("w{}", hwnd.0 as isize), app, x, y, w, h, z });
    BOOL(1)
}

/// Normal app windows that are on screen, front to back.
pub fn windows(skip_owner: &str) -> Vec<Win> {
    let mut c = Collect { out: vec![], skip: skip_owner.to_string(), own_pid: std::process::id(), scale: scale() };
    unsafe {
        let _ = EnumWindows(Some(each_window), LPARAM(&mut c as *mut Collect as isize));
    }
    c.out
}

/// Seconds since the last keyboard or mouse input. A number only.
/// Virtual desktops on Windows aren't read yet.
pub fn space() -> Option<super::Space> {
    None
}

/// Not read on Windows yet.
pub fn display_kept_awake() -> bool {
    false
}

pub fn idle_sec() -> f64 {
    unsafe {
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        if GetLastInputInfo(&mut info).as_bool() {
            return GetTickCount().wrapping_sub(info.dwTime) as f64 / 1000.0;
        }
    }
    0.0
}

/// Windows has no cheap "last key press" counter, and reading which keys are down would break the
/// promise that the cat never looks at keys. So the typing level uses any input, as the design's fallback says.
pub fn since_key_sec() -> f64 {
    idle_sec()
}

fn consent_in_use(kind: &str) -> bool {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;
    let root = format!(r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{kind}");
    let Ok(base) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(&root, KEY_READ) else {
        return false;
    };
    let check = |k: &RegKey| -> bool {
        let start: u64 = k.get_value("LastUsedTimeStart").unwrap_or(0);
        let stop: u64 = k.get_value("LastUsedTimeStop").unwrap_or(0);
        start > 0 && stop == 0
    };
    for name in base.enum_keys().flatten() {
        if name == "NonPackaged" {
            if let Ok(np) = base.open_subkey_with_flags(&name, KEY_READ) {
                for sub in np.enum_keys().flatten() {
                    if np.open_subkey_with_flags(&sub, KEY_READ).map(|k| check(&k)).unwrap_or(false) {
                        return true;
                    }
                }
            }
        } else if base.open_subkey_with_flags(&name, KEY_READ).map(|k| check(&k)).unwrap_or(false) {
            return true;
        }
    }
    false
}

/// True when some app is using the microphone right now (Windows privacy settings record this).
pub fn mic_in_use() -> bool {
    consent_in_use("microphone")
}

/// True when some app is using a camera right now.
pub fn camera_in_use() -> bool {
    consent_in_use("webcam")
}

unsafe extern "system" fn each_monitor(m: HMONITOR, _dc: HDC, _r: *mut RECT, lparam: LPARAM) -> BOOL {
    let list = &mut *(lparam.0 as *mut Vec<(bool, Display)>);
    let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    if GetMonitorInfoW(m, &mut mi).as_bool() {
        let s = scale();
        let r = mi.rcMonitor;
        let primary = mi.dwFlags & 1 != 0; // MONITORINFOF_PRIMARY
        list.push((primary, Display { x: r.left as f64 / s, y: r.top as f64 / s, w: (r.right - r.left) as f64 / s, h: (r.bottom - r.top) as f64 / s }));
    }
    BOOL(1)
}

/// All displays in points. The main display comes first.
pub fn displays() -> Vec<Display> {
    let mut list: Vec<(bool, Display)> = vec![];
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(each_monitor), LPARAM(&mut list as *mut _ as isize));
    }
    list.sort_by_key(|(primary, _)| !*primary);
    let out: Vec<Display> = list.into_iter().map(|(_, d)| d).collect();
    if out.is_empty() { vec![Display { x: 0.0, y: 0.0, w: 1440.0, h: 900.0 }] } else { out }
}

/// Where the real cursor is in points, and whether the left mouse button is down. Read only:
/// only the mouse button is looked at, never a keyboard key.
pub fn pointer() -> (f64, f64, bool) {
    unsafe {
        let mut p = POINT::default();
        let _ = GetCursorPos(&mut p);
        let s = scale();
        let down = (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16) & 0x8000 != 0;
        (p.x as f64 / s, p.y as f64 / s, down)
    }
}
