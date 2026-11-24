//! More characters to download (ADR-078). The list is a `catalog.json` with the packages next to
//! it, on the `characters` release of the public repository (a prerelease, so it is never the
//! "latest" release the updates read). The app reads the list about 20 s after launch and every 6
//! hours, keeps the last good copy next to the settings so the menu works offline, and lists what
//! isn't here yet under Character > Get more characters. Picking one downloads its package,
//! checks its size and SHA-256 against the list, and adds it the way "Add a character…" does
//! (`characters::unpack`). A character that came from the list is updated when the list has a
//! newer version, and removed when the list withdraws it. Packages the user added from a file are
//! never touched. Plain downloads of public files: nothing about the user is sent.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::{characters, logfile, ollama};

const URL: &str = "https://github.com/abozaralizadeh/Felinquent/releases/download/characters/catalog.json";
const EVERY: Duration = Duration::from_secs(6 * 3600);
/// After a failed read, sooner.
const RETRY: Duration = Duration::from_secs(30 * 60);
const MAX_LIST: u64 = 256 << 10;
const MAX_PACKAGE: u64 = 400 << 20;
const MAX_ENTRIES: usize = 200;
/// The file in a character's folder that says it came from the list, holding its version.
const MARK: &str = ".catalog";

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct Entry {
    pub id: String,
    pub name: String,
    /// The menu's group for it ("Big tech").
    #[serde(default)]
    pub category: String,
    /// A few words after the name in the menu, like the built-in ones' "(orange cat)".
    #[serde(default)]
    pub about: String,
    #[serde(default = "first")]
    pub version: u32,
    /// The package's file name, next to catalog.json.
    pub file: String,
    pub size: u64,
    pub sha256: String,
}

fn first() -> u32 {
    1
}

#[derive(Deserialize, Serialize, Clone, Debug, Default, PartialEq)]
pub struct Catalog {
    pub format: u32,
    #[serde(default)]
    pub characters: Vec<Entry>,
    /// Ids taken back: a copy that came from the list is removed.
    #[serde(default)]
    pub withdrawn: Vec<String>,
    /// A line shown over a group in the menu ("Parodies, not the real people").
    #[serde(default)]
    pub notes: BTreeMap<String, String>,
}

/// The list as last read (or loaded from the copy on disk).
static LIST: Mutex<Option<Catalog>> = Mutex::new(None);
/// Ids being downloaded now, so a second click doesn't start a second download.
static BUSY: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn text_ok(s: &str, max: usize) -> bool {
    let n = s.chars().count();
    n > 0 && n <= max && !s.chars().any(char::is_control)
}

/// A package file name: letters, digits, `.`, `_` and `-`, ending in `.felinquent`, no path.
fn file_ok(f: &str) -> bool {
    (13..=80).contains(&f.len()) && f.ends_with(".felinquent") && !f.starts_with('.') && f.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}

/// Reads and checks a list. Entries that don't check out are left out, not the whole list.
pub fn parse(text: &str) -> Result<Catalog, String> {
    let mut c: Catalog = serde_json::from_str(text).map_err(|e| format!("the list isn't valid JSON: {e}"))?;
    if c.format != 1 {
        return Err("the list is from a newer version of Felinquent".into());
    }
    let mut seen = Vec::new();
    c.characters.retain(|e| {
        let ok = characters::id_ok(&e.id)
            && !characters::built_in(&e.id)
            && !seen.contains(&e.id)
            && text_ok(e.name.trim(), 24)
            && (e.category.is_empty() || text_ok(&e.category, 24))
            && (e.about.is_empty() || text_ok(&e.about, 40))
            && (1..=9999).contains(&e.version)
            && file_ok(&e.file)
            && (1..=MAX_PACKAGE).contains(&e.size)
            && e.sha256.len() == 64
            && e.sha256.bytes().all(|b| b.is_ascii_hexdigit());
        if ok {
            seen.push(e.id.clone());
        }
        ok
    });
    c.characters.truncate(MAX_ENTRIES);
    for e in &mut c.characters {
        e.name = e.name.trim().to_string();
        e.sha256 = e.sha256.to_ascii_lowercase();
        if e.category.is_empty() {
            e.category = "More".into();
        }
    }
    c.withdrawn.retain(|id| characters::id_ok(id));
    c.withdrawn.truncate(MAX_ENTRIES);
    // A withdrawn character is never offered.
    let gone = c.withdrawn.clone();
    c.characters.retain(|e| !gone.contains(&e.id));
    c.notes.retain(|k, v| text_ok(k, 24) && text_ok(v, 80));
    Ok(c)
}

