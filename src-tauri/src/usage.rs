//! Anonymous usage counts (macOS and Windows, ADR-065). Once a day the app tells the relay it ran,
//! so the README and the site can show how many people have it and use it. On by default, with
//! "Share usage counts" in the menu to turn it off, and off whenever DO_NOT_TRACK is set.
//!
//! There is no install id. A ping holds the app version, mac or windows, the animal, the chaos
//! level, whether the local model is on, and the day the relay counted this install last time
//! (the relay hands that day back with each answer, and the app keeps it in `usage.json`). From
//! that one date the relay can tell a first run from a return, and a new week or month from the
//! same one, without knowing who anybody is. It only adds to totals; nothing per person is kept.
//! Never your screen, windows, titles, user name or anything from the log.
//!
//! FELINQUENT_PING_URL points at another relay (http works in debug builds only).
//! FELINQUENT_USAGE=off turns it off for a run. FELINQUENT_USAGE_AFTER=<s> pings s seconds after
//! launch instead of a minute (for tests). Debug builds mark their pings, so the relay keeps them
//! out of the public numbers.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::CheckMenuItem;
use tauri::{AppHandle, Manager, Wry};

use crate::{alert, logfile, report};

const PING: &str = "https://felinquent-reports.felinquent-report-relay.workers.dev/v1/ping";

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Prefs {
    /// Turned off in the menu.
    off: bool,
    /// The relay's day (2026-11-10) of the last counted ping. None until the first one.
    last: Option<String>,
    /// This computer's UTC day number of the last answer from the relay, so it pings once a day.
    sent: u64,
}

#[derive(Serialize, Debug, PartialEq)]
struct Ping {
    v: String,
    os: &'static str,
    last: Option<String>,
    character: Option<String>,
    chaos: Option<String>,
    model: Option<bool>,
    dev: bool,
}

#[derive(Deserialize)]
struct Answer {
    day: String,
    counted: bool,
}

struct State {
    dir: PathBuf,
    version: String,
    prefs: Mutex<Prefs>,
    item: Mutex<Option<CheckMenuItem<Wry>>>,
}

static STATE: OnceLock<State> = OnceLock::new();

fn path(dir: &PathBuf) -> PathBuf {
    dir.join("usage.json")
}

pub fn init(app: &AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else { return };
    let prefs: Prefs = report::load(&path(&dir));
    let state = State { dir, version: app.package_info().version.to_string(), prefs: Mutex::new(prefs), item: Mutex::new(None) };
    if STATE.set(state).is_ok() {
        std::thread::spawn(run);
    }
}

/// Why it's off for this run whatever the menu says, if it is.
fn held() -> Option<&'static str> {
    let dnt = std::env::var("DO_NOT_TRACK").map(|v| !matches!(v.trim(), "" | "0" | "false")).unwrap_or(false);
    if dnt {
        return Some("DO_NOT_TRACK is set");
    }
    if std::env::var("FELINQUENT_USAGE").map(|v| v == "off").unwrap_or(false) {
        return Some("FELINQUENT_USAGE=off");
    }
    None
}

/// The menu's switch, ticked while the counts go out.
pub fn menu_item(app: &tauri::App) -> tauri::Result<CheckMenuItem<Wry>> {
    let on = held().is_none() && STATE.get().is_some_and(|s| !s.prefs.lock().unwrap().off);
    let item = CheckMenuItem::with_id(app, "usage", "Share usage counts", held().is_none(), on, None::<&str>)?;
    if let Some(s) = STATE.get() {
        *s.item.lock().unwrap() = Some(item.clone());
    }
    Ok(item)
}

/// A click on "Share usage counts".
pub fn on_menu() {
    let Some(s) = STATE.get() else { return };
    let on = {
        let mut p = s.prefs.lock().unwrap();
        p.off = !p.off;
        report::store(&path(&s.dir), &*p);
        !p.off
    };
    if let Some(item) = s.item.lock().unwrap().clone() {
        let _ = item.set_checked(on);
    }
    logfile::write(&format!("menu: share usage counts {}", if on { "on" } else { "off" }));
}

fn url() -> Option<String> {
    let url = std::env::var("FELINQUENT_PING_URL").unwrap_or_else(|_| PING.to_string());
    let ok = url.starts_with("https://") || (cfg!(debug_assertions) && url.starts_with("http://"));
    ok.then_some(url)
}

fn today() -> u64 {
    report::now() / 86_400
}

