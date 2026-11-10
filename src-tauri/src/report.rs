//! Error reports (macOS and Windows, ADR-064). When something goes wrong (the app panics, an
//! update fails to install, the page throws, the page stops for minutes while you're at the
//! computer, or the app stopped last time without quitting) a report is put together and kept
//! on disk. The first time, the app asks once whether it may send reports by itself; after a yes
//! they go out with no question, and "Send error reports" in the menu turns them off and on.
//!
//! A report holds the app version, the system (macOS 15.6 arm64, Windows 11 24H2), the cat's
//! settings (animal, chaos level, model on or off and which one), how long it ran, what went
//! wrong and the last lines of the app's own log, with your home folder, user name and anything
//! like an email taken out. Never what's on your screen or in your windows: the log doesn't have
//! that in the first place (hard rule 6).
//!
//! Reports go to one address, the relay in RELAY: a small Cloudflare Worker that files them as
//! issues in the developer's private GitHub repo, one issue per kind of problem, with repeats
//! added to it. The GitHub token lives in the relay, never in the app. At most PER_DAY reports a
//! day leave a computer, each problem once per version.
//!
//! FELINQUENT_REPORT_URL points at another relay (http works in debug builds only).
//! FELINQUENT_REPORT_TEST=<n>[@s] presses button n of the question after s seconds.
//! FELINQUENT_REPORT_CRASH=<what>[@s] makes a problem s seconds after launch (10 unless given),
//! for tests: "problem", "panic" (a thread panics), "page" (the page throws), "abort" (the app
//! dies at once, so the next launch finds it stopped without quitting).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::menu::CheckMenuItem;
use tauri::{AppHandle, Manager, Wry};

use crate::{alert, logfile, sensors};

/// The relay, a small Cloudflare Worker. Empty: reports wait on disk until
/// a version that knows where to send them.
const RELAY: &str = "https://felinquent-reports.felinquent-report-relay.workers.dev/v1/report";
/// Reports that may leave a computer in one day.
const PER_DAY: u32 = 5;
/// Reports kept while they wait (the oldest go first).
const PENDING_MAX: usize = 20;
/// The end of the log that goes with a report.
const LOG_LINES: usize = 150;
const LOG_BYTES: usize = 16 * 1024;
const MESSAGE_CHARS: usize = 2000;
/// The page counts as stopped after this long without a word while you're at the computer.
const STALL_SEC: u64 = 120;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
struct Prefs {
    /// "" not asked yet, "yes" send by itself, "no" never.
    consent: String,
    /// Problem (fingerprint) -> the version a report was last sent for.
    sent: HashMap<String, String>,
    /// UTC day number, and how many reports went out that day.
    day: u64,
    today: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Report {
    /// The kind of problem plus its message with the numbers taken out, hashed: the same problem
    /// gets the same fingerprint on every computer, so the relay files it under one issue.
    pub fp: String,
    pub kind: String,
    pub title: String,
    pub message: String,
    pub version: String,
    pub os: String,
    /// How many times it happened before this report went out.
    pub count: u32,
    pub uptime_min: u64,
    pub settings: serde_json::Value,
    pub log: String,
}

/// What the app was doing last time, written every minute while it runs and removed when it
/// quits the normal way. Found at launch, it means the app stopped without quitting.
#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Alive {
    version: String,
    started: u64,
    beat: u64,
    boot: u64,
}

struct State {
    app: AppHandle,
    dir: PathBuf,
    version: String,
    started: Instant,
    prefs: Mutex<Prefs>,
    pending: Mutex<Vec<Report>>,
    item: Mutex<Option<CheckMenuItem<Wry>>>,
}

