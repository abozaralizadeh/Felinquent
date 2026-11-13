//! Felinquent overlay: a transparent, click-through window over every display that shows the
//! cat, with real sensors behind it (macOS and Windows; spikes S-1 and S-2, ADR-060).
// A GUI app on Windows: without this a release build opens a console window next to the cat.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
#[cfg(any(target_os = "macos", windows))]
mod about;
mod alert;
mod characters;
mod logfile;
#[cfg(any(target_os = "macos", windows))]
mod login;
#[cfg(any(target_os = "macos", windows))]
mod ollama;
#[cfg(any(target_os = "macos", windows))]
mod report;
mod sensors;
#[cfg(any(target_os = "macos", windows))]
mod update;
#[cfg(any(target_os = "macos", windows))]
mod usage;
#[cfg(windows)]
mod winui;

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
    /// Each display's own desktop, when displays have separate desktops (the Mac's default).
    spaces: Vec<sensors::DisplaySpace>,
}

/// Only the windows and the desktop: read every frame while a window is being dragged.
#[derive(Serialize)]
struct Windows {
    windows: Vec<sensors::Win>,
    space: Option<sensors::Space>,
    spaces: Vec<sensors::DisplaySpace>,
}

#[derive(Serialize)]
struct Layout {
    /// Which display this window covers (0 is the main display).
    index: usize,
    /// All displays in global points. The main display comes first.
    displays: Vec<sensors::Display>,
    /// Top of the Dock on the main display, in points.
    dock_top: f64,
    /// Windows: the main display's scale. Points are its pixels over this, on every display, so a
    /// page on a display with another scale draws by this over its own devicePixelRatio. 0 on the
    /// Mac, where points are the page's own pixels on every display.
    scale: f64,
}

#[derive(Serialize)]
struct Pointer {
    x: f64,
    y: f64,
    down: bool,
    /// The right button: a right-click on the animal opens its menu.
    right: bool,
}

#[derive(Serialize)]
struct Config {
    demo: bool,
    /// Shows the red "clicks blocked" box.
    debug: bool,
    /// "auto", "rules" or "ollama".
    brain: String,
    ollama_url: String,
    /// The model to use when nothing was picked in the menu (gemma3:1b, or FELINQUENT_OLLAMA_MODEL).
    ollama_model: String,
    /// FELINQUENT_OLLAMA_MODEL is set: it wins over the model picked in the menu (for test runs).
    ollama_model_env: bool,
    /// How long one model answer may take, in ms (FELINQUENT_LLM_TIMEOUT_MS, 8000 unless set; for
    /// slow test machines and demo recordings).
    llm_timeout_ms: u32,
}

/// What the page says is current, so the menu can tick it.
#[derive(Deserialize, Clone)]
struct Choices {
    character: String,
    chaos: String,
    model: bool,
    panic: bool,
    shoo: bool,
    /// The local model it uses, and the models Ollama has (empty when Ollama doesn't answer).
    #[serde(default)]
    llm: String,
    #[serde(default)]
    models: Vec<String>,
    /// "Hide from screen sharing" is on.
    #[serde(default)]
    hide_share: bool,
    /// Characters from packages the page could read (ADR-069).
    #[serde(default)]
    packs: Vec<Pack>,
}

#[derive(Deserialize, Clone, PartialEq)]
struct Pack {
    id: String,
    name: String,
}

/// The menu items that carry a tick. The page owns the state and the menu only shows it.
struct Ticks {
    /// Character and chaos level: one tick in each group.
    picks: Vec<CheckMenuItem<Wry>>,
    panic: CheckMenuItem<Wry>,
    shoo: CheckMenuItem<Wry>,
    model: CheckMenuItem<Wry>,
    hide_share: CheckMenuItem<Wry>,
    /// "Model": one item per model Ollama has, rebuilt when that list changes (`listed`).
    llm: Submenu<Wry>,
    listed: std::sync::Mutex<Option<Vec<String>>>,
    /// "Character": the built-in ones, then the ones from packages, rebuilt when those change.
    character: Submenu<Wry>,
    packs: std::sync::Mutex<Option<Vec<Pack>>>,
}

/// The end of the Character submenu, after the built-in characters: the ones from packages, "Add a
/// character…" and "Remove a character" (ADR-069). Picking one sends `character:<id>` like the rest.
fn fill_packs(app: &AppHandle, menu: &Submenu<Wry>, packs: &[Pack]) -> tauri::Result<()> {
    for item in menu.items()?.into_iter().skip(CHARACTERS.len()) {
        menu.remove(&item)?;
    }
    for item in pack_items(app, packs, None)? {
        menu.append(item.as_ref())?;
    }
    Ok(())
}

