//! Felinquent overlay spike: a transparent, click-through window over every display
//! that shows the cat, with real Mac sensors behind it (spikes S-1 and S-2).
mod logfile;
mod sensors;

use serde::Serialize;
#[cfg(not(windows))]
use tauri::{LogicalPosition, LogicalSize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Serialize)]
struct Sensors {
    windows: Vec<sensors::Win>,
    idle_sec: f64,
    since_key_sec: f64,
    mic_in_use: bool,
    camera_in_use: bool,
}

#[derive(Serialize)]
struct Layout {
    /// Which display this window covers (0 is the main display).
    index: usize,
    /// All displays in global points. The main display comes first.
    displays: Vec<sensors::Display>,
    /// Top of the Dock on the main display, in points.
    dock_top: f64,
}

#[derive(Serialize)]
struct Pointer {
    x: f64,
    y: f64,
    down: bool,
}

#[derive(Serialize)]
struct Config {
    demo: bool,
    /// Shows the red "clicks blocked" box.
    debug: bool,
    /// "auto", "rules" or "ollama".
    brain: String,
    ollama_url: String,
    ollama_model: String,
}

/// Saved settings and memory live in the app's config folder. Only these two names are allowed.
fn state_path(app: &AppHandle, name: &str) -> Option<std::path::PathBuf> {
    if name != "settings.json" && name != "memory.json" {
        return None;
    }
    app.path().app_config_dir().ok().map(|d| d.join(name))
}

#[tauri::command]
fn load_state(app: AppHandle, name: String) -> Option<String> {
    std::fs::read_to_string(state_path(&app, &name)?).ok()
}

#[tauri::command]
fn save_state(app: AppHandle, name: String, text: String) -> bool {
    let Some(path) = state_path(&app, &name) else { return false };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // Write to a temp file first, so a crash never leaves half a file.
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, text).is_ok() && std::fs::rename(&tmp, &path).is_ok()
}

fn index_of(window: &WebviewWindow) -> usize {
    window.label().strip_prefix("overlay-").and_then(|n| n.parse().ok()).unwrap_or(0)
}

#[tauri::command]
async fn read_sensors() -> Sensors {
    Sensors {
        windows: sensors::windows("felinquent"),
        idle_sec: sensors::idle_sec(),
        since_key_sec: sensors::since_key_sec(),
        mic_in_use: sensors::mic_in_use(),
        camera_in_use: sensors::camera_in_use(),
    }
}

#[tauri::command]
async fn read_layout(window: WebviewWindow) -> Layout {
    let displays = sensors::displays();
    let main = displays.first().cloned().unwrap_or(sensors::Display { x: 0.0, y: 0.0, w: 1440.0, h: 900.0 });
    let dock_top = match window.primary_monitor() {
        Ok(Some(m)) => {
            let scale = m.scale_factor();
            let wa = m.work_area();
            (wa.position.y as f64 + wa.size.height as f64) / scale
        }
        _ => main.h - 40.0,
    };
    Layout { index: index_of(&window), displays, dock_top }
}

/// Where the real cursor is, in global points (top-left of the main display is 0,0),
/// and whether the primary mouse button is down. Read only.
#[tauri::command]
async fn read_pointer() -> Pointer {
    let (x, y, down) = sensors::pointer();
    Pointer { x, y, down }
}

/// true: clicks pass through to whatever is below. false: the cat catches them.
#[tauri::command]
async fn set_click_through(window: WebviewWindow, on: bool) {
    let _ = window.set_ignore_cursor_events(on);
}

#[tauri::command]
fn read_config() -> Config {
    Config {
        demo: std::env::var("FELINQUENT_DEMO").is_ok(),
        debug: std::env::var("FELINQUENT_DEBUG").is_ok(),
        brain: std::env::var("FELINQUENT_BRAIN").unwrap_or_else(|_| "auto".into()),
        // Local only. The page refuses anything that is not localhost.
        ollama_url: std::env::var("FELINQUENT_OLLAMA_URL").unwrap_or_else(|_| "http://localhost:11434".into()),
        ollama_model: std::env::var("FELINQUENT_OLLAMA_MODEL").unwrap_or_else(|_| "gemma3:1b".into()),
    }
}