static STATE: OnceLock<State> = OnceLock::new();
/// Something new is waiting to be sent or asked about.
static DIRTY: AtomicBool = AtomicBool::new(false);
/// The app is quitting the normal way: stop writing the alive file.
static EXITING: AtomicBool = AtomicBool::new(false);
/// Unix seconds of the page's last call.
static PAGE_SEEN: AtomicU64 = AtomicU64::new(0);
/// The question is on screen.
static ASKING: AtomicBool = AtomicBool::new(false);

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn load<T: for<'a> Deserialize<'a> + Default>(path: &PathBuf) -> T {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn store<T: Serialize>(path: &PathBuf, value: &T) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("tmp");
    if std::fs::write(&tmp, serde_json::to_string_pretty(value).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(&tmp, path);
    }
}

fn prefs_path(dir: &PathBuf) -> PathBuf {
    dir.join("reports.json")
}
fn pending_path(dir: &PathBuf) -> PathBuf {
    dir.join("reports-pending.json")
}
fn alive_path(dir: &PathBuf) -> PathBuf {
    dir.join("alive.json")
}

/// Starts it all. Call first thing in setup, before anything writes to the log, so the end of the
/// log is still last time's when a stop without quitting is found.
pub fn init(app: &AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else { return };
    let version = app.package_info().version.to_string();
    let prefs: Prefs = load(&prefs_path(&dir));
    let pending: Vec<Report> = load(&pending_path(&dir));
    let state = State { app: app.clone(), dir: dir.clone(), version, started: Instant::now(), prefs: Mutex::new(prefs), pending: Mutex::new(pending), item: Mutex::new(None) };
    if STATE.set(state).is_err() {
        return;
    }
    last_time();
    hook_panics();
    std::thread::spawn(heartbeat);
    std::thread::spawn(sender);
    if !STATE.get().map(|s| s.pending.lock().unwrap().is_empty()).unwrap_or(true) {
        DIRTY.store(true, Ordering::SeqCst);
    }
    crash_test(app);
}

/// The menu's switch. On when reports go out by themselves.
pub fn menu_item(app: &tauri::App) -> tauri::Result<CheckMenuItem<Wry>> {
    let on = STATE.get().is_some_and(|s| s.prefs.lock().unwrap().consent == "yes");
    let item = CheckMenuItem::with_id(app, "reports", "Send error reports", true, on, None::<&str>)?;
    if let Some(s) = STATE.get() {
        *s.item.lock().unwrap() = Some(item.clone());
    }
    Ok(item)
}

/// A click on "Send error reports".
pub fn on_menu() {
    let Some(s) = STATE.get() else { return };
    let on = {
        let mut p = s.prefs.lock().unwrap();
        p.consent = if p.consent == "yes" { "no".into() } else { "yes".into() };
        store(&prefs_path(&s.dir), &*p);
        p.consent == "yes"
    };
    show_tick(on);
    logfile::write(&format!("menu: send error reports {}", if on { "on" } else { "off" }));
    if on {
        DIRTY.store(true, Ordering::SeqCst);
    } else {
        drop_pending();
    }
}

fn show_tick(on: bool) {
    if let Some(item) = STATE.get().and_then(|s| s.item.lock().unwrap().clone()) {
        let _ = item.set_checked(on);
    }
}

/// The app quits the normal way (the menu, an update, the computer shutting down).
pub fn clean_exit() {
    EXITING.store(true, Ordering::SeqCst);
    if let Some(s) = STATE.get() {
        let _ = std::fs::remove_file(alive_path(&s.dir));
    }
}

/// The page is alive (it calls this with every sensor read).
pub fn page_seen() {
    PAGE_SEEN.store(now(), Ordering::Relaxed);
}

/// Something went wrong. It's logged and kept for a report.
pub fn problem(_app: &AppHandle, kind: &str, message: &str) {
    logfile::write(&format!("report: {kind}: {}", alert::short(message, 300)));
    let Some(s) = STATE.get() else { return };
    let report = build(s, kind, message, &log_tail());
    queue(s, report);
}

/// The page's own errors (window.onerror and promises nobody caught).
#[tauri::command]
pub fn report_error(app: AppHandle, message: String, stack: Option<String>) {
    let text = match stack.filter(|t| !t.trim().is_empty()) {
        Some(stack) => format!("{message}\n{stack}"),
        None => message,
    };
    problem(&app, "page", &text);
}

