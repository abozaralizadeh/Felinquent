//! Updates (macOS). Every 12 hours the app fetches one small file from GitHub Releases
//! (latest.json) to see if a newer Felinquent is out. Nothing about the user goes with it.
//! When there is one, it asks: update now, later, or skip this version. On a yes it downloads
//! the new app, checks its signature against the public key in tauri.conf.json, puts it in
//! place of this one and restarts. "Check for updates automatically" in the menu turns the
//! checks off; "Check for updates…" works by hand either way.
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

use crate::{logfile, sensors};

/// Seconds between automatic checks.
const EVERY: u64 = 12 * 3600;
/// After "Later", it waits this long before asking about the same version again.
const LATER: u64 = 3 * 24 * 3600;
/// Where people can always get the app by hand.
const PAGE: &str = "https://github.com/abozaralizadeh/Felinquent/releases/latest";

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
struct Prefs {
    /// Check by itself every 12 hours.
    auto: bool,
    /// A version the user said to skip.
    skipped: String,
    /// Unix seconds of the last check that got an answer.
    last_check: u64,
    /// Don't ask on its own before this time (set by "Later").
    ask_after: u64,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { auto: true, skipped: String::new(), last_check: 0, ask_after: 0 }
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
    /// The question is on screen or waiting for a quiet moment, so it never shows twice.
    offering: AtomicBool,
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

/// Updates replace the .app bundle, so they only work in the installed app, not in a dev build.
fn in_bundle() -> bool {
    let exe = std::env::current_exe().unwrap_or_default();
    exe.ancestors().nth(3).is_some_and(|a| a.extension().is_some_and(|e| e == "app"))
}

/// Makes the menu items. Call `start` once they are in the menu.
pub fn menu_items(app: &tauri::App) -> tauri::Result<(MenuItem<Wry>, CheckMenuItem<Wry>)> {
    let prefs = load(app.handle());
    let item = MenuItem::with_id(app, "update", "Check for updates…", true, None::<&str>)?;
    let auto_item = CheckMenuItem::with_id(app, "autoupdate", "Check for updates automatically", true, prefs.auto, None::<&str>)?;
    app.manage(Updates { item: item.clone(), auto_item: auto_item.clone(), prefs: Mutex::new(prefs), busy: Mutex::new(false), found: Mutex::new(None), offering: AtomicBool::new(false) });
    Ok((item, auto_item))
}

/// The automatic checks: a minute after launch, then whenever 12 hours have passed. The clock
/// is the wall clock, read every 10 minutes, so a Mac that sleeps a lot still gets its checks.
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
        loop {
            let due = app.try_state::<Updates>().is_some_and(|u| {
                let p = u.prefs.lock().unwrap();
                p.auto && now().saturating_sub(p.last_check) >= EVERY
            });
            if due && (in_bundle() || std::env::var("FELINQUENT_UPDATE_URL").is_ok()) {
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
            logfile::write(&format!("menu: automatic update checks {}", if on { "on" } else { "off" }));
        }
        "update" => {
            logfile::write("menu: check for updates");
            let app = app.clone();
            // Off the main thread: the check waits on the network and the questions are modal.
            std::thread::spawn(move || {
                let found = app.try_state::<Updates>().and_then(|u| u.found.lock().unwrap().clone());
                match found {
                    Some(update) => offer(&app, update, true),
                    None => check(&app, true),
                }
            });
        }
        _ => {}
    }
}

/// Asks GitHub whether a newer version is out. `by_hand` is a click on "Check for updates…",
/// which always answers; an automatic check only speaks up when there is something to offer.
fn check(app: &AppHandle, by_hand: bool) {
    let Some(u) = app.try_state::<Updates>() else { return };
    {
        let mut busy = u.busy.lock().unwrap();
        if *busy {
            return;
        }
        *busy = true;
    }
    let result = tauri::async_runtime::block_on(async {
        let mut builder = app.updater_builder();
        if let Ok(url) = std::env::var("FELINQUENT_UPDATE_URL") {
            builder = builder.endpoints(vec![url.parse().map_err(|e| format!("{e}"))?]).map_err(|e| e.to_string())?;
        }
        builder.build().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())
    });
    *u.busy.lock().unwrap() = false;
    let current = app.package_info().version.to_string();
    match result {
        Ok(Some(update)) => {
            logfile::write(&format!("update: {} is out (this is {current})", update.version));
            change(app, |p| p.last_check = now());
            let _ = u.item.set_text(format!("Update to {}…", update.version));
            *u.found.lock().unwrap() = Some(update.clone());
            let p = u.prefs.lock().unwrap().clone();
            if by_hand || (p.skipped != update.version && now() >= p.ask_after) {
                offer(app, update, by_hand);
            }
        }
        Ok(None) => {
            logfile::write(&format!("update: {current} is the newest"));
            change(app, |p| p.last_check = now());
            if by_hand {
                if !in_bundle() && std::env::var("FELINQUENT_UPDATE_URL").is_err() {
                    ask(app, "Updates work in the installed app", "This is a build from source. Updates only replace the app installed from the DMG.", &["OK"]);
                } else {
                    ask(app, "You're up to date", &format!("Felinquent {current} is the newest version."), &["OK"]);
                }
            }
        }
        Err(e) => {
            logfile::write(&format!("update: the check failed: {e}"));
            // Try again in an hour, not at the next 10-minute tick.
            change(app, |p| p.last_check = now().saturating_sub(EVERY - 3600));
            if by_hand {
                ask(app, "Couldn't check for updates", &format!("GitHub didn't answer. Check the connection and try again later.\n\n({})", short(&e, 200)), &["OK"]);
            }
        }
    }
}

