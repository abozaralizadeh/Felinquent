//! Windows sensors, written to match the Mac ones and tried on a Windows 11 machine (ADR-060).
//!
//! Units: Windows reports pixels. Everything is divided by the main display's scale (the system DPI
//! divided by 96), so the page sees the same "points" as on a Mac. Mixed-DPI setups are not handled.
//!
//! Desktops: Windows keeps the list of virtual desktops and the one showing in the registry
//! (Explorer\VirtualDesktops). That is read here the way the Mac reads its Spaces, so the cat
//! knows when you switch. Full screen: a window that covers its whole display, or Windows saying an
//! app runs full screen or a presentation is on (SHQueryUserNotificationState). On Windows a
//! full-screen window is nearly always a video, a game or slides (everyday windows are maximized,
//! not full screen), so it counts as "video or slides" and the cat goes outside (RM-02).

use super::{Display, Win};
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, MonitorFromWindow, HDC, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::HiDpi::GetDpiForSystem;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowLongW, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible, IsZoomed, GWL_EXSTYLE,
    GWL_STYLE, WS_CAPTION, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
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
    if is_shell(hwnd) {
        return BOOL(1);
    }
    if cloaked(hwnd) {
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

/// Hidden by Windows while it looks visible: a window on another virtual desktop, or a suspended store app.
fn cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    let _ = unsafe { DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, 4) };
    cloaked != 0
}

fn class_of(hwnd: HWND) -> String {
    let mut buf = [0u16; 128];
    let n = unsafe { GetClassNameW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

/// The desktop itself, the taskbar and its copies on other displays: never something to stand on.
fn is_shell(hwnd: HWND) -> bool {
    matches!(class_of(hwnd).as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
}

/// The desktop showing: its id and place in the row, from what Explorer keeps in the registry.
/// One desktop that was never split has no list there, and is desktop 0. A Windows desktop spans
/// every display. `app` is a full-screen window in front.
pub fn space() -> Option<super::Space> {
    let (id, index) = virtual_desktop().unwrap_or_else(|| ("main".into(), 0));
    Some(super::Space { id, index, spans: true, app: fullscreen_in_front(), hidden: false })
}

/// A Windows desktop spans every display, so there is no desktop per display.
pub fn display_spaces() -> Vec<super::DisplaySpace> {
    vec![]
}

fn virtual_desktop() -> Option<(String, i32)> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops", KEY_READ).ok()?;
    let current = key.get_raw_value("CurrentVirtualDesktop").ok()?.bytes;
    if current.len() != 16 {
        return None;
    }
    let all = key.get_raw_value("VirtualDesktopIDs").map(|v| v.bytes).unwrap_or_default();
    let index = all.chunks_exact(16).position(|g| g == current.as_slice()).unwrap_or(0) as i32;
    Some((current.iter().map(|b| format!("{b:02x}")).collect(), index))
}

/// A window in front that covers its whole display (a video, a game, slides), or Windows saying an
/// app runs full screen or a presentation is on.
/// Both the window with the keyboard and the top window on screen count: right after a video
/// goes full screen, or with nothing active at all, the two can differ.
pub fn fullscreen_in_front() -> bool {
    let busy = unsafe { SHQueryUserNotificationState() }.map(|s| s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE).unwrap_or(false);
    busy || covers_display(unsafe { GetForegroundWindow() }) || front_window().is_some_and(covers_display)
}

/// The top window of the kind the window list keeps (not ours, not the shell, not a tool window).
fn front_window() -> Option<HWND> {
    struct Find {
        own: u32,
        found: Option<HWND>,
    }
    unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let f = &mut *(lparam.0 as *mut Find);
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() || is_shell(hwnd) || cloaked(hwnd) {
            return BOOL(1);
        }
        if GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) != 0 {
            return BOOL(1);
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let mut r = RECT::default();
        if pid == f.own || GetWindowRect(hwnd, &mut r).is_err() || r.right - r.left < 120 || r.bottom - r.top < 60 {
            return BOOL(1);
        }
        f.found = Some(hwnd);
        BOOL(0)
    }
    let mut f = Find { own: std::process::id(), found: None };
    // Stopping early makes EnumWindows report an error; the answer is in `found` either way.
    let _ = unsafe { EnumWindows(Some(each), LPARAM(&mut f as *mut Find as isize)) };
    f.found
}

fn covers_display(hwnd: HWND) -> bool {
    if hwnd.0.is_null() || is_shell(hwnd) {
        return false;
    }
    // A maximized window with a title bar is everyday work, even when it reaches the screen's
    // edges (an auto-hidden taskbar). Full-screen windows drop the title bar.
    let style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) } as u32;
    if style & WS_CAPTION.0 == WS_CAPTION.0 && unsafe { IsZoomed(hwnd) }.as_bool() {
        return false;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == std::process::id() {
        return false;
    }
    let mut r = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut r) }.is_err() {
        return false;
    }
    let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    let m = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    if !unsafe { GetMonitorInfoW(m, &mut mi) }.as_bool() {
        return false;
    }
    let d = mi.rcMonitor;
    r.left <= d.left && r.top <= d.top && r.right >= d.right && r.bottom >= d.bottom
}

/// On Windows a full-screen window is nearly always a video, a game or slides (see the top of
/// this file), so it counts the way a display kept awake does on the Mac: the cat goes outside.
/// Windows also says so itself while an app runs full screen (QUNS_BUSY).
pub fn display_kept_awake() -> bool {
    let busy = unsafe { SHQueryUserNotificationState() }.map(|s| s == QUNS_BUSY).unwrap_or(false);
    busy || fullscreen_in_front()
}

/// Seconds since the last keyboard or mouse input. A number only.
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

/// Whether the right mouse button is down. Read only.
pub fn right_button() -> bool {
    unsafe { (GetAsyncKeyState(VK_RBUTTON.0 as i32) as u16) & 0x8000 != 0 }
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