fn queue(s: &State, report: Report) {
    if s.prefs.lock().unwrap().consent == "no" {
        return;
    }
    // Never poisoned for good: a panic while this was held still gets its report.
    let mut pending = s.pending.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(old) = pending.iter_mut().find(|r| r.fp == report.fp) {
        // The same problem again: keep the newest details and count it.
        let count = old.count + 1;
        *old = report;
        old.count = count;
    } else {
        pending.push(report);
        let extra = pending.len().saturating_sub(PENDING_MAX);
        pending.drain(..extra);
    }
    store(&pending_path(&s.dir), &*pending);
    DIRTY.store(true, Ordering::SeqCst);
}

fn drop_pending() {
    let Some(s) = STATE.get() else { return };
    let mut pending = s.pending.lock().unwrap();
    pending.clear();
    store(&pending_path(&s.dir), &*pending);
}

/// A panic is written to the log and kept for a report on the spot, since the app may not live
/// long enough for anything else.
fn hook_panics() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let place = info.location().map(|l| format!(" at {}:{}", l.file(), l.line())).unwrap_or_default();
        let what = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "a panic".into());
        let thread = std::thread::current().name().unwrap_or("a thread").to_string();
        let message = format!("panic in {thread}: {what}{place}");
        logfile::write(&format!("report: panic: {message}"));
        if let Some(s) = STATE.get() {
            let report = build(s, "panic", &message, &log_tail());
            queue(s, report);
        }
        default(info);
    }));
}

/// Looks at how the app ended last time. Stopped without quitting while the computer stayed on
/// (same boot): it crashed, hung and was force quit, or was killed. A restart or a shutdown is
/// not a problem (a new boot), and quitting the normal way removes the file.
fn last_time() {
    let Some(s) = STATE.get() else { return };
    let path = alive_path(&s.dir);
    if path.is_file() {
        let alive: Alive = load(&path);
        let boot = boot_time();
        if alive.beat > 0 && boot > 0 && same_boot(alive.boot, boot) {
            let ran = alive.beat.saturating_sub(alive.started) / 60;
            let message = format!(
                "It stopped without quitting after about {ran} min\nVersion {}. It crashed, or hung and was force quit, or was killed. The log below is from that run.",
                if alive.version.is_empty() { "?" } else { &alive.version }
            );
            logfile::write("report: it stopped without quitting last time");
            let mut report = build(s, "stopped", &message, &log_tail());
            report.uptime_min = ran;
            queue(s, report);
        }
    }
    beat(s);
}

/// Boot times read twice can differ by a second or two (Windows works it out from the uptime).
fn same_boot(a: u64, b: u64) -> bool {
    a.abs_diff(b) <= 120
}

fn beat(s: &State) {
    if EXITING.load(Ordering::SeqCst) {
        return;
    }
    let started = now().saturating_sub(s.started.elapsed().as_secs());
    store(&alive_path(&s.dir), &Alive { version: s.version.clone(), started, beat: now(), boot: boot_time() });
}

/// Every minute: the alive file. Every 15 s: is the page still talking? A page that stops for two
/// minutes while you're using the computer is stuck (the old "everything was broken"). A gap in
/// this loop itself means the computer slept, so that doesn't count.
fn heartbeat() {
    let Some(s) = STATE.get() else { return };
    let mut last = Instant::now();
    let mut beats = 0u32;
    let mut stalled = false;
    loop {
        std::thread::sleep(Duration::from_secs(15));
        let slept = last.elapsed() > Duration::from_secs(45);
        last = Instant::now();
        beats += 1;
        if beats % 4 == 0 || slept {
            beat(s);
        }
        let seen = PAGE_SEEN.load(Ordering::Relaxed);
        if slept && seen > 0 {
            // Give the page a fresh start after a sleep.
            PAGE_SEEN.store(now(), Ordering::Relaxed);
            continue;
        }
        if !stalled && seen > 0 && now().saturating_sub(seen) > STALL_SEC && sensors::idle_sec() < 60.0 {
            stalled = true;
            let message = format!("The cat's page stopped answering for over {} s while the computer was in use.", now().saturating_sub(seen));
            problem(&s.app, "stall", &message);
        }
    }
}