/// The package part of a Character submenu (the tray's and the pet menu's).
fn pack_items(app: &AppHandle, packs: &[Pack], on: Option<&str>) -> tauri::Result<Vec<Box<dyn IsMenuItem<Wry>>>> {
    let packs: Vec<&Pack> = packs.iter().filter(|p| characters::id_ok(&p.id)).collect();
    let mut items: Vec<Box<dyn IsMenuItem<Wry>>> = vec![Box::new(PredefinedMenuItem::separator(app)?)];
    for p in &packs {
        let name = alert::short(&p.name, 24);
        items.push(Box::new(CheckMenuItem::with_id(app, format!("character:{}", p.id), name, true, on == Some(p.id.as_str()), None::<&str>)?));
    }
    if !packs.is_empty() {
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
    }
    items.push(Box::new(MenuItem::with_id(app, "addchar", "Add a character\u{2026}", true, None::<&str>)?));
    if !packs.is_empty() {
        let remove = Submenu::with_id(app, "removechars", "Remove a character", true)?;
        for p in &packs {
            remove.append(&MenuItem::with_id(app, format!("removechar:{}", p.id), alert::short(&p.name, 24), true, None::<&str>)?)?;
        }
        items.push(Box::new(remove));
    }
    Ok(items)
}

/// A model name as Ollama writes it (gemma3:1b, library/llama3.2:3b-instruct), nothing else.
fn model_name_ok(name: &str) -> bool {
    !name.is_empty() && name.len() <= 100 && name.chars().all(|c| c.is_ascii_alphanumeric() || "._:/-".contains(c))
}

/// Fills the Model submenu with the models Ollama has: picking one uses it (`llm:<name>`, the page
/// handles it). Any model the user pulled is there, not only the one the app suggests.
fn fill_models(app: &AppHandle, menu: &Submenu<Wry>, models: &[String]) -> tauri::Result<()> {
    for item in menu.items()? {
        menu.remove(&item)?;
    }
    let names: Vec<&String> = models.iter().filter(|m| model_name_ok(m)).collect();
    if names.is_empty() {
        menu.append(&MenuItem::with_id(app, "llm-none", "No models found. Is Ollama running?", false, None::<&str>)?)?;
    }
    for name in names {
        menu.append(&CheckMenuItem::with_id(app, format!("llm:{name}"), name, true, false, None::<&str>)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "llm-hint", "Get more with: ollama pull <name>", false, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "llm-hint2", "Small ones (1 to 4B) answer in time", false, None::<&str>)?)?;
    Ok(())
}

/// The last choices the page sent, for the menu a right-click on the animal opens.
struct Current(std::sync::Mutex<Option<Choices>>);

/// The page calls this after every change, so the ticks match what the cat really does.
#[tauri::command]
async fn show_choices(app: AppHandle, choices: Choices) {
    if let Some(c) = app.try_state::<Current>() {
        if let Ok(mut g) = c.0.lock() {
            *g = Some(choices.clone());
        }
    }
    let Some(t) = app.try_state::<Ticks>() else { return };
    let current = [format!("character:{}", choices.character), format!("chaos:{}", choices.chaos)];
    for item in &t.picks {
        let _ = item.set_checked(current.iter().any(|c| c == item.id().as_ref()));
    }
    let _ = t.panic.set_checked(choices.panic);
    let _ = t.shoo.set_checked(choices.shoo);
    let _ = t.model.set_checked(choices.model);
    let _ = t.hide_share.set_checked(choices.hide_share);
    // Characters from packages: the submenu's end is rebuilt only when they changed.
    if let Ok(mut shown) = t.packs.lock() {
        if shown.as_ref() != Some(&choices.packs) {
            match fill_packs(&app, &t.character, &choices.packs) {
                Ok(()) => *shown = Some(choices.packs.clone()),
                Err(e) => logfile::write(&format!("menu: characters: {e}")),
            }
        }
    }
    let picked = format!("character:{}", choices.character);
    let mut on_pack = None;
    for item in t.character.items().unwrap_or_default().into_iter().skip(CHARACTERS.len()) {
        if let Some(c) = item.as_check_menuitem() {
            let here = c.id().as_ref() == picked;
            let _ = c.set_checked(here);
            if here {
                on_pack = Some(picked.clone());
            }
        }
    }
    // The Model submenu: rebuilt only when Ollama's list changed, then the one in use ticked.
    if let Ok(mut listed) = t.listed.lock() {
        if listed.as_ref() != Some(&choices.models) {
            match fill_models(&app, &t.llm, &choices.models) {
                Ok(()) => *listed = Some(choices.models.clone()),
                Err(e) => logfile::write(&format!("menu: model list: {e}")),
            }
        }
    }
    let using = format!("llm:{}", choices.llm);
    let mut on_model = None;
    for item in t.llm.items().unwrap_or_default() {
        if let Some(c) = item.as_check_menuitem() {
            let here = c.id().as_ref() == using;
            let _ = c.set_checked(here);
            if here {
                on_model = Some(using.clone());
            }
        }
    }
    let _ = t.llm.set_text(if choices.llm.is_empty() { "Model".to_string() } else { format!("Model: {}", choices.llm) });
    // Read the ticks back from the menu itself, so the log shows what the user sees.
    let on: Vec<String> = t.picks.iter().chain([&t.panic, &t.shoo, &t.model, &t.hide_share]).filter(|i| i.is_checked().unwrap_or(false)).map(|i| i.id().as_ref().to_string()).chain(on_pack).chain(on_model).collect();
    logfile::write(&format!("menu ticks: {} (models: {})", on.join(" "), choices.models.len()));
}