/// Lets the page report what the cat is doing, so a run can be checked without a screenshot.
#[tauri::command]
fn debug_log(line: String) {
    println!("[overlay] {line}");
    logfile::write(&line);
}

/// Sends a control message (panic, shoo, chaos level) to the window that runs the cat.
fn control(app: &AppHandle, msg: &str) {
    logfile::write(&format!("menu: {msg}"));
    let _ = app.emit_to("overlay", "ctl", msg.to_string());
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let panic = MenuItem::with_id(app, "panic", "Panic: hide the cat (Cmd+Opt+Shift+P)", true, None::<&str>)?;
    let shoo = MenuItem::with_id(app, "shoo", "Shoo for 1 hour", true, None::<&str>)?;
    let unshoo = MenuItem::with_id(app, "unshoo", "Call the cat back (end shoo)", true, None::<&str>)?;
    let chaos = Submenu::with_items(
        app,
        "Chaos level",
        true,
        &[
            &MenuItem::with_id(app, "chaos:chill", "Chill", true, None::<&str>)?,
            &MenuItem::with_id(app, "chaos:normal", "Normal", true, None::<&str>)?,
            &MenuItem::with_id(app, "chaos:gremlin", "Gremlin", true, None::<&str>)?,
        ],
    )?;
    // Keep this list in step with src/core/characters.ts (a test checks it).
    let character = Submenu::with_items(
        app,
        "Character",
        true,
        &[
            &MenuItem::with_id(app, "character:tabby", "Tabby (orange cat)", true, None::<&str>)?,
            &MenuItem::with_id(app, "character:inky", "Inky (black cat)", true, None::<&str>)?,
            &MenuItem::with_id(app, "character:pearl", "Pearl (white cat)", true, None::<&str>)?,
            &MenuItem::with_id(app, "character:mochi", "Mochi (fox)", true, None::<&str>)?,
            &MenuItem::with_id(app, "character:bandit", "Bandit (raccoon)", true, None::<&str>)?,
            &MenuItem::with_id(app, "character:biscuit", "Biscuit (puppy)", true, None::<&str>)?,
        ],
    )?;
    let treat = MenuItem::with_id(app, "treat", "Give a treat", true, None::<&str>)?;
    let forget = MenuItem::with_id(app, "forget", "Forget everything it learned", true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "logs", "Open logs folder", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Felinquent", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&treat, &character, &chaos, &panic, &shoo, &unshoo, &PredefinedMenuItem::separator(app)?, &forget, &logs, &quit])?;
    let mut tray = TrayIconBuilder::new().menu(&menu).tooltip("Felinquent");
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, event| match event.id().as_ref() {
        "quit" => app.exit(0),
        "logs" => logfile::open_folder(),
        other => control(app, other),
    })
    .build(app)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn tune_ns_window(window: &WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior as B};
    if let Ok(ptr) = window.ns_window() {
        // SAFETY: Tauri hands us the live NSWindow of this webview window.
        let ns: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
        // Above the Dock (level 20) so the cat can lie on it, below the menu bar level.
        ns.setLevel(21);
        ns.setHasShadow(false);
        ns.setCollectionBehavior(
            B::CanJoinAllSpaces | B::Stationary | B::FullScreenAuxiliary | B::IgnoresCycle,
        );
    }
}

/// Puts the window exactly over a display. Setting the position the normal way makes macOS
/// push the window below the menu bar of the display above, so the frame is set directly.
#[cfg(target_os = "macos")]
fn set_exact_frame(w: &WebviewWindow, d: &sensors::Display) {
    use objc2_app_kit::NSWindow;
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    let main_h = sensors::displays().first().map(|m| m.h).unwrap_or(d.h);
    if let Ok(ptr) = w.ns_window() {
        // SAFETY: Tauri hands us the live NSWindow of this webview window.
        let ns: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
        // Cocoa's y runs up from the bottom of the main display.
        let frame = NSRect::new(NSPoint::new(d.x, main_h - (d.y + d.h)), NSSize::new(d.w, d.h));
        ns.setFrame_display(frame, true);
    }
}