/// Sends what is waiting: right away when there's something new, and every half hour to retry.
/// Asks first if it was never asked.
fn sender() {
    let Some(s) = STATE.get() else { return };
    // Let the app settle after launch.
    std::thread::sleep(Duration::from_secs(20));
    let mut next_try = Instant::now();
    loop {
        let fresh = DIRTY.swap(false, Ordering::SeqCst);
        // Without a relay in this version nothing can go out, so it doesn't ask either: the
        // reports wait on disk for a version that has one.
        let waiting = !s.pending.lock().unwrap().is_empty() && relay().is_some();
        if waiting && (fresh || Instant::now() >= next_try) {
            let consent = s.prefs.lock().unwrap().consent.clone();
            let consent = if consent.is_empty() { ask(s) } else { consent };
            match consent.as_str() {
                "yes" => {
                    if !send_all(s) {
                        next_try = Instant::now() + Duration::from_secs(30 * 60);
                    }
                }
                "no" => drop_pending(),
                // Not a good moment to ask: try again in a while.
                _ => next_try = Instant::now() + Duration::from_secs(5 * 60),
            }
        }
        std::thread::sleep(Duration::from_secs(10));
    }
}

/// The one question. Only while you're at the computer, not in a call and nothing full screen.
/// Returns the answer, or "" if it's not a good moment.
fn ask(s: &State) -> String {
    let press = std::env::var("FELINQUENT_REPORT_TEST").ok().and_then(|t| alert::test_press(&t));
    // A test presses the button itself, so it doesn't wait for you.
    if press.is_none() && (sensors::idle_sec() > 60.0 || sensors::camera_in_use() || sensors::mic_in_use() || fullscreen_in_front()) {
        return String::new();
    }
    if ASKING.swap(true, Ordering::SeqCst) {
        return String::new();
    }
    let text = "Something went wrong in Felinquent. Can it send error reports by itself, so it gets fixed?\n\n\
        A report has the app version, your system and the end of the app's own log, with your name taken out. \
        Never what's on your screen or in your windows. You can turn it off in the menu any time.";
    let answer = alert::ask(&s.app, "Send error reports?", text, &["Send automatically", "Don't send"], 1, press);
    ASKING.store(false, Ordering::SeqCst);
    let consent = match answer {
        0 => "yes",
        1 => "no",
        _ => return String::new(),
    };
    logfile::write(&format!("report: asked, answer {}", if consent == "yes" { "send" } else { "don't send" }));
    let mut p = s.prefs.lock().unwrap();
    p.consent = consent.into();
    store(&prefs_path(&s.dir), &*p);
    show_tick(consent == "yes");
    consent.into()
}

fn fullscreen_in_front() -> bool {
    let displays = sensors::displays();
    sensors::windows("felinquent").iter().filter(|w| w.z == 0).any(|w| displays.iter().any(|d| w.x <= d.x && w.y <= d.y && w.w >= d.w && w.h >= d.h))
}

fn relay() -> Option<String> {
    let url = std::env::var("FELINQUENT_REPORT_URL").unwrap_or_else(|_| RELAY.to_string());
    let ok = url.starts_with("https://") || (cfg!(debug_assertions) && url.starts_with("http://"));
    ok.then_some(url)
}