/// Builds before 0.1.0 used the identifier app.felinquent.spike. Bring their settings and memory along once.
/// Start at login is on for a new install (ADR-066): the first time the app runs on this computer,
/// with nothing in its folder yet. Someone who has run it before keeps what they chose, so an
/// update never turns it back on. Debug builds leave it alone unless FELINQUENT_LOGIN_TEST is set.
#[cfg(any(target_os = "macos", windows))]
fn login_on_first_run(app: &AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else { return };
    let empty = |p: &std::path::Path| std::fs::read_dir(p).map(|mut d| d.next().is_none()).unwrap_or(true);
    let old = dir.parent().map(|p| p.join("app.felinquent.spike"));
    let fresh = empty(&dir) && old.as_deref().is_none_or(empty);
    if !fresh || (cfg!(debug_assertions) && std::env::var("FELINQUENT_LOGIN_TEST").is_err()) || login::is_on() {
        return;
    }
    let on = login::set(true);
    logfile::write(&format!("first run: start at login {}", if on { "on" } else { "couldn't be turned on" }));
}

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
    // The page is alive: the stall check in report.rs watches this.
    #[cfg(any(target_os = "macos", windows))]
    report::page_seen();
    Sensors {
        windows: sensors::windows("felinquent"),
        idle_sec: sensors::idle_sec(),
        since_key_sec: sensors::since_key_sec(),
        mic_in_use: sensors::mic_in_use(),
        camera_in_use: sensors::camera_in_use(),
        display_awake: sensors::display_kept_awake(),
        space: space_now(),
        spaces: spaces_now(),
    }
}

/// The desktop showing, and whether the cat's window can be shown on it (not on a full-screen
/// app unless the overlay follows you from Space to Space).
fn space_now() -> Option<sensors::Space> {
    let s = sensors::space()?;
    // Windows: the overlay is on every virtual desktop and over full-screen windows, never hidden.
    #[cfg(target_os = "macos")]
    let s = sensors::Space { hidden: s.app && !follows_spaces(), ..s };
    Some(s)
}

/// The desktop each display shows (when each has its own), hidden like `space_now`.
fn spaces_now() -> Vec<sensors::DisplaySpace> {
    let all = sensors::display_spaces();
    #[cfg(target_os = "macos")]
    let all = all.into_iter().map(|s| sensors::DisplaySpace { hidden: s.app && !follows_spaces(), ..s }).collect();
    all
}

/// The windows and the desktop only, cheap enough for every frame while a window moves, so what
/// stands on it rides along in real time.
#[tauri::command]
async fn read_windows() -> Windows {
    Windows { windows: sensors::windows("felinquent"), space: space_now(), spaces: spaces_now() }
}

#[tauri::command]
async fn read_layout(window: WebviewWindow) -> Layout {
    let displays = displays_now();
    let main = displays.first().cloned().unwrap_or(sensors::Display { x: 0.0, y: 0.0, w: 1440.0, h: 900.0 });
    let dock_top = match window.primary_monitor() {
        Ok(Some(m)) => {
            let scale = m.scale_factor();
            let wa = m.work_area();
            (wa.position.y as f64 + wa.size.height as f64) / scale
        }
        _ => main.h - 40.0,
    };
    #[cfg(windows)]
    let scale = sensors::scale();
    #[cfg(not(windows))]
    let scale = 0.0;
    Layout { index: index_of(&window), displays, dock_top, scale }
}