fn run() {
    let Some(s) = STATE.get() else { return };
    let after = std::env::var("FELINQUENT_USAGE_AFTER").ok().and_then(|v| v.parse().ok()).unwrap_or(60);
    std::thread::sleep(Duration::from_secs(after));
    if let Some(why) = held() {
        logfile::write(&format!("usage: off for this run ({why})"));
        return;
    }
    loop {
        let due = {
            let p = s.prefs.lock().unwrap();
            !p.off && p.sent != today()
        };
        let wait = if due { send(s) } else { Duration::from_secs(10 * 60) };
        std::thread::sleep(wait);
    }
}

/// One ping. Returns how long to wait before looking again.
fn send(s: &State) -> Duration {
    let Some(url) = url() else { return Duration::from_secs(6 * 3600) };
    let ping = make(s);
    match post(&url, &ping, &s.version) {
        Ok((200, body)) => {
            let answer: Option<Answer> = serde_json::from_str(&body).ok();
            let mut p = s.prefs.lock().unwrap();
            if let Some(a) = &answer {
                p.last = Some(a.day.clone());
            }
            p.sent = today();
            report::store(&path(&s.dir), &*p);
            let how = match answer {
                Some(a) if a.counted => "counted",
                Some(_) => "already counted today",
                None => "answered",
            };
            logfile::write(&format!("usage: {how}"));
            Duration::from_secs(10 * 60)
        }
        Ok((400 | 404 | 405 | 413, _)) => {
            // Turned down: this version's ping isn't wanted, so don't try again today.
            logfile::write("usage: the relay turned the ping down");
            let mut p = s.prefs.lock().unwrap();
            p.sent = today();
            report::store(&path(&s.dir), &*p);
            Duration::from_secs(10 * 60)
        }
        Ok((status, _)) => {
            logfile::write(&format!("usage: the relay said {status}, trying later"));
            Duration::from_secs(30 * 60)
        }
        Err(e) => {
            logfile::write(&format!("usage: couldn't reach the relay: {}", alert::short(&e, 200)));
            Duration::from_secs(30 * 60)
        }
    }
}

fn make(s: &State) -> Ping {
    let settings: serde_json::Value = report::load(&s.dir.join("settings.json"));
    ping_from(&settings, &s.version, s.prefs.lock().unwrap().last.clone())
}

/// Only the three choices the counts are split by, nothing else from the settings.
fn ping_from(settings: &serde_json::Value, version: &str, last: Option<String>) -> Ping {
    let text = |key: &str| settings.get(key).and_then(|v| v.as_str()).map(String::from);
    Ping {
        v: version.into(),
        os: if cfg!(windows) { "windows" } else { "mac" },
        last,
        character: text("character"),
        chaos: text("chaos"),
        model: settings.get("model").and_then(|v| v.as_bool()),
        dev: cfg!(debug_assertions),
    }
}

fn post(url: &str, ping: &Ping, version: &str) -> Result<(u16, String), String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(format!("Felinquent/{version}"))
        .build()
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::block_on(async {
        let res = client.post(url).json(ping).send().await.map_err(|e| e.to_string())?;
        let status = res.status().as_u16();
        Ok((status, res.text().await.unwrap_or_default()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ping_has_the_three_choices_and_nothing_else_from_the_settings() {
        let settings = serde_json::json!({"character": "mochi", "chaos": "gremlin", "model": true, "ollamaModel": "gemma3:1b", "titles": true, "endpoint": "https://example.com"});
        let ping = ping_from(&settings, "0.1.16", Some("2026-11-10".into()));
        let json = serde_json::to_value(&ping).unwrap();
        let keys: Vec<&str> = json.as_object().unwrap().keys().map(|k| k.as_str()).collect();
        assert_eq!(keys.len(), 7, "{keys:?}");
        for k in ["v", "os", "last", "character", "chaos", "model", "dev"] {
            assert!(keys.contains(&k), "{k} missing");
        }
        assert_eq!(ping.character.as_deref(), Some("mochi"));
        assert_eq!(ping.model, Some(true));
        assert!(!json.to_string().contains("example.com"));
        assert!(!json.to_string().contains("gemma"));
    }

    #[test]
    fn a_first_run_has_no_last_day_and_missing_settings_are_null() {
        let ping = ping_from(&serde_json::json!({}), "0.1.16", None);
        assert_eq!(ping.last, None);
        assert_eq!(ping.character, None);
        assert_eq!(ping.model, None);
    }
}