/// Sends the waiting reports within the day's limit. false: the relay couldn't be reached, so
/// try again later.
fn send_all(s: &State) -> bool {
    let Some(url) = relay() else {
        logfile::write("report: no relay in this version, the reports wait");
        return false;
    };
    let reports = s.pending.lock().unwrap().clone();
    let mut done: Vec<String> = Vec::new();
    let mut reachable = true;
    for r in reports {
        {
            let mut p = s.prefs.lock().unwrap();
            let day = now() / 86_400;
            if p.day != day {
                p.day = day;
                p.today = 0;
            }
            if p.sent.get(&r.fp) == Some(&r.version) {
                // Already told about this one in this version.
                done.push(r.fp.clone());
                continue;
            }
            if p.today >= PER_DAY {
                logfile::write("report: today's reports are used up, the rest wait");
                break;
            }
        }
        match post(&url, &r) {
            Ok(status) if (200..300).contains(&status) => {
                logfile::write(&format!("report: sent {} {}", r.kind, r.fp));
                let mut p = s.prefs.lock().unwrap();
                p.today += 1;
                p.sent.insert(r.fp.clone(), r.version.clone());
                store(&prefs_path(&s.dir), &*p);
                done.push(r.fp.clone());
            }
            Ok(429) | Ok(500..=599) => {
                logfile::write("report: the relay is busy, trying later");
                reachable = false;
                break;
            }
            Ok(status) => {
                // The relay turned it down (too big, malformed): don't send it again.
                logfile::write(&format!("report: the relay said {status} to {}, dropping it", r.fp));
                done.push(r.fp.clone());
            }
            Err(e) => {
                logfile::write(&format!("report: couldn't reach the relay: {}", alert::short(&e, 200)));
                reachable = false;
                break;
            }
        }
    }
    let mut pending = s.pending.lock().unwrap();
    pending.retain(|r| !done.contains(&r.fp));
    store(&pending_path(&s.dir), &*pending);
    reachable
}

fn post(url: &str, report: &Report) -> Result<u16, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(format!("Felinquent/{}", report.version))
        .build()
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::block_on(async { client.post(url).json(report).send().await.map(|r| r.status().as_u16()).map_err(|e| e.to_string()) })
}

/// Puts a report together.
fn build(s: &State, kind: &str, message: &str, log: &str) -> Report {
    let message = alert::short(&scrub(message), MESSAGE_CHARS);
    let title = alert::short(message.lines().next().unwrap_or(kind), 100);
    Report {
        fp: fingerprint(kind, &message),
        kind: kind.into(),
        title,
        message,
        version: s.version.clone(),
        os: os(),
        count: 1,
        uptime_min: s.started.elapsed().as_secs() / 60,
        settings: settings(s),
        log: scrub(log),
    }
}

/// Only the cat's own choices from settings.json, nothing else that might be in there.
fn settings(s: &State) -> serde_json::Value {
    let all: serde_json::Value = load(&s.dir.join("settings.json"));
    let mut out = serde_json::Map::new();
    for key in ["character", "chaos", "model", "ollamaModel"] {
        if let Some(v) = all.get(key) {
            out.insert(key.into(), v.clone());
        }
    }
    out.insert("displays".into(), sensors::displays().len().into());
    serde_json::Value::Object(out)
}

/// The end of the log, a whole number of lines.
fn log_tail() -> String {
    let path = logfile::dir().join("overlay.log");
    let text = std::fs::read(&path).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    tail(&text, LOG_LINES, LOG_BYTES)
}

pub fn tail(text: &str, lines: usize, bytes: usize) -> String {
    let mut out: Vec<&str> = Vec::new();
    let mut size = 0;
    for line in text.lines().rev() {
        if out.len() >= lines || size + line.len() + 1 > bytes {
            break;
        }
        size += line.len() + 1;
        out.push(line);
    }
    out.reverse();
    out.join("\n")
}

/// Takes the home folder, the user name and anything like an email out of a text.
pub fn scrub(text: &str) -> String {
    scrub_with(text, &home(), &user())
}

fn home() -> String {
    std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap_or_default()
}