/// Where the real cursor is, in global points (top-left of the main display is 0,0),
/// and whether the primary mouse button is down. Read only.
#[tauri::command]
async fn read_pointer() -> Pointer {
    let (x, y, down) = sensors::pointer();
    Pointer { x, y, down, right: sensors::right_button() }
}

/// The version this was before, if it just updated itself (once), so the cat can say hello.
#[tauri::command]
fn just_updated(app: AppHandle) -> Option<String> {
    #[cfg(any(target_os = "macos", windows))]
    return update::just_updated(&app);
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = app;
        None
    }
}

/// A right-click on the animal: the handy part of the menu bar menu, right there at the cursor.
/// Same item ids as the menu bar menu, so the same handler answers them.
/// x and y (in the window, points) put it somewhere else than at the pointer (only the menu test does).
#[tauri::command]
async fn pet_menu(app: AppHandle, window: WebviewWindow, x: Option<f64>, y: Option<f64>) {
    let current = app.try_state::<Current>().and_then(|c| c.0.lock().ok().and_then(|g| g.clone()));
    match build_pet_menu(&app, current.as_ref()) {
        Ok(menu) => {
            logfile::write("pet menu: open");
            let shown = match (x, y) {
                (Some(x), Some(y)) => window.popup_menu_at(&menu, tauri::LogicalPosition::new(x, y)),
                _ => window.popup_menu(&menu),
            };
            if let Err(e) = shown {
                logfile::write(&format!("pet menu: {e}"));
            }
        }
        Err(e) => logfile::write(&format!("pet menu: {e}")),
    }
}

fn build_pet_menu(app: &AppHandle, cur: Option<&Choices>) -> tauri::Result<Menu<Wry>> {
    let on = |id: &str| match cur {
        Some(c) => id == format!("character:{}", c.character) || id == format!("chaos:{}", c.chaos) || (id == "panic" && c.panic) || (id == "shoo" && c.shoo),
        None => false,
    };
    let check = |id: &str, text: &str| CheckMenuItem::with_id(app, id, text, true, on(id), None::<&str>);
    let group = |items: &[(&str, &str)]| items.iter().map(|(id, text)| check(id, text)).collect::<tauri::Result<Vec<_>>>();
    fn as_items(v: &[CheckMenuItem<Wry>]) -> Vec<&dyn IsMenuItem<Wry>> {
        v.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect()
    }
    let characters = group(&CHARACTERS)?;
    let chaos_levels = group(&CHAOS)?;
    let character = Submenu::with_items(app, "Character", true, &as_items(&characters))?;
    let packs = cur.map(|c| c.packs.clone()).unwrap_or_default();
    for item in pack_items(app, &packs, cur.map(|c| c.character.as_str()))? {
        character.append(item.as_ref())?;
    }
    let chaos = Submenu::with_items(app, "Chaos level", true, &as_items(&chaos_levels))?;
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let treat = item("treat", "Give a treat")?;
    let toy = item("toy", "Throw its toy")?;
    let pet = item("pet", "Pet it")?;
    let zoomies = item("zoomies", "Zoomies!")?;
    let nap = item("nap", "Nap time")?;
    let shoo = check("shoo", "Shoo for 1 hour")?;
    let panic = check("panic", "Panic: hide the cat")?;
    let (line1, line2) = (PredefinedMenuItem::separator(app)?, PredefinedMenuItem::separator(app)?);
    Menu::with_items(app, &[&treat, &toy, &pet, &zoomies, &nap, &line1, &character, &chaos, &line2, &shoo, &panic])
}

/// true: clicks pass through to whatever is below. false: the cat catches them.
#[tauri::command]
async fn set_click_through(window: WebviewWindow, on: bool) {
    // On Windows Tauri's own call would drop the bits that keep the window on every desktop.
    #[cfg(windows)]
    winui::click_through(&window, on);
    #[cfg(not(windows))]
    let _ = window.set_ignore_cursor_events(on);
}

/// "Hide from screen sharing": the overlay windows are left out of screen shares, recordings and
/// screenshots, and show only on the screen itself. Returns true when the system really keeps them
/// out: Windows 10 2004 and later. On the Mac the flag is set too, but since macOS 15 the capture
/// most meeting apps use ignores it, so it returns false and the page sends the animal away during
/// a meeting instead.
#[tauri::command]
async fn set_hide_share(app: AppHandle, on: bool) -> bool {
    HIDE_SHARE.store(on, std::sync::atomic::Ordering::SeqCst);
    #[allow(unused_mut)]
    let mut kept_out = false;
    for (label, w) in app.webview_windows() {
        if !label.starts_with("overlay") {
            continue;
        }
        kept_out = hide_share(&w, on);
    }
    logfile::write(&format!("capture: hide from screen sharing {} ({})", if on { "on" } else { "off" }, if kept_out { "kept out of captures" } else if on { "leaves during meetings" } else { "shown in captures" }));
    kept_out
}