fn fit_to(w: &WebviewWindow, d: &sensors::Display) {
    #[cfg(not(windows))]
    {
        let _ = w.set_position(LogicalPosition::new(d.x, d.y));
        let _ = w.set_size(LogicalSize::new(d.w, d.h));
    }
    // On Windows the sensors divide pixels by the main display's scale, so multiply it back.
    #[cfg(windows)]
    {
        let s = w.scale_factor().unwrap_or(1.0);
        let _ = w.set_position(tauri::PhysicalPosition::new((d.x * s).round() as i32, (d.y * s).round() as i32));
        let _ = w.set_size(tauri::PhysicalSize::new((d.w * s).round() as u32, (d.h * s).round() as u32));
    }
    #[cfg(target_os = "macos")]
    set_exact_frame(w, d);
    let _ = w.set_ignore_cursor_events(true);
    let _ = w.set_focusable(false);
    #[cfg(target_os = "macos")]
    tune_ns_window(w);
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        control(app, "panic");
                    }
                })
                .build(),
        )
        .on_page_load(|_w, payload| println!("[overlay] page {:?} {}", payload.event(), payload.url()))
        .setup(|app| {
            // A background app: no Dock icon, no menu bar, never the frontmost app.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            build_tray(app)?;
            // The panic hotkey. A listener only: it never sends keys to anything.
            if let Err(e) = app.global_shortcut().register("CmdOrCtrl+Alt+Shift+P") {
                println!("[overlay] could not register the panic hotkey: {e}");
            }

            // One overlay window per display. The first (main display) runs the cat,
            // the others only draw it when it is on their screen.
            let displays = sensors::displays();
            for (i, d) in displays.iter().enumerate() {
                let w = if i == 0 {
                    app.get_webview_window("overlay").expect("overlay window")
                } else {
                    WebviewWindowBuilder::new(app, format!("overlay-{i}"), WebviewUrl::App("overlay.html".into()))
                        .title("Felinquent overlay")
                        .transparent(true)
                        .decorations(false)
                        .always_on_top(true)
                        .visible_on_all_workspaces(true)
                        .skip_taskbar(true)
                        .focused(false)
                        .shadow(false)
                        .resizable(false)
                        .build()?
                };
                fit_to(&w, d);
                println!("[overlay] window {} on display {:.0},{:.0} {:.0}x{:.0}", w.label(), d.x, d.y, d.w, d.h);
            }

            // FELINQUENT_SELFTEST=1 plays the menu messages once, so the page's handlers can be checked without clicking.
            if std::env::var("FELINQUENT_SELFTEST").is_ok() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    for (secs, msg) in [(12, "character:mochi"), (3, "treat"), (3, "panic"), (4, "panic"), (3, "chaos:chill"), (3, "character:biscuit"), (3, "shoo")] {
                        std::thread::sleep(std::time::Duration::from_secs(secs));
                        control(&handle, msg);
                    }
                });
            }

            // The app is activated once while it launches. Hand the focus back right after,
            // so whatever the user was typing in keeps getting the keys.
            #[cfg(target_os = "macos")]
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    for _ in 0..4 {
                        std::thread::sleep(std::time::Duration::from_millis(400));
                        let _ = handle.run_on_main_thread(|| {
                            use objc2::MainThreadMarker;
                            use objc2_app_kit::NSApplication;
                            if let Some(mtm) = MainThreadMarker::new() {
                                NSApplication::sharedApplication(mtm).deactivate();
                            }
                        });
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_sensors,
            read_layout,
            read_pointer,
            set_click_through,
            read_config,
            load_state,
            save_state,
            debug_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running Felinquent");
}