fn user() -> String {
    std::env::var(if cfg!(windows) { "USERNAME" } else { "USER" })
        .ok()
        .filter(|u| !u.is_empty())
        .or_else(|| PathBuf::from(home()).file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_default()
}

pub fn scrub_with(text: &str, home: &str, user: &str) -> String {
    let mut out = text.to_string();
    if home.len() > 3 {
        out = out.replace(home, "~");
        out = out.replace(&home.replace('\\', "/"), "~");
        out = out.replace(&home.replace('/', "\\"), "~");
    }
    out = out
        .split_inclusive(char::is_whitespace)
        .map(|w| {
            let edge = |c: char| c.is_whitespace() || "\"'<>(),;[]".contains(c);
            let core = w.trim_matches(edge);
            if core.is_empty() || !looks_like_email(core) {
                return w.to_string();
            }
            let start = w.find(core).unwrap_or(0);
            format!("{}<email>{}", &w[..start], &w[start + core.len()..])
        })
        .collect();
    if user.chars().count() >= 3 && !LOG_WORDS.contains(&user.to_lowercase().as_str()) {
        out = replace_word(&out, user, "<user>");
    }
    out
}

/// User names that are also words in the log ("cat x=82 ..."), so taking them out would only
/// mangle the log. None of them says who you are.
const LOG_WORDS: [&str; 12] = ["felinquent", "cat", "user", "admin", "test", "owner", "default", "guest", "app", "intent", "bout", "report"];

fn looks_like_email(w: &str) -> bool {
    let Some((name, host)) = w.split_once('@') else { return false };
    !name.is_empty() && host.contains('.') && !host.starts_with('.') && !host.ends_with('.')
}

/// Replaces `word` where it stands alone (not inside a longer name), any case.
fn replace_word(text: &str, word: &str, with: &str) -> String {
    let lower = text.to_lowercase();
    let needle = word.to_lowercase();
    if lower.len() != text.len() {
        // Lowercasing changed byte lengths (some non-ASCII letters): plain replace only.
        return text.replace(word, with);
    }
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while let Some(found) = lower[i..].find(&needle) {
        let at = i + found;
        let end = at + needle.len();
        let alone = |b: Option<&u8>| b.map_or(true, |b| !b.is_ascii_alphanumeric());
        if alone(at.checked_sub(1).and_then(|p| bytes.get(p))) && alone(bytes.get(end)) {
            out.push_str(&text[i..at]);
            out.push_str(with);
        } else {
            out.push_str(&text[i..end]);
        }
        i = end;
    }
    out.push_str(&text[i..]);
    out
}

/// The kind plus the message with the numbers taken out, hashed (FNV-1a), so "took 812 ms" and
/// "took 990 ms" are the same problem.
pub fn fingerprint(kind: &str, message: &str) -> String {
    let first = message.lines().next().unwrap_or("").to_lowercase();
    let mut norm = String::with_capacity(first.len());
    let mut last_hash = false;
    for c in first.chars() {
        if c.is_ascii_hexdigit() && (c.is_ascii_digit() || last_hash) {
            if !last_hash {
                norm.push('#');
            }
            last_hash = true;
        } else {
            last_hash = false;
            norm.push(c);
        }
    }
    let norm: String = norm.chars().take(160).collect();
    let mut h: u64 = 0xcbf29ce484222325;
    for b in format!("{kind}|{}", norm.trim()).bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{:012x}", h & 0xffff_ffff_ffff)
}

fn os() -> String {
    let arch = std::env::consts::ARCH;
    #[cfg(target_os = "macos")]
    {
        let v = std::process::Command::new("/usr/bin/sw_vers").arg("-productVersion").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
        format!("macOS {v} {arch}")
    }
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        let key = winreg::RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion").ok();
        let get = |name: &str| key.as_ref().and_then(|k| k.get_value::<String, _>(name).ok()).unwrap_or_default();
        let build = get("CurrentBuild");
        let name = if build.parse::<u32>().unwrap_or(0) >= 22000 { "Windows 11" } else { "Windows 10" };
        format!("{name} {} ({build}) {arch}", get("DisplayVersion"))
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    format!("{} {arch}", std::env::consts::OS)
}

/// When the computer started, in Unix seconds (0 if unknown).
fn boot_time() -> u64 {
    #[cfg(target_os = "macos")]
    {
        // "{ sec = 1731000000, usec = 0 } Mon Nov ..."
        let out = std::process::Command::new("/usr/sbin/sysctl").args(["-n", "kern.boottime"]).output().ok();
        let text = out.map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
        text.split("sec =").nth(1).and_then(|t| t.split(',').next()).and_then(|t| t.trim().parse().ok()).unwrap_or(0)
    }
    #[cfg(windows)]
    {
        // Milliseconds since the computer started, sleep included.
        let up = unsafe { windows::Win32::System::SystemInformation::GetTickCount64() } / 1000;
        now().saturating_sub(up)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    0
}

/// FELINQUENT_REPORT_CRASH=<what>[@s]: a problem on purpose, for tests.
fn crash_test(app: &AppHandle) {
    let Ok(spec) = std::env::var("FELINQUENT_REPORT_CRASH") else { return };
    let (what, secs) = spec.split_once('@').map(|(w, s)| (w.to_string(), s.parse().unwrap_or(10.0))).unwrap_or((spec, 10.0f64));
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs_f64(secs));
        logfile::write(&format!("report: test {what}"));
        match what.as_str() {
            "problem" => problem(&app, "test", "A test problem on purpose (FELINQUENT_REPORT_CRASH), took 812 ms"),
            "panic" => {
                let _ = std::thread::Builder::new().name("report test".into()).spawn(|| panic!("a test panic on purpose (FELINQUENT_REPORT_CRASH)"));
            }
            "page" => {
                use tauri::Emitter;
                let _ = app.emit_to("overlay", "ctl", "report-test".to_string());
            }
            "abort" => std::process::abort(),
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_problem_with_other_numbers_is_one_problem() {
        let a = fingerprint("update", "install of 0.1.14 failed: took 812 ms at 0x7ffee3a1");
        let b = fingerprint("update", "install of 0.1.15 failed: took 90 ms at 0x1a2b3c4d");
        assert_eq!(a, b);
        assert_ne!(a, fingerprint("page", "install of 0.1.14 failed: took 812 ms at 0x7ffee3a1"));
        assert_ne!(a, fingerprint("update", "the signature didn't match"));
        assert_eq!(a.len(), 12);
    }

    #[test]
    fn home_user_and_emails_come_out() {
        let text = "could not open /Users/abozar/Library/x.json for Abozar (abozar.alizadeh@gmail.com), abozarx stays";
        let out = scrub_with(text, "/Users/abozar", "abozar");
        assert_eq!(out, "could not open ~/Library/x.json for <user> (<email>), abozarx stays");
        let win = scrub_with("C:\\Users\\abo\\AppData\\x and C:/Users/abo/y", "C:\\Users\\abo", "abo");
        assert_eq!(win, "~\\AppData\\x and ~/y");
        // A user called "cat" keeps the log readable.
        assert_eq!(scrub_with("cat x=82 anim=sit", "/Users/cat", "cat"), "cat x=82 anim=sit");
    }

    #[test]
    fn the_log_tail_is_whole_lines_within_the_limits() {
        let text = (0..500).map(|i| format!("line {i}")).collect::<Vec<_>>().join("\n");
        let t = tail(&text, 150, 16 * 1024);
        assert!(t.starts_with("line 350\n") && t.ends_with("line 499"));
        let small = tail(&text, 150, 30);
        assert_eq!(small, "line 497\nline 498\nline 499");
    }

    #[test]
    fn a_restart_is_a_new_boot_but_a_second_off_is_not() {
        assert!(same_boot(1_731_000_000, 1_731_000_001));
        assert!(!same_boot(1_731_000_000, 1_731_090_000));
    }
}