/// Where the list is read from. FELINQUENT_CATALOG_URL works in debug builds only (for tests
/// against a list on localhost).
fn list_url() -> String {
    if cfg!(debug_assertions) {
        if let Ok(u) = std::env::var("FELINQUENT_CATALOG_URL") {
            return u;
        }
    }
    URL.to_string()
}

/// A package's address: next to the list.
fn file_url(list: &str, file: &str) -> String {
    match list.rfind('/') {
        Some(i) => format!("{}/{file}", &list[..i]),
        None => file.to_string(),
    }
}

fn client(url: &str) -> Result<reqwest::Client, String> {
    // reqwest has rustls with no crypto provider of its own: this installs ring first.
    ollama::tls_ready();
    if url.starts_with("https://github.com/") {
        return ollama::github_client(true);
    }
    if cfg!(debug_assertions) && url.starts_with("http://127.0.0.1:") {
        return reqwest::Client::builder().no_proxy().connect_timeout(Duration::from_secs(5)).build().map_err(|e| e.to_string());
    }
    Err("not a GitHub address".into())
}

/// Saves what is at `url` into `to` and returns its SHA-256. `at` hears how far it got (0 to 100).
async fn fetch(url: &str, to: &Path, max: u64, mut at: impl FnMut(u64)) -> Result<String, String> {
    let r = client(url)?.get(url).send().await.map_err(|e| format!("GitHub didn't answer ({e})"))?;
    let mut r = r.error_for_status().map_err(|e| format!("GitHub said {}", e.status().map(|s| s.to_string()).unwrap_or_default()))?;
    let total = r.content_length().unwrap_or(0);
    if total > max {
        return Err("the download is bigger than it should be".into());
    }
    let mut file = std::fs::File::create(to).map_err(|e| format!("couldn't save the download: {e}"))?;
    let mut hash = ring::digest::Context::new(&ring::digest::SHA256);
    let mut got = 0u64;
    while let Some(chunk) = r.chunk().await.map_err(|e| format!("the download stopped ({e})"))? {
        got += chunk.len() as u64;
        if got > max {
            return Err("the download is bigger than it should be".into());
        }
        hash.update(&chunk);
        file.write_all(&chunk).map_err(|e| format!("couldn't save the download: {e}"))?;
        if let Some(pct) = (got * 100).checked_div(total) {
            at(pct.min(100));
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    if total > 0 && got != total {
        return Err("the download stopped before the end".into());
    }
    Ok(ollama::hex(hash.finish().as_ref()))
}

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("catalog.json"))
}

/// The version of each character that came from the list, by id.
fn from_list(app: &AppHandle) -> Vec<(String, u32)> {
    let Some(root) = characters::dir(app) else { return Vec::new() };
    let Ok(entries) = std::fs::read_dir(&root) else { return Vec::new() };
    entries
        .flatten()
        .filter_map(|e| {
            let id = e.file_name().to_string_lossy().to_string();
            let v = std::fs::read_to_string(e.path().join(MARK)).ok()?.trim().parse().ok()?;
            characters::id_ok(&id).then_some((id, v))
        })
        .collect()
}

/// What the menu offers: the characters on the list that aren't here yet, and the notes.
pub fn offered(app: &AppHandle) -> (Vec<Entry>, BTreeMap<String, String>) {
    let Some(c) = LIST.lock().ok().and_then(|l| l.clone()) else { return (Vec::new(), BTreeMap::new()) };
    let root = characters::dir(app);
    let here = |id: &str| root.as_ref().is_some_and(|r| r.join(id).join("character.json").exists());
    (c.characters.into_iter().filter(|e| !here(&e.id)).collect(), c.notes)
}

