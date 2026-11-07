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
    /// A video playing or a presentation running keeps the display awake.
    display_awake: bool,
    space: Option<sensors::Space>,
}

/// Only the windows and the desktop: read every frame while a window is being dragged.
#[derive(Serialize)]
struct Windows {
    windows: Vec<sensors::Win>,
    space: Option<sensors::Space>,
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
        display_awake: sensors::display_kept_awake(),
        space: space_now(),
    }
}

/// The desktop showing, and whether the cat's window can be shown on it (not on a full-screen
/// app unless the overlay follows you from Space to Space).
fn space_now() -> Option<sensors::Space> {
    let mut s = sensors::space()?;
    #[cfg(target_os = "macos")]
    {
        s.hidden = s.app && !follows_spaces();
    }
    Some(s)
}

/// The windows and the desktop only, cheap enough for every frame while a window moves, so what
/// stands on it rides along in real time.
#[tauri::command]
async fn read_windows() -> Windows {
    Windows { windows: sensors::windows("felinquent"), space: space_now() }
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

/// The page has drawn the desktop it moved to after the switch `turn`: show the windows again.
#[tauri::command]
async fn overlay_reveal(app: AppHandle, turn: u64) {
    #[cfg(target_os = "macos")]
    {
        if std::env::var_os("FELINQUENT_SPACES_DEBUG").is_some() {
            logfile::write(&format!("spaces: the page drew the new desktop ({turn}), the overlay shows again"));
        }
        reveal(&app, turn);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, turn);
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
const CHARACTERS: [(&str, &str); 9] = [
    ("character:tabby", "Tabby (orange cat)"),
    ("character:inky", "Inky (black cat)"),
    ("character:pearl", "Pearl (white cat)"),
    ("character:mochi", "Mochi (fox)"),
    ("character:bandit", "Bandit (raccoon)"),
    ("character:biscuit", "Biscuit (puppy)"),
    ("character:chili", "Chili (chihuahua)"),
    ("character:clover", "Clover (rabbit)"),
    ("character:hazel", "Hazel (squirrel)"),
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
    // Drops its toy at the cursor (it comes out of hiding if it was buried). You can also drag it.
    let toy = MenuItem::with_id(app, "toy", "Throw its toy", true, None::<&str>)?;
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
    items.extend([&line1 as &dyn IsMenuItem<Wry>, &treat, &toy, &character, &chaos, &panic, &shoo, &line2, &model]);
    #[cfg(target_os = "macos")]
    items.extend([&login as &dyn IsMenuItem<Wry>, &autoupdate]);
    items.extend([&line3 as &dyn IsMenuItem<Wry>, &forget, &logs, &quit]);
    let menu = Menu::with_items(app, &items)?;

    app.manage(Ticks { picks: [characters, chaos_levels].concat(), panic: panic.clone(), shoo: shoo.clone(), model: model.clone() });
    // The model setup shows its progress in this item's text.
    #[cfg(target_os = "macos")]
    ollama::menu_item(app, &model);

    // The tabby's head in colour (tools/build-icons.py), drawn 18 points tall in the menu bar.
    let tray = TrayIconBuilder::new().menu(&menu).tooltip("Felinquent").icon(tauri::include_image!("icons/tray.png"));
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
        if follows_spaces() {
            // It goes to the Space you're on, full-screen apps included, when it's put in front
            // (follow_spaces does that on every switch).
            ns.setCollectionBehavior(B::MoveToActiveSpace | B::FullScreenAuxiliary | B::IgnoresCycle);
            make_panel(ns);
            ns.orderFrontRegardless();
        } else {
            // On every desktop at once. macOS doesn't show a window like this on a full-screen app.
            ns.setCollectionBehavior(B::CanJoinAllSpaces | B::Stationary | B::FullScreenAuxiliary | B::IgnoresCycle);
        }
    }
}

/// The overlay windows are non-activating panels that go to whichever Space you're on, so the cat
/// shows on full-screen apps too. A plain window on every desktop at once is left off those by
/// macOS, and moving to the active Space alone doesn't get it there either: it takes both (tried
/// live on 6 Nov 2026). FELINQUENT_PANEL=off goes back to the plain window on every desktop.
#[cfg(target_os = "macos")]
fn follows_spaces() -> bool {
    std::env::var("FELINQUENT_PANEL").as_deref() != Ok("off")
}

/// Watches which Space each display shows and puts the overlay windows in front on every switch,
/// which moves them to that Space (they're MoveToActiveSpace). A switch shows up within 150 ms.
/// The windows come over still showing the last picture the page drew, the animal where it was on
/// the old desktop, until the page catches up (Abozar saw it there for a moment, then gone, 7 Nov
/// 2026). So they come over see-through, and the page shows them again once it has drawn the new
/// desktop (overlay_reveal), or after 1.2 s whatever happens.
#[cfg(target_os = "macos")]
fn follow_spaces(app: &AppHandle) {
    use std::sync::atomic::Ordering;
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut last = sensors::current_spaces();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(150));
            let now = sensors::current_spaces();
            if now == last {
                continue;
            }
            last = now;
            let turn = SWITCHES.fetch_add(1, Ordering::SeqCst) + 1;
            let h = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                for (_, w) in h.webview_windows() {
                    if let Ok(ptr) = w.ns_window() {
                        // SAFETY: Tauri hands us the live NSWindow; we're on the main thread.
                        let ns: &objc2_app_kit::NSWindow = unsafe { &*(ptr as *mut objc2_app_kit::NSWindow) };
                        ns.setAlphaValue(0.0);
                        ns.orderFrontRegardless();
                    }
                }
                let _ = h.emit("space-switch", turn);
                if std::env::var_os("FELINQUENT_SPACES_DEBUG").is_some() {
                    logfile::write(&format!("spaces: switched ({turn}), the overlay follows, hidden until the page has drawn"));
                }
            });
            let h = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1200));
                if SWITCHES.load(Ordering::SeqCst) == turn && REVEALED.load(Ordering::SeqCst) < turn {
                    logfile::write("spaces: the page didn't answer in time, the overlay shows again anyway");
                    reveal(&h, turn);
                }
            });
        }
    });
}

