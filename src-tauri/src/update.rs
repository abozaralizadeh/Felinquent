//! Updates (macOS and Windows). A minute after launch and then every 3 hours the app fetches one small file
//! from GitHub Releases (latest.json) to see if a newer Felinquent is out. Nothing about the user
//! goes with it. With "Update automatically" on (the default) a newer version is downloaded,
//! checked against the public key in tauri.conf.json and put in place by itself the next time
//! you leave the Mac alone for two minutes (not in a call, nothing full screen), and the cat
//! restarts with it. "Check for updates…" works by hand either way and asks first: update now,
//! later, or skip this version. With "Update automatically" off it never checks by itself.
//!
//! Before 0.1.10 it checked every 12 hours counted from the last check of any kind, so a check by
//! hand pushed the next one back, and it always asked: Abozar's log shows every update so far
//! came from a click, and 0.1.7 and 0.1.8 were never offered (ADR-050).
//!
//! On Windows the update is the installer itself (signed like the Mac one): it runs with a small
//! progress window, puts the new version in place and starts the cat again, and the app quits to
//! let it (ADR-060).
//!
//! FELINQUENT_UPDATE_URL points the check at another latest.json, to try an update locally.
//! FELINQUENT_UPDATE_TEST=<n>[@seconds] is for trying the questions without a mouse: 5 seconds
//! after launch the app clicks its own "Check for updates…", and every question gets button n
//! pressed for it 3 seconds (or the given seconds) after it shows. 0 is the first button.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItem, MenuItem};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::alert::{self, short};
use crate::{logfile, sensors};

/// Seconds between automatic checks.
const EVERY: u64 = 3 * 3600;
/// After a check that failed (no network), the next try.
const RETRY: u64 = 30 * 60;
/// How long you leave the Mac alone before an automatic update puts itself in place.
const IDLE_FOR: f64 = 120.0;
/// After "Later", it waits this long before asking about the same version again.
const LATER: u64 = 3 * 24 * 3600;
/// Where people can always get the app by hand.
const PAGE: &str = "https://github.com/abozaralizadeh/Felinquent/releases/latest";

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
struct Prefs {
    /// Check by itself and put new versions in place on its own.
    auto: bool,
    /// A version the user said to skip.
    skipped: String,
    /// Unix seconds of the last check that got an answer.
    last_check: u64,
    /// Don't ask on its own before this time (set by "Later").
    ask_after: u64,
    /// The version that ran last time, to say hello after an update.
    ran: String,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { auto: true, skipped: String::new(), last_check: 0, ask_after: 0, ran: String::new() }
    }
}

/// The two menu items and what the updater knows so far.
pub struct Updates {
    item: MenuItem<Wry>,
    auto_item: CheckMenuItem<Wry>,
    prefs: Mutex<Prefs>,
    /// A check or an install is running.
    busy: Mutex<bool>,
    /// The newer version found by the last check.
    found: Mutex<Option<Update>>,
    /// A question about the update is on screen, so it never shows twice.
    asking: AtomicBool,
    /// An automatic update is waiting for a quiet moment. A click by hand still asks at once:
    /// before 0.1.15 the wait also blocked the click, so "Update to…" did nothing (ADR-064).
    waiting: AtomicBool,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn prefs_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("updates.json"))
}