/// The note over a category, for the menu of installed characters too.
pub fn note(category: &str) -> Option<String> {
    LIST.lock().ok()?.as_ref()?.notes.get(category).cloned()
}

/// Downloads one character from the list and adds it. Quiet: no question when it fails (updates).
async fn install(app: &AppHandle, e: &Entry, quiet: bool) -> Result<(), String> {
    let root = characters::dir(app).ok_or("no app folder")?;
    std::fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    let tmp = root.join(format!(".download-{}.felinquent", e.id));
    let url = file_url(&list_url(), &e.file);
    let mut shown = u64::MAX;
    let name = e.name.clone();
    let item = format!("getchar:{}", e.id);
    let hash = fetch(&url, &tmp, e.size, |pct| {
        let step = pct - pct % 10;
        if !quiet && step != shown {
            shown = step;
            crate::set_menu_text(app, &item, format!("{name} (getting\u{2026} {step}%)"));
        }
    })
    .await;
    let result = hash.and_then(|h| {
        let size = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
        if size != e.size || h != e.sha256 {
            return Err("the download doesn't match the list (it may have been changed on the way)".into());
        }
        let c = characters::unpack(&tmp, &root)?;
        if c.id != e.id {
            let _ = std::fs::remove_dir_all(root.join(&c.id));
            return Err("the package holds a different character".into());
        }
        std::fs::write(root.join(&e.id).join(MARK), e.version.to_string()).map_err(|err| err.to_string())?;
        Ok(())
    });
    let _ = std::fs::remove_file(&tmp);
    result
}

/// "Get more characters > <name>": downloads it, then the page switches to it.
pub fn get(app: &AppHandle, id: &str) {
    let Some(e) = LIST.lock().ok().and_then(|l| l.as_ref().and_then(|c| c.characters.iter().find(|e| e.id == id).cloned())) else { return };
    {
        let Ok(mut busy) = BUSY.lock() else { return };
        if busy.contains(&e.id) {
            return;
        }
        busy.push(e.id.clone());
    }
    let app = app.clone();
    std::thread::spawn(move || {
        logfile::write(&format!("catalog: getting {} ({} MB)", e.id, e.size / 1_000_000));
        let result = ollama::block_on(install(&app, &e, false));
        if let Ok(mut busy) = BUSY.lock() {
            busy.retain(|b| b != &e.id);
        }
        match result {
            Ok(()) => {
                logfile::write(&format!("catalog: added {} v{}", e.id, e.version));
                let _ = app.emit_to("overlay", "ctl", format!("packs:{}", e.id));
            }
            Err(err) => {
                logfile::write(&format!("catalog: couldn't get {}: {err}", e.id));
                crate::refresh_character_menu(&app);
                let press = std::env::var("FELINQUENT_CHARACTER_TEST").ok().and_then(|s| crate::alert::test_press(&s));
                crate::alert::ask(&app, &format!("Couldn't get {}", e.name), &format!("{}. Try again in a while.", capital(&err)), &["OK"], 0, press);
            }
        }
    });
}

fn capital(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}