/// Offers the update. An automatic offer waits for a quiet moment first.
fn offer(app: &AppHandle, update: Update, by_hand: bool) {
    let Some(u) = app.try_state::<Updates>() else { return };
    if u.offering.swap(true, Ordering::SeqCst) {
        return;
    }
    ask_about(app, update, by_hand);
    u.offering.store(false, Ordering::SeqCst);
}

fn ask_about(app: &AppHandle, update: Update, by_hand: bool) {
    if !by_hand {
        wait_for_a_quiet_moment();
    }
    let current = app.package_info().version.to_string();
    let notes = update.body.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(|n| format!("{}\n\n", short(n, 400))).unwrap_or_default();
    let text = format!(
        "Version {} is ready. You have {current}.\n\n{notes}It downloads in the background, puts itself in place and restarts the cat. Your cat keeps what it learned.",
        update.version
    );
    let answer = ask(app, "A new Felinquent is out", &text, &["Update now", "Later", "Skip this version"]);
    logfile::write(&format!("update: asked about {}, answer {}", update.version, ["update now", "later", "skip"].get(answer).unwrap_or(&"none")));
    match answer {
        0 => install(app, update),
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

/// Not in a call, no fullscreen app in front, and no typing for a few seconds, so the question
/// doesn't jump in the middle of something (or catch a key meant for another app).
fn wait_for_a_quiet_moment() {
    loop {
        let busy = sensors::camera_in_use() || sensors::mic_in_use() || sensors::since_key_sec() < 5.0 || fullscreen_in_front();
        if !busy {
            return;
        }
        std::thread::sleep(Duration::from_secs(5));
    }
}

fn fullscreen_in_front() -> bool {
    let displays = sensors::displays();
    sensors::windows("felinquent").iter().filter(|w| w.z == 0).any(|w| displays.iter().any(|d| w.x <= d.x && w.y <= d.y && w.w >= d.w && w.h >= d.h))
}

/// Downloads, checks the signature, swaps the app and restarts. The menu item shows how far it got.
fn install(app: &AppHandle, update: Update) {
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
            app.restart();
        }
        Err(e) => {
            logfile::write(&format!("update: install failed: {e}"));
            *u.busy.lock().unwrap() = false;
            let _ = u.item.set_enabled(true);
            let _ = u.item.set_text(format!("Update to {}…", update.version));
            let text = format!("{}\n\nThe app you have still works. You can also get the new one from the download page.", short(&e.to_string(), 300));
            if ask(app, "The update didn't work", &text, &["Open the download page", "Close"]) == 0 {
                let _ = std::process::Command::new("/usr/bin/open").arg(PAGE).spawn();
            }
        }
    }
}

fn short(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    format!("{}…", cut.trim_end())
}

/// Shows a Mac alert and returns which button was clicked (0 is the first, usize::MAX if it
/// couldn't show). Call it off the main thread. The alert runs as a modal session that is looked
/// at every 50 ms, so between looks the app goes on as normal and the cat doesn't freeze while the
/// question waits. The app comes to the front for it, above the cat's windows so the cat can't sit
/// on a button, and hands the focus back when it closes. Return doesn't press the first button, so
/// a key meant for another app can't start an update; Escape is the second button (Later).
fn ask(app: &AppHandle, title: &str, text: &str, buttons: &[&str]) -> usize {
    use std::sync::mpsc::RecvTimeoutError;
    let (tx, rx) = std::sync::mpsc::channel();
    let (title, text) = (title.to_string(), text.to_string());
    let buttons: Vec<String> = buttons.iter().map(|b| b.to_string()).collect();
    if app.run_on_main_thread(move || alert::open(&title, &text, &buttons, tx)).is_err() {
        return usize::MAX;
    }
    loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(index) => return index,
            Err(RecvTimeoutError::Timeout) => {
                if app.run_on_main_thread(alert::poll).is_err() {
                    return usize::MAX;
                }
            }
            Err(RecvTimeoutError::Disconnected) => return usize::MAX,
        }
    }
}

