//! Mac sensors for the cat. Reads only: window geometry, idle seconds, and
//! "is the mic or camera in use" flags. No screenshots, no key contents, no
//! window titles (titles need Screen Recording and stay off until the user opts in).

use core_foundation::array::CFArray;
use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::window::{
    copy_window_info, kCGNullWindowID, kCGWindowListExcludeDesktopElements,
    kCGWindowListOptionOnScreenOnly,
};
use super::{Display, Space, Win};
use std::os::raw::{c_char, c_void};

type Dict = CFDictionary<CFString, CFType>;

fn num(d: &Dict, key: &str) -> Option<f64> {
    let k = CFString::new(key);
    d.find(&k)?.downcast::<CFNumber>().and_then(|n| n.to_f64())
}

fn text(d: &Dict, key: &str) -> Option<String> {
    let k = CFString::new(key);
    d.find(&k)?.downcast::<CFString>().map(|s| s.to_string())
}

fn dict(d: &Dict, key: &str) -> Option<Dict> {
    let k = CFString::new(key);
    let v = d.find(&k)?;
    // SAFETY: kCGWindowBounds is documented to be a CFDictionary.
    Some(unsafe { CFDictionary::wrap_under_get_rule(v.as_concrete_TypeRef() as _) })
}

/// Normal app windows that are on screen, front to back. Menu bar, Dock and
/// overlays (layer other than 0) are left out, so are tiny windows.
pub fn windows(skip_owner: &str) -> Vec<Win> {
    let opts = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
    let Some(arr) = copy_window_info(opts, kCGNullWindowID) else {
        return vec![];
    };
    let arr: CFArray<CFDictionary<CFString, CFType>> =
        unsafe { CFArray::wrap_under_get_rule(arr.as_concrete_TypeRef() as _) };
    let mut out = Vec::new();
    for (z, d) in arr.iter().enumerate() {
        let d: CFDictionary<CFString, CFType> = d.clone();
        if num(&d, "kCGWindowLayer").unwrap_or(-1.0) != 0.0 {
            continue;
        }
        let app = text(&d, "kCGWindowOwnerName").unwrap_or_default();
        if app == skip_owner || app == "Window Server" {
            continue;
        }
        if num(&d, "kCGWindowAlpha").unwrap_or(1.0) < 0.05 {
            continue;
        }
        let Some(b) = dict(&d, "kCGWindowBounds") else {
            continue;
        };
        let (x, y) = (num(&b, "X").unwrap_or(0.0), num(&b, "Y").unwrap_or(0.0));
        let (w, h) = (num(&b, "Width").unwrap_or(0.0), num(&b, "Height").unwrap_or(0.0));
        if w < 120.0 || h < 60.0 {
            continue;
        }
        let id = num(&d, "kCGWindowNumber").map(|n| n as i64).unwrap_or(0);
        out.push(Win { id: format!("w{id}"), app, x, y, w, h, z });
    }
    // z becomes the rank among kept windows.
    for (i, w) in out.iter_mut().enumerate() {
        w.z = i;
    }
    out
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
}

/// Seconds since the last input of any kind. A number only, never which key.
pub fn idle_sec() -> f64 {
    // state 1 = combined HID system state, 0xFFFFFFFF = any input event.
    unsafe { CGEventSourceSecondsSinceLastEventType(1, 0xFFFF_FFFF) }
}

/// Seconds since the last key press (the time only; used for a typing level).
pub fn since_key_sec() -> f64 {
    // 10 = kCGEventKeyDown
    unsafe { CGEventSourceSecondsSinceLastEventType(1, 10) }
}

// ---- Microphone in use (CoreAudio) -----------------------------------------

#[repr(C)]
struct PropAddr {
    selector: u32,
    scope: u32,
    element: u32,
}

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyDataSize(obj: u32, addr: *const PropAddr, qsize: u32, q: *const c_void, out: *mut u32) -> i32;
    fn AudioObjectGetPropertyData(obj: u32, addr: *const PropAddr, qsize: u32, q: *const c_void, size: *mut u32, data: *mut c_void) -> i32;
}

const fn fcc(s: &[u8; 4]) -> u32 {
    ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | (s[3] as u32)
}

const AUDIO_SYSTEM_OBJECT: u32 = 1;
const GLOBAL: u32 = fcc(b"glob");
const INPUT: u32 = fcc(b"inpt");
const MAIN: u32 = 0;