/// Reads the list, keeps it, removes withdrawn characters that came from it and updates the ones
/// with a newer version. Returns whether any character here changed.
async fn refresh(app: &AppHandle) -> Result<bool, String> {
    let url = list_url();
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("catalog.download");
    let got = fetch(&url, &tmp, MAX_LIST, |_| {}).await;
    let text = got.and_then(|_| std::fs::read_to_string(&tmp).map_err(|e| e.to_string()));
    let _ = std::fs::remove_file(&tmp);
    let list = parse(&text?)?;
    if let Some(p) = cache_path(app) {
        let _ = std::fs::write(p, serde_json::to_string(&list).unwrap_or_default());
    }
    if let Ok(mut l) = LIST.lock() {
        *l = Some(list.clone());
    }
    logfile::write(&format!("catalog: {} characters, {} withdrawn", list.characters.len(), list.withdrawn.len()));
    let mut changed = false;
    let root = characters::dir(app);
    for (id, have) in from_list(app) {
        if list.withdrawn.contains(&id) {
            if let Some(r) = &root {
                let _ = std::fs::remove_dir_all(r.join(&id));
            }
            logfile::write(&format!("catalog: {id} was withdrawn, removed"));
            changed = true;
        } else if let Some(e) = list.characters.iter().find(|e| e.id == id && e.version > have) {
            match install(app, e, true).await {
                Ok(()) => {
                    logfile::write(&format!("catalog: updated {id} to v{}", e.version));
                    changed = true;
                }
                Err(err) => logfile::write(&format!("catalog: couldn't update {id}: {err}")),
            }
        }
    }
    Ok(changed)
}

/// Loads the copy on disk, then reads the list a little after launch and every 6 hours.
/// FELINQUENT_CATALOG=off skips the reads (the copy on disk still fills the menu).
pub fn start(app: &AppHandle) {
    if let Some(text) = cache_path(app).and_then(|p| std::fs::read_to_string(p).ok()) {
        if let (Ok(c), Ok(mut l)) = (parse(&text), LIST.lock()) {
            *l = Some(c);
        }
    }
    if std::env::var("FELINQUENT_CATALOG").is_ok_and(|v| v == "off") {
        return;
    }
    let after = std::env::var("FELINQUENT_CATALOG_AFTER").ok().and_then(|s| s.parse().ok()).unwrap_or(20);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(after));
        loop {
            let wait = match ollama::block_on(refresh(&app)) {
                Ok(changed) => {
                    if changed {
                        let _ = app.emit_to("overlay", "ctl", "packs".to_string());
                    }
                    crate::refresh_character_menu(&app);
                    EVERY
                }
                Err(e) => {
                    logfile::write(&format!("catalog: couldn't read the list: {e}"));
                    RETRY
                }
            };
            std::thread::sleep(wait);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> String {
        format!(r#"{{"id":"{id}","name":"Name","category":"Big tech","about":"a boss","version":2,"file":"Name.felinquent","size":1000,"sha256":"{}"}}"#, "ab".repeat(32))
    }

    #[test]
    fn reads_a_good_list() {
        let c = parse(&format!(r#"{{"format":1,"characters":[{}],"notes":{{"Big tech":"Parodies."}}}}"#, entry("jacket"))).unwrap();
        assert_eq!(c.characters.len(), 1);
        assert_eq!(c.characters[0].version, 2);
        assert_eq!(c.notes.get("Big tech").map(String::as_str), Some("Parodies."));
    }

    #[test]
    fn leaves_out_bad_entries_and_withdrawn_ones() {
        let bad_file = entry("aa").replace("Name.felinquent", "../x.felinquent");
        let bad_hash = entry("bb").replace(&"ab".repeat(32), "zz");
        let text = format!(r#"{{"format":1,"characters":[{},{},{},{},{},{}],"withdrawn":["gone","BAD ID"]}}"#, entry("tabby"), bad_file, bad_hash, entry("gone"), entry("keep"), entry("keep"));
        let c = parse(&text).unwrap();
        let ids: Vec<&str> = c.characters.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, ["keep"]);
        assert_eq!(c.withdrawn, ["gone"]);
    }

    #[test]
    fn refuses_a_newer_format() {
        assert!(parse(r#"{"format":2,"characters":[]}"#).is_err());
        assert!(parse("not json").is_err());
    }

    #[test]
    fn packages_sit_next_to_the_list() {
        assert_eq!(file_url(URL, "Jacket.felinquent"), "https://github.com/abozaralizadeh/Felinquent/releases/download/characters/Jacket.felinquent");
        assert!(file_ok("Jacket.felinquent"));
        assert!(!file_ok("a/b.felinquent") && !file_ok(".x.felinquent") && !file_ok("x.zip"));
    }
}