/// "Hide from screen sharing" is on: a window made later (a display plugged in) is kept out too.
static HIDE_SHARE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Keeps one overlay window out of captures, or lets it back in. true when the system really does.
fn hide_share(w: &WebviewWindow, on: bool) -> bool {
    #[cfg(windows)]
    return winui::hide_from_capture(w, on);
    #[cfg(not(windows))]
    {
        let _ = w.set_content_protected(on);
        false
    }
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
        ollama_model_env: std::env::var_os("FELINQUENT_OLLAMA_MODEL").is_some(),
        llm_timeout_ms: std::env::var("FELINQUENT_LLM_TIMEOUT_MS").ok().and_then(|v| v.parse().ok()).filter(|ms| (1000..=60000).contains(ms)).unwrap_or(8000),
    }
}

/// Helps the user get Ollama and the model when the local model is turned on and isn't there
/// (macOS and Windows, see ollama.rs). `reason` is "no-ollama", "not-running" or "no-model". Returns at once:
/// true when a setup started. The result comes later as the `ctl` message "model-ready" or
/// "model-failed". Elsewhere it does nothing.
#[tauri::command]
async fn model_setup(app: AppHandle, reason: String, model: String, url: String) -> bool {
    #[cfg(any(target_os = "macos", windows))]
    return ollama::setup(app, &reason, model, url);
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (app, reason, model, url);
        false
    }
}

/// The page's requests to the local Ollama (the model list, the cat's plans) on Windows, where
/// Ollama's CORS rules turn away the page's address. See `ollama::page_request`.
#[tauri::command]
async fn ollama_http(path: String, body: Option<String>, timeout_ms: Option<u64>) -> Result<(u16, String), String> {
    #[cfg(any(target_os = "macos", windows))]
    return ollama::page_request(&ollama_target().0, &path, body, timeout_ms).await;
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (path, body, timeout_ms);
        Err("the app can't reach the model on this system".into())
    }
}

/// Lets the page report what the cat is doing, so a run can be checked without a screenshot.
#[tauri::command]
fn debug_log(line: String) {
    println!("[overlay] {line}");
    logfile::write(&line);
}

/// Opens a web page in the default browser (the download page, ollama.com). Only fixed https
/// addresses from the code come here.
#[cfg(any(target_os = "macos", windows))]
pub fn open_url(url: &str) {
    if !url.starts_with("https://") {
        return;
    }
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("/usr/bin/open").arg(url).spawn();
    #[cfg(windows)]
    {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let wide: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
        let open: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            ShellExecuteW(None, PCWSTR(open.as_ptr()), PCWSTR(wide.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL);
        }
    }
}