/// True when any input device (microphone) is running in some process.
pub fn mic_in_use() -> bool {
    unsafe {
        let devs = PropAddr { selector: fcc(b"dev#"), scope: GLOBAL, element: MAIN };
        let mut size = 0u32;
        if AudioObjectGetPropertyDataSize(AUDIO_SYSTEM_OBJECT, &devs, 0, std::ptr::null(), &mut size) != 0 {
            return false;
        }
        let n = size as usize / 4;
        let mut ids = vec![0u32; n];
        if AudioObjectGetPropertyData(AUDIO_SYSTEM_OBJECT, &devs, 0, std::ptr::null(), &mut size, ids.as_mut_ptr() as *mut c_void) != 0 {
            return false;
        }
        for id in ids {
            // Does it have input streams?
            let streams = PropAddr { selector: fcc(b"stm#"), scope: INPUT, element: MAIN };
            let mut ssize = 0u32;
            if AudioObjectGetPropertyDataSize(id, &streams, 0, std::ptr::null(), &mut ssize) != 0 || ssize == 0 {
                continue;
            }
            let running = PropAddr { selector: fcc(b"gone"), scope: GLOBAL, element: MAIN };
            let mut v = 0u32;
            let mut vs = 4u32;
            if AudioObjectGetPropertyData(id, &running, 0, std::ptr::null(), &mut vs, &mut v as *mut u32 as *mut c_void) == 0 && v != 0 {
                return true;
            }
        }
        false
    }
}

// ---- Camera in use (CoreMediaIO) -------------------------------------------

#[link(name = "CoreMediaIO", kind = "framework")]
extern "C" {
    fn CMIOObjectGetPropertyDataSize(obj: u32, addr: *const PropAddr, qsize: u32, q: *const c_void, out: *mut u32) -> i32;
    fn CMIOObjectGetPropertyData(obj: u32, addr: *const PropAddr, qsize: u32, q: *const c_void, size: u32, used: *mut u32, data: *mut c_void) -> i32;
}

const CMIO_SYSTEM_OBJECT: u32 = 1;

/// True when any camera is running in some process.
pub fn camera_in_use() -> bool {
    unsafe {
        let devs = PropAddr { selector: fcc(b"dev#"), scope: GLOBAL, element: MAIN };
        let mut size = 0u32;
        if CMIOObjectGetPropertyDataSize(CMIO_SYSTEM_OBJECT, &devs, 0, std::ptr::null(), &mut size) != 0 || size == 0 {
            return false;
        }
        let mut ids = vec![0u32; size as usize / 4];
        let mut used = 0u32;
        if CMIOObjectGetPropertyData(CMIO_SYSTEM_OBJECT, &devs, 0, std::ptr::null(), size, &mut used, ids.as_mut_ptr() as *mut c_void) != 0 {
            return false;
        }
        for id in ids.into_iter().take(used as usize / 4) {
            let running = PropAddr { selector: fcc(b"gone"), scope: GLOBAL, element: MAIN };
            let mut v = 0u32;
            let mut u = 0u32;
            if CMIOObjectGetPropertyData(id, &running, 0, std::ptr::null(), 4, &mut u, &mut v as *mut u32 as *mut c_void) == 0 && v != 0 {
                return true;
            }
        }
        false
    }
}

// ---- Desktops (Spaces) -------------------------------------------------------
//
// Which desktop is showing, and where it sits in the row, so the cat can stay behind on its own
// desktop and later walk in from the side it's on. macOS has no public call for this; these are the
// read-only CoreGraphics calls window managers use. They are looked up at run time, so a macOS
// without them simply has no desktops to tell apart (the cat then just stays with you).

extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFUUIDCreateString(alloc: *const c_void, uuid: *const c_void) -> *const c_void;
    fn CFRelease(cf: *const c_void);
}
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGMainDisplayID() -> u32;
}
/// RTLD_DEFAULT on macOS: search every image already loaded.
const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

fn symbol(name: &std::ffi::CStr) -> *mut c_void {
    // SAFETY: dlsym with RTLD_DEFAULT and a NUL-terminated name only looks a symbol up.
    unsafe { dlsym(RTLD_DEFAULT, name.as_ptr()) }
}

fn space_id(d: &Dict) -> Option<i64> {
    num(d, "id64").or_else(|| num(d, "ManagedSpaceID")).map(|n| n as i64)
}