/// The open alert. Main thread only.
mod alert {
    use std::cell::RefCell;
    use std::sync::mpsc::Sender;

    use objc2::rc::Retained;
    use objc2::{msg_send, sel, MainThreadMarker};
    use objc2_app_kit::{NSAlert, NSApplication, NSModalResponseContinue, NSModalSession};
    use objc2_foundation::{NSArray, NSString};

    struct Open {
        alert: Retained<NSAlert>,
        session: NSModalSession,
        buttons: usize,
        tx: Sender<usize>,
    }

    /// The overlay windows sit at level 21. One above them, below the menu bar.
    const LEVEL: isize = 22;

    thread_local! {
        static OPEN: RefCell<Option<Open>> = const { RefCell::new(None) };
    }

    pub fn open(title: &str, text: &str, buttons: &[String], tx: Sender<usize>) {
        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(usize::MAX);
            return;
        };
        if OPEN.with(|o| o.borrow().is_some()) {
            let _ = tx.send(usize::MAX);
            return;
        }
        let alert = NSAlert::new(mtm);
        alert.setMessageText(&NSString::from_str(title));
        alert.setInformativeText(&NSString::from_str(text));
        let added: Vec<_> = buttons.iter().map(|b| alert.addButtonWithTitle(&NSString::from_str(b))).collect();
        if added.len() > 1 {
            added[0].setKeyEquivalent(&NSString::from_str(""));
            added[1].setKeyEquivalent(&NSString::from_str("\u{1b}"));
        }
        // FELINQUENT_UPDATE_TEST=<n>[@seconds]: press button n after a while (3 s unless given).
        if let Ok(test) = std::env::var("FELINQUENT_UPDATE_TEST") {
            let (n, secs) = test.split_once('@').map(|(n, s)| (n.to_string(), s.parse().unwrap_or(3.0))).unwrap_or((test, 3.0f64));
            if let (Ok(n), false) = (n.parse::<usize>(), added.is_empty()) {
                let modes = NSArray::from_retained_slice(&[NSString::from_str("kCFRunLoopCommonModes")]);
                let button = &added[n.min(added.len() - 1)];
                // SAFETY: performSelector:withObject:afterDelay:inModes: on a live NSButton, with a selector it answers.
                let _: () = unsafe { msg_send![&**button, performSelector: sel!(performClick:), withObject: std::ptr::null::<objc2::runtime::AnyObject>(), afterDelay: secs, inModes: &*modes] };
            }
        }
        alert.layout();
        let window = alert.window();
        let ns_app = NSApplication::sharedApplication(mtm);
        #[allow(deprecated)]
        ns_app.activateIgnoringOtherApps(true);
        let session = ns_app.beginModalSessionForWindow(&window);
        window.setLevel(LEVEL);
        window.orderFrontRegardless();
        OPEN.with(|o| *o.borrow_mut() = Some(Open { alert, session, buttons: added.len(), tx }));
    }

    /// Lets the alert handle its events. When a button was pressed, closes it and sends the answer.
    pub fn poll() {
        let Some(mtm) = MainThreadMarker::new() else { return };
        OPEN.with(|o| {
            let mut slot = o.borrow_mut();
            let Some(open) = slot.as_ref() else { return };
            let ns_app = NSApplication::sharedApplication(mtm);
            // The modal session puts the alert back at the modal panel level (8), under the cat's
            // windows (21). Keep lifting it.
            let window = open.alert.window();
            if window.level() != LEVEL {
                window.setLevel(LEVEL);
            }
            // SAFETY: the session came from beginModalSessionForWindow and has not ended.
            let response = unsafe { ns_app.runModalSession(open.session) };
            if response == NSModalResponseContinue {
                return;
            }
            let open = slot.take().expect("checked above");
            // SAFETY: as above; it ends here, once.
            unsafe { ns_app.endModalSession(open.session) };
            open.alert.window().orderOut(None);
            ns_app.deactivate();
            // NSAlertFirstButtonReturn is 1000, the next ones count up. Anything else is no answer.
            let index = usize::try_from(response - 1000).ok().filter(|i| *i < open.buttons).unwrap_or(usize::MAX);
            let _ = open.tx.send(index);
        });
    }
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