fn load(app: &AppHandle) -> Prefs {
    prefs_path(app).and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(app: &AppHandle, prefs: &Prefs) {
    let Some(path) = prefs_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("tmp");
    if std::fs::write(&tmp, serde_json::to_string_pretty(prefs).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

fn change(app: &AppHandle, f: impl FnOnce(&mut Prefs)) {
    let Some(u) = app.try_state::<Updates>() else { return };
    let mut p = u.prefs.lock().unwrap();
    f(&mut p);
    save(app, &p);
}

/// Updates replace the installed app, so they only work there, not in a dev build: the .app
/// bundle on the Mac, the folder the installer made (it has uninstall.exe) on Windows.
fn in_bundle() -> bool {
    let exe = std::env::current_exe().unwrap_or_default();
    if cfg!(windows) {
        return exe.parent().is_some_and(|d| d.join("uninstall.exe").is_file());
    }
    exe.ancestors().nth(3).is_some_and(|a| a.extension().is_some_and(|e| e == "app"))
}

/// Makes the menu items. Call `start` once they are in the menu.
pub fn menu_items(app: &tauri::App) -> tauri::Result<(MenuItem<Wry>, CheckMenuItem<Wry>)> {
    let prefs = load(app.handle());
    let item = MenuItem::with_id(app, "update", "Check for updates…", true, None::<&str>)?;
    let auto_item = CheckMenuItem::with_id(app, "autoupdate", "Update automatically", true, prefs.auto, None::<&str>)?;
    app.manage(Updates { item: item.clone(), auto_item: auto_item.clone(), prefs: Mutex::new(prefs), busy: Mutex::new(false), found: Mutex::new(None), asking: AtomicBool::new(false), waiting: AtomicBool::new(false) });
    Ok((item, auto_item))
}

/// The version it was before, if it just updated itself (the page shows a little hello). Once per update.
pub fn just_updated(app: &AppHandle) -> Option<String> {
    let current = app.package_info().version.to_string();
    let mut before = None;
    change(app, |p| {
        if !p.ran.is_empty() && p.ran != current {
            before = Some(p.ran.clone());
        }
        p.ran = current.clone();
    });
    before
}

/// The automatic checks: a minute after launch, then every 3 hours. The clock is the wall clock,
/// read every 10 minutes, so a Mac that sleeps a lot still gets its checks. A check by hand
/// doesn't push the next one back.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    if std::env::var("FELINQUENT_UPDATE_TEST").is_ok() {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(5));
            on_menu(&app, "update");
        });
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(60));
        let mut first = true;
        loop {
            let due = app.try_state::<Updates>().is_some_and(|u| {
                let p = u.prefs.lock().unwrap();
                p.auto && (first || now().saturating_sub(p.last_check) >= EVERY)
            });
            if due && (in_bundle() || std::env::var("FELINQUENT_UPDATE_URL").is_ok()) {
                first = false;
                check(&app, false);
            }
            std::thread::sleep(Duration::from_secs(600));
        }
    });
}

/// The menu's two items.
pub fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "autoupdate" => {
            let mut on = false;
            change(app, |p| {
                p.auto = !p.auto;
                on = p.auto;
            });
            if let Some(u) = app.try_state::<Updates>() {
                let _ = u.auto_item.set_checked(on);
            }
            logfile::write(&format!("menu: update automatically {}", if on { "on" } else { "off" }));
        }
        "update" => {
            logfile::write("menu: check for updates");
            let app = app.clone();
            // Off the main thread: the check waits on the network and the questions are modal.
            // Always a fresh check, so a version that came out since the last one is the one offered.
            std::thread::spawn(move || check(&app, true));
        }
        _ => {}
    }
}