/// Sends a control message (panic, shoo, chaos level) to the window that runs the cat.
fn control(app: &AppHandle, msg: &str) {
    logfile::write(&format!("menu: {msg}"));
    // The About window is the app's, not the page's (FELINQUENT_MENU_SCRIPT=2:version opens it too).
    if msg == "version" {
        about::show(app);
        return;
    }
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
    // "Add a character…" from the start; the page fills in the ones from packages (show_choices).
    fill_packs(app.handle(), &character, &[])?;
    let chaos = Submenu::with_items(app, "Chaos level", true, &as_items(&chaos_levels))?;

    // The version line opens the About window (ADR-062).
    let version = MenuItem::with_id(app, "version", format!("Felinquent {}\u{2026}", app.package_info().version), true, None::<&str>)?;
    let treat = MenuItem::with_id(app, "treat", "Give a treat", true, None::<&str>)?;
    // Drops its toy at the cursor (it comes out of hiding if it was buried). You can also drag it.
    let toy = MenuItem::with_id(app, "toy", "Throw its toy", true, None::<&str>)?;
    // The same asks as the menu on the animal (build_pet_menu).
    let pet = MenuItem::with_id(app, "pet", "Pet it", true, None::<&str>)?;
    let zoomies = MenuItem::with_id(app, "zoomies", "Zoomies!", true, None::<&str>)?;
    let nap = MenuItem::with_id(app, "nap", "Nap time", true, None::<&str>)?;
    let panic = check("panic", if cfg!(target_os = "macos") { "Panic: hide the cat (Cmd+Opt+Shift+P)" } else { "Panic: hide the cat (Ctrl+Alt+Shift+P)" })?;
    let shoo = check("shoo", "Shoo for 1 hour")?;
    let model = check("model", "Use the local model (needs Ollama)")?;
    // Kept out of screen shares (the page owns it, like the model switch).
    let hide_share = check("hideshare", "Hide from screen sharing")?;
    // Filled with the models Ollama has once the page has asked it (show_choices).
    let looking = MenuItem::with_id(app, "llm-none", "Looking for models\u{2026}", false, None::<&str>)?;
    let llm = Submenu::with_items(app, "Model", true, &[&looking])?;
    #[cfg(any(target_os = "macos", windows))]
    let login = CheckMenuItem::with_id(app, "login", "Start at login", true, login::is_on(), None::<&str>)?;
    #[cfg(any(target_os = "macos", windows))]
    let (update, autoupdate) = update::menu_items(app)?;
    // Error reports (ADR-064): asked once, then sent by themselves while this is ticked.
    #[cfg(any(target_os = "macos", windows))]
    let reports = report::menu_item(app)?;
    // Usage counts (ADR-065): on by default, anonymous, one ping a day while this is ticked.
    #[cfg(any(target_os = "macos", windows))]
    let usage = usage::menu_item(app)?;
    let forget = MenuItem::with_id(app, "forget", "Forget everything it learned", true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "logs", "Open logs folder", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Felinquent", true, None::<&str>)?;
    let line = || PredefinedMenuItem::separator(app);
    let (line1, line2, line3) = (line()?, line()?, line()?);

    let mut items: Vec<&dyn IsMenuItem<Wry>> = vec![&version];
    #[cfg(any(target_os = "macos", windows))]
    items.push(&update);
    items.extend([&line1 as &dyn IsMenuItem<Wry>, &treat, &toy, &pet, &zoomies, &nap, &character, &chaos, &panic, &shoo, &hide_share, &line2, &model, &llm]);
    #[cfg(any(target_os = "macos", windows))]
    items.extend([&login as &dyn IsMenuItem<Wry>, &autoupdate, &reports, &usage]);
    items.extend([&line3 as &dyn IsMenuItem<Wry>, &forget, &logs, &quit]);
    let menu = Menu::with_items(app, &items)?;

    app.manage(Current(std::sync::Mutex::new(None)));
    app.manage(Ticks { picks: [characters, chaos_levels].concat(), panic: panic.clone(), shoo: shoo.clone(), model: model.clone(), hide_share: hide_share.clone(), llm: llm.clone(), listed: std::sync::Mutex::new(None), character: character.clone(), packs: std::sync::Mutex::new(None) });
    // The model setup shows its progress in this item's text.
    #[cfg(any(target_os = "macos", windows))]
    ollama::menu_item(app, &model);

    // The tabby's head in colour (tools/build-icons.py), drawn 18 points tall in the menu bar.
    let tray = TrayIconBuilder::new().menu(&menu).tooltip("Felinquent").icon(tauri::include_image!("icons/tray.png"));
    tray.on_menu_event(move |app, event| match event.id().as_ref() {
        "quit" => app.exit(0),
        "logs" => logfile::open_folder(),
        "version" => about::show(app),
        #[cfg(any(target_os = "macos", windows))]
        "login" => {
            let on = login::set(!login::is_on());
            let _ = login.set_checked(on);
            logfile::write(&format!("menu: start at login {}", if on { "on" } else { "off" }));
        }
        #[cfg(any(target_os = "macos", windows))]
        id @ ("update" | "autoupdate") => update::on_menu(app, id),
        #[cfg(any(target_os = "macos", windows))]
        "reports" => report::on_menu(),
        #[cfg(any(target_os = "macos", windows))]
        "usage" => usage::on_menu(),
        "addchar" => characters::pick_and_add(app),
        id if id.starts_with("removechar:") => characters::remove(app, &id["removechar:".len()..]),
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

/// The overlay window over display i. The main display's (i = 0) runs the cat.
fn overlay_label(i: usize) -> String {
    if i == 0 { "overlay".into() } else { format!("overlay-{i}") }
}

/// The overlay window for display i, made when there isn't one yet (the main display's comes from
/// tauri.conf.json). Off the main thread too: Tauri hands the making over and waits for it.
fn overlay_window(app: &AppHandle, i: usize) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window(&overlay_label(i)) {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, overlay_label(i), WebviewUrl::App("overlay.html".into()))
        .title("Felinquent overlay")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .shadow(false)
        .resizable(false)
        .build()
}

/// The displays the overlay covers. FELINQUENT_DISPLAYS_TEST=<s> keeps to the main display for the
/// first s seconds, as if the others were plugged in then, to try watch_displays without a cable.
fn displays_now() -> Vec<sensors::Display> {
    static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    let all = sensors::displays();
    let hold = std::env::var("FELINQUENT_DISPLAYS_TEST").ok().and_then(|v| v.parse::<f64>().ok());
    match hold {
        Some(s) if START.get_or_init(std::time::Instant::now).elapsed().as_secs_f64() < s => all.into_iter().take(1).collect(),
        _ => all,
    }
}

/// The displays as a line for the log and to spot a change.
fn displays_line(all: &[sensors::Display]) -> String {
    all.iter().map(|d| format!("{:.0},{:.0} {:.0}x{:.0}", d.x, d.y, d.w, d.h)).collect::<Vec<_>>().join("; ")
}

/// Displays plugged in, unplugged or moved while it runs (a monitor at the desk in the morning, the
/// lid closed, the main display picked again): the overlay windows are made, moved or closed to
/// match, and the pages read the layout again (`layout-changed`). It used to be read once at launch,
/// and since it starts at login and updates itself it runs for days, so a monitor plugged in the
/// next morning got no animal and one dropped up there fell back to the laptop (13 Nov 2026).
fn watch_displays(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        let key = || {
            let line = displays_line(&displays_now());
            // On Windows the main display's scale changes every point, so it counts too.
            #[cfg(windows)]
            let line = format!("{line} @{:.2}", sensors::scale());
            line
        };
        let mut last = key();
        let mut maybe: Option<String> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let now = key();
            if now == last {
                maybe = None;
                continue;
            }
            // Displays take a moment to settle after a plug or a wake: the same new layout twice in a row.
            if maybe.as_deref() != Some(now.as_str()) {
                maybe = Some(now);
                continue;
            }
            maybe = None;
            last = now;
            let displays = displays_now();
            logfile::write(&format!("displays changed: {} display(s): {}", displays.len(), displays_line(&displays)));
            for i in 1..displays.len() {
                if let Err(e) = overlay_window(&handle, i) {
                    logfile::write(&format!("displays: no overlay window for display {i}: {e}"));
                }
            }
            let h = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                for (i, d) in displays.iter().enumerate() {
                    if let Some(w) = h.get_webview_window(&overlay_label(i)) {
                        fit_to(&w, d);
                    }
                }
                for (label, w) in h.webview_windows() {
                    let gone = label.strip_prefix("overlay-").and_then(|n| n.parse::<usize>().ok()).is_some_and(|n| n >= displays.len());
                    if gone {
                        let _ = w.destroy();
                    }
                }
                let _ = h.emit("layout-changed", displays.len());
            });
        }
    });
}

