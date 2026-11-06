//! Felinquent overlay spike: a transparent, click-through window over every display
//! that shows the cat, with real Mac sensors behind it (spikes S-1 and S-2).
#[cfg(target_os = "macos")]
mod alert;
mod logfile;
#[cfg(target_os = "macos")]
mod login;
#[cfg(target_os = "macos")]
mod ollama;
mod sensors;
#[cfg(target_os = "macos")]
mod update;

use serde::{Deserialize, Serialize};
#[cfg(not(windows))]
use tauri::{LogicalPosition, LogicalSize};
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};
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

/// What the page says is current, so the menu can tick it.
#[derive(Deserialize)]
struct Choices {
    character: String,
    chaos: String,
    model: bool,
    panic: bool,
    shoo: bool,
}

/// The menu items that carry a tick. The page owns the state and the menu only shows it.
struct Ticks {
    /// Character and chaos level: one tick in each group.
    picks: Vec<CheckMenuItem<Wry>>,
    panic: CheckMenuItem<Wry>,
    shoo: CheckMenuItem<Wry>,
    model: CheckMenuItem<Wry>,
}

/// The page calls this after every change, so the ticks match what the cat really does.
#[tauri::command]
async fn show_choices(app: AppHandle, choices: Choices) {
    let Some(t) = app.try_state::<Ticks>() else { return };
    let current = [format!("character:{}", choices.character), format!("chaos:{}", choices.chaos)];
    for item in &t.picks {
        let _ = item.set_checked(current.iter().any(|c| c == item.id().as_ref()));
    }
    let _ = t.panic.set_checked(choices.panic);
    let _ = t.shoo.set_checked(choices.shoo);
    let _ = t.model.set_checked(choices.model);
    // Read the ticks back from the menu itself, so the log shows what the user sees.
    let on: Vec<String> = t.picks.iter().chain([&t.panic, &t.shoo, &t.model]).filter(|i| i.is_checked().unwrap_or(false)).map(|i| i.id().as_ref().to_string()).collect();
    logfile::write(&format!("menu ticks: {}", on.join(" ")));
}