/// The main display's UUID, as the desktop list names displays when each has its own desktops.
fn main_display_uuid() -> Option<String> {
    let f = symbol(c"CGDisplayCreateUUIDFromDisplayID");
    if f.is_null() {
        return None;
    }
    // SAFETY: CGDisplayCreateUUIDFromDisplayID(CGDirectDisplayID) -> CFUUIDRef (+1, may be NULL).
    let create: extern "C" fn(u32) -> *const c_void = unsafe { std::mem::transmute(f) };
    let uuid = create(unsafe { CGMainDisplayID() });
    if uuid.is_null() {
        return None;
    }
    // SAFETY: a live CFUUIDRef; both results are released or wrapped exactly once.
    unsafe {
        let s = CFUUIDCreateString(std::ptr::null(), uuid);
        CFRelease(uuid);
        if s.is_null() {
            return None;
        }
        Some(CFString::wrap_under_create_rule(s as _).to_string())
    }
}

/// The desktop the main display shows now, or None if macOS doesn't say.
pub fn space() -> Option<Space> {
    let conn = symbol(c"CGSMainConnectionID");
    let copy = symbol(c"CGSCopyManagedDisplaySpaces");
    if conn.is_null() || copy.is_null() {
        return None;
    }
    // SAFETY: int CGSMainConnectionID(void) and CFArrayRef CGSCopyManagedDisplaySpaces(int) (+1).
    let (conn, copy): (extern "C" fn() -> i32, extern "C" fn(i32) -> *const c_void) = unsafe { (std::mem::transmute(conn), std::mem::transmute(copy)) };
    let arr = copy(conn());
    if arr.is_null() {
        return None;
    }
    // SAFETY: the copy is ours (+1) and an array of dictionaries.
    let arr: CFArray<CFDictionary<CFString, CFType>> = unsafe { CFArray::wrap_under_create_rule(arr as _) };
    let main_uuid = main_display_uuid();
    let entries: Vec<Dict> = arr.iter().map(|d| d.clone()).collect();
    // "Main" means one row of desktops for all displays; else find the main display's own row.
    let pick = entries
        .iter()
        .find(|d| text(d, "Display Identifier").as_deref() == Some("Main"))
        .or_else(|| {
            let uuid = main_uuid.as_deref()?;
            entries.iter().find(|d| text(d, "Display Identifier").is_some_and(|i| i.eq_ignore_ascii_case(uuid)))
        })
        .or(entries.first())?;
    let spans = text(pick, "Display Identifier").as_deref() == Some("Main");
    let current = space_id(&dict(pick, "Current Space")?)?;
    let k = CFString::new("Spaces");
    let list = pick.find(&k)?;
    // SAFETY: "Spaces" is an array of dictionaries; get rule, the entry owns it.
    let list: CFArray<CFDictionary<CFString, CFType>> = unsafe { CFArray::wrap_under_get_rule(list.as_concrete_TypeRef() as _) };
    let index = list.iter().position(|d| space_id(&d.clone()) == Some(current)).map(|i| i as i32).unwrap_or(-1);
    Some(Space { id: current.to_string(), index, spans })
}

// ---- Displays ----------------------------------------------------------------

/// All active displays in points, in the same global space as the window list
/// (the main display's top-left is 0,0 and y grows downwards). The main display comes first.
pub fn displays() -> Vec<Display> {
    use core_graphics::display::CGDisplay;
    let main = CGDisplay::main();
    let mut out = vec![];
    let to = |d: &CGDisplay| {
        let b = d.bounds();
        Display { x: b.origin.x, y: b.origin.y, w: b.size.width, h: b.size.height }
    };
    out.push(to(&main));
    if let Ok(ids) = CGDisplay::active_displays() {
        for id in ids {
            if id != main.id {
                out.push(to(&CGDisplay::new(id)));
            }
        }
    }
    out
}

/// Where the real cursor is in global points (top-left of the main display is 0,0), and whether
/// the primary mouse button is down. Read only.
#[allow(dead_code)]
pub fn pointer() -> (f64, f64, bool) {
    use objc2_app_kit::NSEvent;
    let main_h = displays().first().map(|d| d.h).unwrap_or(900.0);
    let loc = NSEvent::mouseLocation();
    let down = NSEvent::pressedMouseButtons() & 1 == 1;
    (loc.x, main_h - loc.y, down)
}