/// Asks GitHub whether a newer version is out. `by_hand` is a click on "Check for updates…",
/// which always answers; an automatic check only speaks up when there is something to offer.
fn check(app: &AppHandle, by_hand: bool) {
    let Some(u) = app.try_state::<Updates>() else { return };
    // A click by hand while an automatic check is running waits for it (up to half a minute)
    // instead of doing nothing.
    let mut tries = if by_hand { 60 } else { 0 };
    loop {
        {
            let mut busy = u.busy.lock().unwrap();
            if !*busy {
                *busy = true;
                break;
            }
        }
        if tries == 0 {
            if by_hand {
                logfile::write("update: still busy with a download, the click waits for it");
            }
            return;
        }
        tries -= 1;
        std::thread::sleep(Duration::from_millis(500));
    }
    let result = tauri::async_runtime::block_on(async {
        let mut builder = app.updater_builder();
        if let Ok(url) = std::env::var("FELINQUENT_UPDATE_URL") {
            builder = builder.endpoints(vec![url.parse().map_err(|e| format!("{e}"))?]).map_err(|e| e.to_string())?;
        }
        // Windows: the installer takes over from here and the app quits.
        builder = builder.on_before_exit(|| {
            logfile::write("update: the installer takes over, quitting");
            crate::report::clean_exit();
        });
        builder.build().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())
    });
    *u.busy.lock().unwrap() = false;
    let current = app.package_info().version.to_string();
    match result {
        Ok(Some(update)) => {
            logfile::write(&format!("update: {} is out (this is {current})", update.version));
            if !by_hand {
                change(app, |p| p.last_check = now());
            }
            let _ = u.item.set_text(format!("Update to {}…", update.version));
            *u.found.lock().unwrap() = Some(update.clone());
            let p = u.prefs.lock().unwrap().clone();
            if by_hand {
                offer(app, update);
            } else if p.auto && p.skipped != update.version {
                quietly(app, update);
            }
        }
        Ok(None) => {
            logfile::write(&format!("update: {current} is the newest"));
            if !by_hand {
                change(app, |p| p.last_check = now());
            }
            if by_hand {
                if !in_bundle() && std::env::var("FELINQUENT_UPDATE_URL").is_err() {
                    ask(app, "Updates work in the installed app", "This is a build from source. Updates only replace the installed app.", &["OK"]);
                } else {
                    ask(app, "You're up to date", &format!("Felinquent {current} is the newest version."), &["OK"]);
                }
            }
        }
        Err(e) => {
            logfile::write(&format!("update: the check failed: {e}"));
            // Try again in half an hour, not at the next 10-minute tick.
            if !by_hand {
                change(app, |p| p.last_check = now().saturating_sub(EVERY - RETRY));
            }
            if by_hand {
                ask(app, "Couldn't check for updates", &format!("GitHub didn't answer. Check the connection and try again later.\n\n({})", short(&e, 200)), &["OK"]);
            }
        }
    }
}

/// "Update automatically": no question. It waits until you leave the Mac alone for a couple of
/// minutes, then downloads, puts the new app in place and restarts (a second or two without the cat).
fn quietly(app: &AppHandle, update: Update) {
    let Some(u) = app.try_state::<Updates>() else { return };
    if u.waiting.swap(true, Ordering::SeqCst) {
        return;
    }
    logfile::write(&format!("update: {} will go in by itself at a quiet moment", update.version));
    loop {
        // Turned off meanwhile: it asks the next time you check by hand instead.
        let p = u.prefs.lock().unwrap().clone();
        if !p.auto {
            logfile::write("update: automatic updates were turned off, not installing");
            u.waiting.store(false, Ordering::SeqCst);
            return;
        }
        // You said "Skip this version" to a question by hand meanwhile.
        if p.skipped == update.version {
            u.waiting.store(false, Ordering::SeqCst);
            return;
        }
        if sensors::idle_sec() >= IDLE_FOR && !sensors::camera_in_use() && !sensors::mic_in_use() && !fullscreen_in_front() {
            break;
        }
        std::thread::sleep(Duration::from_secs(15));
    }
    u.waiting.store(false, Ordering::SeqCst);
    // A newer version may have come out while it waited (three came out on 9 Nov 2026).
    let newest = u.found.lock().unwrap().clone().unwrap_or(update);
    install(app, newest, false);
}

/// Asks about the update (after a check by hand).
fn offer(app: &AppHandle, update: Update) {
    let Some(u) = app.try_state::<Updates>() else { return };
    if u.asking.swap(true, Ordering::SeqCst) {
        return;
    }
    ask_about(app, update);
    u.asking.store(false, Ordering::SeqCst);
}

fn ask_about(app: &AppHandle, update: Update) {
    let current = app.package_info().version.to_string();
    let notes = update.body.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(|n| format!("{}\n\n", short(n, 400))).unwrap_or_default();
    let text = format!(
        "Version {} is ready. You have {current}.\n\n{notes}It downloads in the background, puts itself in place and restarts the cat. Your cat keeps what it learned.",
        update.version
    );
    let answer = ask(app, "A new Felinquent is out", &text, &["Update now", "Later", "Skip this version"]);
    logfile::write(&format!("update: asked about {}, answer {}", update.version, ["update now", "later", "skip"].get(answer).unwrap_or(&"none")));
    match answer {
        0 => install(app, update, true),
        2 => {
            logfile::write(&format!("update: skipping {}", update.version));
            change(app, |p| p.skipped = update.version.clone());
        }
        _ => {
            logfile::write("update: later");
            change(app, |p| p.ask_after = now() + LATER);
        }
    }
}