fn fit_to(w: &WebviewWindow, d: &sensors::Display) {
    #[cfg(not(windows))]
    {
        let _ = w.set_position(LogicalPosition::new(d.x, d.y));
        let _ = w.set_size(LogicalSize::new(d.w, d.h));
    }
    // On Windows the sensors divide pixels by the main display's scale, so multiply it back. A move
    // onto a display with another scale makes Windows resize the window for the new scale, so the
    // size and place are set again once it is there.
    #[cfg(windows)]
    {
        let s = sensors::scale();
        let pos = tauri::PhysicalPosition::new((d.x * s).round() as i32, (d.y * s).round() as i32);
        let size = tauri::PhysicalSize::new((d.w * s).round() as u32, (d.h * s).round() as u32);
        for _ in 0..2 {
            let _ = w.set_position(pos);
            let _ = w.set_size(size);
        }
        let (at, got) = (w.outer_position().ok(), w.outer_size().ok());
        let scales = sensors::display_scales();
        logfile::write(&format!(
            "overlay: {} wants {},{} {}x{} px, has {:?} {:?}, its scale {:.2}, main {:.2}, displays {:?}",
            w.label(),
            pos.x,
            pos.y,
            size.width,
            size.height,
            at.map(|p| (p.x, p.y)),
            got.map(|z| (z.width, z.height)),
            w.scale_factor().unwrap_or(0.0),
            s,
            scales
        ));
    }
    #[cfg(target_os = "macos")]
    set_exact_frame(w, d);
    let _ = w.set_ignore_cursor_events(true);
    let _ = w.set_focusable(false);
    #[cfg(target_os = "macos")]
    tune_ns_window(w);
    #[cfg(windows)]
    winui::tune(w);
    #[cfg(windows)]
    if w.label() == "overlay" {
        winui::on_session_end(w, report::clean_exit);
    }
    if HIDE_SHARE.load(std::sync::atomic::Ordering::SeqCst) {
        hide_share(w, true);
    }
}