/// Builds before 0.1.0 used the identifier app.felinquent.spike. Bring their settings and memory along once.
fn move_old_state(app: &AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else { return };
    let Some(old) = dir.parent().map(|p| p.join("app.felinquent.spike")) else { return };
    if dir.exists() || !old.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(&dir);
    for name in ["settings.json", "memory.json"] {
        let _ = std::fs::copy(old.join(name), dir.join(name));
    }
    logfile::write("moved settings and memory from the old app folder");
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

/// The local model's address and name. Local only: the page and the model setup refuse anything that is not localhost.
fn ollama_target() -> (String, String) {
    (
        std::env::var("FELINQUENT_OLLAMA_URL").unwrap_or_else(|_| "http://localhost:11434".into()),
        std::env::var("FELINQUENT_OLLAMA_MODEL").unwrap_or_else(|_| "gemma3:1b".into()),
    )
}

#[tauri::command]
fn read_config() -> Config {
    let (ollama_url, ollama_model) = ollama_target();
    Config {
        demo: std::env::var("FELINQUENT_DEMO").is_ok(),
        debug: std::env::var("FELINQUENT_DEBUG").is_ok(),
        brain: std::env::var("FELINQUENT_BRAIN").unwrap_or_else(|_| "auto".into()),
        ollama_url,
        ollama_model,
    }
}

/// Helps the user get Ollama and the model when the local model is turned on and isn't there
/// (macOS, see ollama.rs). `reason` is "no-ollama", "not-running" or "no-model". Returns at once:
/// true when a setup started. The result comes later as the `ctl` message "model-ready" or
/// "model-failed". Elsewhere it does nothing.
#[tauri::command]
async fn model_setup(app: AppHandle, reason: String, model: String, url: String) -> bool {
    #[cfg(target_os = "macos")]
    return ollama::setup(app, &reason, model, url);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, reason, model, url);
        false
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

// Keep this list in step with src/core/characters.ts (a test checks it).
const CHARACTERS: [(&str, &str); 6] = [
    ("character:tabby", "Tabby (orange cat)"),
    ("character:inky", "Inky (black cat)"),
    ("character:pearl", "Pearl (white cat)"),
    ("character:mochi", "Mochi (fox)"),
    ("character:bandit", "Bandit (raccoon)"),
    ("character:biscuit", "Biscuit (puppy)"),
];
const CHAOS: [(&str, &str); 3] = [("chaos:chill", "Chill"), ("chaos:normal", "Normal"), ("chaos:gremlin", "Gremlin")];

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    // Every tick starts off. The page sends what is current as soon as it has loaded its settings.
    let check = |id: &str, text: &str| CheckMenuItem::with_id(app, id, text, true, false, None::<&str>);
    let group = |items: &[(&str, &str)]| items.iter().map(|(id, text)| check(id, text)).collect::<tauri::Result<Vec<_>>>();
    fn as_items(v: &[CheckMenuItem<Wry>]) -> Vec<&dyn IsMenuItem<Wry>> {
        v.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect()
    }
    let characters = group(&CHARACTERS)?;
    let chaos_levels = group(&CHAOS)?;
    let character = Submenu::with_items(app, "Character", true, &as_items(&characters))?;
    let chaos = Submenu::with_items(app, "Chaos level", true, &as_items(&chaos_levels))?;

    let version = MenuItem::with_id(app, "version", format!("Felinquent {}", app.package_info().version), false, None::<&str>)?;
    let treat = MenuItem::with_id(app, "treat", "Give a treat", true, None::<&str>)?;
    let panic = check("panic", "Panic: hide the cat (Cmd+Opt+Shift+P)")?;
    let shoo = check("shoo", "Shoo for 1 hour")?;
    let model = check("model", "Use the local model (needs Ollama)")?;
    #[cfg(target_os = "macos")]
    let login = CheckMenuItem::with_id(app, "login", "Start at login", true, login::is_on(), None::<&str>)?;
    #[cfg(target_os = "macos")]
    let (update, autoupdate) = update::menu_items(app)?;
    let forget = MenuItem::with_id(app, "forget", "Forget everything it learned", true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "logs", "Open logs folder", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Felinquent", true, None::<&str>)?;
    let line = || PredefinedMenuItem::separator(app);
    let (line1, line2, line3) = (line()?, line()?, line()?);

    let mut items: Vec<&dyn IsMenuItem<Wry>> = vec![&version];
    #[cfg(target_os = "macos")]
    items.push(&update);
    items.extend([&line1 as &dyn IsMenuItem<Wry>, &treat, &character, &chaos, &panic, &shoo, &line2, &model]);
    #[cfg(target_os = "macos")]
    items.extend([&login as &dyn IsMenuItem<Wry>, &autoupdate]);
    items.extend([&line3 as &dyn IsMenuItem<Wry>, &forget, &logs, &quit]);
    let menu = Menu::with_items(app, &items)?;

    app.manage(Ticks { picks: [characters, chaos_levels].concat(), panic: panic.clone(), shoo: shoo.clone(), model: model.clone() });
    // The model setup shows its progress in this item's text.
    #[cfg(target_os = "macos")]
    ollama::menu_item(app, &model);

    let mut tray = TrayIconBuilder::new().menu(&menu).tooltip("Felinquent");
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(move |app, event| match event.id().as_ref() {
        "quit" => app.exit(0),
        "logs" => logfile::open_folder(),
        #[cfg(target_os = "macos")]
        "login" => {
            let on = login::set(!login::is_on());
            let _ = login.set_checked(on);
            logfile::write(&format!("menu: start at login {}", if on { "on" } else { "off" }));
        }
        #[cfg(target_os = "macos")]
        id @ ("update" | "autoupdate") => update::on_menu(app, id),
        // The rest is the page's business. It answers with show_choices, which moves the ticks.
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
    let builder = tauri::Builder::default();
    // Signed updates from GitHub Releases (macOS only for now). See update.rs.
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    builder
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

            move_old_state(app.handle());
            build_tray(app)?;
            #[cfg(target_os = "macos")]
            update::start(app.handle());
            #[cfg(target_os = "macos")]
            ollama::start(app.handle());
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
                    for (secs, msg) in [(12, "character:mochi"), (3, "treat"), (3, "panic"), (4, "panic"), (3, "chaos:chill"), (3, "model"), (3, "model"), (3, "character:biscuit"), (3, "shoo")] {
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
            show_choices,
            debug_log,
            model_setup
        ])
        .run(tauri::generate_context!())
        .expect("error while running Felinquent");
}