/// How many Space switches there have been, and the last one the overlay was shown again after.
#[cfg(target_os = "macos")]
static SWITCHES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
#[cfg(target_os = "macos")]
static REVEALED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Makes the overlay windows visible again after the switch `turn`.
#[cfg(target_os = "macos")]
fn reveal(app: &AppHandle, turn: u64) {
    use std::sync::atomic::Ordering;
    REVEALED.fetch_max(turn, Ordering::SeqCst);
    let h = app.clone();
    let _ = app.run_on_main_thread(move || {
        for (_, w) in h.webview_windows() {
            if let Ok(ptr) = w.ns_window() {
                // SAFETY: Tauri hands us the live NSWindow; we're on the main thread.
                let ns: &objc2_app_kit::NSWindow = unsafe { &*(ptr as *mut objc2_app_kit::NSWindow) };
                ns.setAlphaValue(1.0);
            }
        }
    });
}

/// Turns an overlay window into a non-activating panel. macOS only shows a panel like that on top
/// of another app's full-screen Space; a plain window, even one that joins every Space, stays off
/// those, so the cat could never come to a desktop that is a full-screen app. A click on a panel
/// like this also never brings Felinquent to the front. The window object stays the same: its class
/// is swapped for a subclass of NSPanel (made once, at run time), which adds no instance variables.
#[cfg(target_os = "macos")]
fn make_panel(ns: &objc2_app_kit::NSWindow) {
    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder};
    use objc2_app_kit::NSWindowStyleMask;
    let obj: &AnyObject = ns;
    let Some(panel) = AnyClass::get(c"NSPanel") else { return };
    let class = match AnyClass::get(c"FelinquentPanel") {
        Some(c) => c,
        None => match ClassBuilder::new(c"FelinquentPanel", panel) {
            Some(b) => b.register(),
            None => return,
        },
    };
    if obj.class() != class {
        // Only when the panel needs no more room than the window already has.
        if class.instance_size() > obj.class().instance_size() {
            logfile::write(&format!("overlay: not a panel (sizes {} > {})", class.instance_size(), obj.class().instance_size()));
            return;
        }
        // SAFETY: the object is an NSWindow (its class a subclass of NSWindow without extra state we
        // rely on), NSPanel is an NSWindow subclass, and the new class is no bigger than the old one.
        unsafe { AnyObject::set_class(obj, class) };
        logfile::write("overlay: the window is a panel now, so it shows on full-screen Spaces too");
    }
    ns.setStyleMask(ns.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    // A panel hides when its app isn't in front, and this app never is.
    ns.setHidesOnDeactivate(false);
    // A window joins the Spaces it may be on when it is put on screen, so put it on screen again.
    ns.orderFrontRegardless();
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

            #[cfg(target_os = "macos")]
            if follows_spaces() {
                follow_spaces(app.handle());
            }

            // FELINQUENT_SPACES_DEBUG=1 logs, every 3 s, how macOS sees each overlay window (which
            // Space, covered or not), to check that the cat can show on every desktop.
            #[cfg(target_os = "macos")]
            if std::env::var("FELINQUENT_SPACES_DEBUG").is_ok() {
                let handle = app.handle().clone();
                let mut tick = 0u32;
                std::thread::spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    tick += 1;
                    let h = handle.clone();
                    let step = tick;
                    let _ = handle.run_on_main_thread(move || {
                        use objc2::runtime::AnyObject;
                        use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior as B, NSWindowOcclusionState};
                        for (label, w) in h.webview_windows() {
                            let Ok(ptr) = w.ns_window() else { continue };
                            // SAFETY: Tauri hands us the live NSWindow; read-only getters on the main thread.
                            let ns: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
                            if std::env::var("FELINQUENT_SPACES_TRY").is_ok() {
                                let what = match step {
                                    2 => { ns.orderFrontRegardless(); "front again" }
                                    3 => { ns.setLevel(25); ns.orderFrontRegardless(); "level 25" }
                                    4 => { ns.setLevel(1000); ns.orderFrontRegardless(); "level 1000" }
                                    5 => { ns.setCollectionBehavior(B::CanJoinAllSpaces | B::FullScreenAuxiliary | B::IgnoresCycle); ns.orderFrontRegardless(); "no stationary" }
                                    6 => { ns.setCollectionBehavior(B::MoveToActiveSpace | B::FullScreenAuxiliary | B::IgnoresCycle); ns.orderFrontRegardless(); "move to active space" }
                                    7 => { ns.orderOut(None); ns.orderFrontRegardless(); "out and in" }
                                    _ => "",
                                };
                                if !what.is_empty() { logfile::write(&format!("spaces: try {what}")); }
                            }
                            let obj: &AnyObject = ns;
                            logfile::write(&format!(
                                "spaces: {label} class={} onActiveSpace={} visible={} occlusionVisible={} level={} behavior={:#x} style={:#x}",
                                obj.class().name().to_string_lossy(),
                                ns.isOnActiveSpace(),
                                ns.isVisible(),
                                ns.occlusionState().contains(NSWindowOcclusionState::Visible),
                                ns.level(),
                                ns.collectionBehavior().0,
                                ns.styleMask().0,
                            ));
                        }
                    });
                });
            }

            // FELINQUENT_SELFTEST=1 plays the menu messages once, so the page's handlers can be checked without clicking.
            if std::env::var("FELINQUENT_SELFTEST").is_ok() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    for (secs, msg) in [(12, "character:mochi"), (3, "treat"), (3, "toy"), (3, "panic"), (4, "panic"), (3, "chaos:chill"), (3, "model"), (3, "model"), (3, "character:biscuit"), (3, "shoo")] {
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
            read_windows,
            read_layout,
            read_pointer,
            set_click_through,
            overlay_reveal,
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