fn main() {
    let builder = tauri::Builder::default();
    // Signed updates from GitHub Releases (macOS and Windows). See update.rs.
    #[cfg(any(target_os = "macos", windows))]
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

            // Before anything writes to the app's folder: an empty one means a new install.
            #[cfg(any(target_os = "macos", windows))]
            login_on_first_run(app.handle());
            // First, while the end of the log is still last run's (report.rs looks at how it ended).
            #[cfg(any(target_os = "macos", windows))]
            report::init(app.handle());
            #[cfg(any(target_os = "macos", windows))]
            usage::init(app.handle());
            move_old_state(app.handle());
            build_tray(app)?;
            #[cfg(any(target_os = "macos", windows))]
            update::start(app.handle());
            #[cfg(any(target_os = "macos", windows))]
            ollama::start(app.handle());
            // The panic hotkey. A listener only: it never sends keys to anything.
            if let Err(e) = app.global_shortcut().register("CmdOrCtrl+Alt+Shift+P") {
                println!("[overlay] could not register the panic hotkey: {e}");
            }

            // One overlay window per display. The first (main display) runs the cat,
            // the others only draw it when it is on their screen.
            let displays = displays_now();
            for (i, d) in displays.iter().enumerate() {
                let w = overlay_window(app.handle(), i)?;
                fit_to(&w, d);
                println!("[overlay] window {} on display {:.0},{:.0} {:.0}x{:.0}", w.label(), d.x, d.y, d.w, d.h);
            }
            watch_displays(app.handle());

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
                    for (secs, msg) in [(12, "character:mochi"), (3, "treat"), (3, "toy"), (3, "panic"), (4, "panic"), (3, "chaos:chill"), (3, "model"), (3, "model"), (3, "character:biscuit"), (3, "pet"), (4, "zoomies"), (6, "nap"), (3, "shoo")] {
                        std::thread::sleep(std::time::Duration::from_secs(secs));
                        control(&handle, msg);
                    }
                });
            }

            // FELINQUENT_ADD_CHARACTER=<file>[@s] adds a character package s seconds after launch (5
            // unless given) with no file picker, the way "Add a character…" does after a pick.
            if let Ok(spec) = std::env::var("FELINQUENT_ADD_CHARACTER") {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let (file, secs) = match spec.rsplit_once('@') {
                        Some((f, s)) if s.parse::<f64>().is_ok() => (f.to_string(), s.parse::<f64>().unwrap_or(5.0)),
                        _ => (spec.clone(), 5.0),
                    };
                    std::thread::sleep(std::time::Duration::from_secs_f64(secs));
                    characters::add(&handle, std::path::Path::new(&file), false);
                });
            }

            // FELINQUENT_PETMENU_TEST=<s> opens the menu on the animal by itself after s seconds, next to
            // the animal (computer use can't right-click a menu bar app). It only calls the menu; it
            // never makes a click.
            if let Some(secs) = std::env::var("FELINQUENT_PETMENU_TEST").ok().and_then(|v| v.parse::<u64>().ok()) {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(secs));
                    control(&handle, "petmenu-test");
                });
            }

            // FELINQUENT_MENU_SCRIPT=<s>:<id>,<s>:<id>... sends those menu ids (toy, zoomies, nap,
            // character:mochi, panic...) s seconds after launch, the way a pick from the menu does,
            // for a demo recording. Like the self-test it calls the handler; it never makes a click.
            if let Ok(script) = std::env::var("FELINQUENT_MENU_SCRIPT") {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let mut steps: Vec<(f64, String)> = script
                        .split(',')
                        .filter_map(|s| s.trim().split_once(':').and_then(|(t, id)| Some((t.parse::<f64>().ok()?, id.to_string()))))
                        .collect();
                    steps.sort_by(|a, b| a.0.total_cmp(&b.0));
                    let start = std::time::Instant::now();
                    for (at, id) in steps {
                        let wait = at - start.elapsed().as_secs_f64();
                        if wait > 0.0 {
                            std::thread::sleep(std::time::Duration::from_secs_f64(wait));
                        }
                        logfile::write(&format!("menu script: {id}"));
                        control(&handle, &id);
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
            pet_menu,
            just_updated,
            ollama_http,
            about::about_action,
            report::report_error,
            set_click_through,
            set_hide_share,
            characters::read_characters,
            overlay_reveal,
            read_config,
            load_state,
            save_state,
            show_choices,
            debug_log,
            model_setup
        ])
        .build(tauri::generate_context!())
        .expect("error while running Felinquent")
        .run(|_app, event| {
            // Quitting the normal way (the menu, logging out, shutting down): not a crash.
            #[cfg(any(target_os = "macos", windows))]
            if let tauri::RunEvent::Exit = event {
                report::clean_exit();
            }
        });
}