fn fullscreen_in_front() -> bool {
    let displays = sensors::displays();
    sensors::windows("felinquent").iter().filter(|w| w.z == 0).any(|w| displays.iter().any(|d| w.x <= d.x && w.y <= d.y && w.w >= d.w && w.h >= d.h))
}

/// Downloads, checks the signature, swaps the app and restarts. The menu item shows how far it got.
/// `asked`: you said yes to it, so a failure says so; an automatic one only logs and tries again later.
fn install(app: &AppHandle, update: Update, asked: bool) {
    let Some(u) = app.try_state::<Updates>() else { return };
    {
        let mut busy = u.busy.lock().unwrap();
        if *busy {
            return;
        }
        *busy = true;
    }
    logfile::write(&format!("update: installing {}", update.version));
    let _ = u.item.set_enabled(false);
    let _ = u.item.set_text(format!("Downloading {}…", update.version));
    let (mut got, mut shown) = (0usize, 0u64);
    let item = u.item.clone();
    let version = update.version.clone();
    let result = tauri::async_runtime::block_on(update.download_and_install(
        |chunk, total| {
            got += chunk;
            if let Some(total) = total.filter(|t| *t > 0) {
                let pct = (got as u64 * 100 / total).min(100);
                if pct >= shown + 5 {
                    shown = pct;
                    let _ = item.set_text(format!("Downloading {version}… {pct}%"));
                }
            }
        },
        || {},
    ));
    match result {
        Ok(()) => {
            logfile::write(&format!("update: {} is in place, restarting", update.version));
            let _ = u.item.set_text("Restarting…");
            crate::report::clean_exit();
            app.restart();
        }
        Err(e) => {
            logfile::write(&format!("update: install failed: {e}"));
            crate::report::problem(app, "update", &format!("install of {} failed: {e}", update.version));
            *u.busy.lock().unwrap() = false;
            let _ = u.item.set_enabled(true);
            let _ = u.item.set_text(format!("Update to {}…", update.version));
            if !asked {
                change(app, |p| p.last_check = now().saturating_sub(EVERY - RETRY));
                return;
            }
            let text = format!("{}\n\nThe app you have still works. You can also get the new one from the download page.", short(&e.to_string(), 300));
            if ask(app, "The update didn't work", &text, &["Open the download page", "Close"]) == 0 {
                crate::open_url(PAGE);
            }
        }
    }
}

/// Shows a question with the shared alert (alert.rs). Escape is the second button (Later, or
/// Close), and FELINQUENT_UPDATE_TEST presses a button for tests.
fn ask(app: &AppHandle, title: &str, text: &str, buttons: &[&str]) -> usize {
    let press = std::env::var("FELINQUENT_UPDATE_TEST").ok().and_then(|t| alert::test_press(&t));
    alert::ask(app, title, text, buttons, 1, press)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefs_from_an_older_or_broken_file_keep_checks_on() {
        let p: Prefs = serde_json::from_str("{}").unwrap();
        assert!(p.auto);
        assert_eq!(p.skipped, "");
        let p: Prefs = serde_json::from_str(r#"{"auto": false, "skipped": "0.1.2"}"#).unwrap();
        assert!(!p.auto);
        assert_eq!(p.skipped, "0.1.2");
        assert_eq!(p.last_check, 0);
        assert_eq!(p.ran, "");
    }

    #[test]
    fn long_text_is_cut_on_a_character() {
        assert_eq!(short("purr", 10), "purr");
        assert_eq!(short("miaow miaow", 5), "miaow…");
        assert_eq!(short("ééééé", 2), "éé…");
    }

    #[test]
    fn the_shipped_config_points_at_github_with_a_key() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &conf["plugins"]["updater"];
        assert_eq!(updater["endpoints"][0], "https://github.com/abozaralizadeh/Felinquent/releases/latest/download/latest.json");
        assert!(updater["pubkey"].as_str().is_some_and(|k| k.len() > 100));
        // Update files are made in CI only, where the signing key is. Local builds stay keyless.
        assert!(conf["bundle"]["createUpdaterArtifacts"].is_null());
    }
}
