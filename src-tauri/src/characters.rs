//! Characters from packages (ADR-069). A package is a `.felinquent` file: a zip holding
//! `character.json`, the drawings as `sprites/<frame>.webp`, maybe an `icon.png` and a `decal.png`. Data only,
//! nothing in it runs. "Add a character…" in the menu picks one, this checks it and unpacks it into
//! the app's own folder (`characters/<id>/` next to the settings), and the page reads it from there
//! (`read_characters`) and checks `character.json` again (src/core/package.ts). "Remove a
//! character" deletes that folder. Nothing is sent anywhere.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::logfile;

/// At most this many files in a package, this big each and in all once unpacked.
const MAX_FILES: usize = 4000;
const MAX_FILE: u64 = 4 << 20;
const MAX_TOTAL: u64 = 400 << 20;

/// The folder the packages are unpacked into.
pub fn dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("characters"))
}

/// 2 to 24 lowercase letters, digits, `-` and `_`, starting with a letter (as in package.ts).
pub fn id_ok(id: &str) -> bool {
    let b = id.as_bytes();
    (2..=24).contains(&b.len()) && b[0].is_ascii_lowercase() && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-' || *c == b'_')
}

/// A frame name: lowercase letters, digits and `_`.
fn key_ok(k: &str) -> bool {
    (1..=32).contains(&k.len()) && k.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
}

fn built_in(id: &str) -> bool {
    crate::CHARACTERS.iter().any(|(item, _)| item.strip_prefix("character:") == Some(id))
}

#[derive(Serialize, Clone)]
pub struct Installed {
    id: String,
    /// `character.json` as it is; the page reads and checks it.
    json: String,
    /// The package's folder, for the page's asset addresses.
    dir: String,
}

/// Every package the user added, for the page.
#[tauri::command]
pub async fn read_characters(app: AppHandle) -> Vec<Installed> {
    installed(&app)
}

pub fn installed(app: &AppHandle) -> Vec<Installed> {
    let Some(root) = dir(app) else { return Vec::new() };
    let Ok(entries) = fs::read_dir(&root) else { return Vec::new() };
    let mut out: Vec<Installed> = entries
        .flatten()
        .filter_map(|e| {
            let id = e.file_name().to_string_lossy().to_string();
            if !id_ok(&id) || built_in(&id) {
                return None;
            }
            let json = fs::read_to_string(e.path().join("character.json")).ok()?;
            Some(Installed { id, json, dir: e.path().to_string_lossy().to_string() })
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

/// What a package holds, after the checks.
#[derive(Debug, PartialEq)]
pub struct Checked {
    pub id: String,
    pub name: String,
    pub frames: usize,
}

/// Checks a package and unpacks it into `root/<id>`, swapping an older copy of the same id.
/// Anything other than `character.json`, `icon.png`, `decal.png` and `sprites/<frame>.webp` is left out (a
/// folder of Mac junk, a readme). Files may sit in one top folder (a zipped folder).
pub fn unpack(file: &Path, root: &Path) -> Result<Checked, String> {
    let f = fs::File::open(file).map_err(|e| format!("can't open the file: {e}"))?;
    let mut zip = zip::ZipArchive::new(f).map_err(|_| "this isn't a character package (not a zip file)".to_string())?;
    if zip.len() > MAX_FILES {
        return Err(format!("it has more than {MAX_FILES} files"));
    }
    // Where character.json is: at the top, or in one folder.
    let mut prefix: Option<String> = None;
    for i in 0..zip.len() {
        let e = zip.by_index_raw(i).map_err(|e| format!("a broken entry: {e}"))?;
        let Some(p) = e.enclosed_name() else { continue };
        let p = p.to_string_lossy().replace('\\', "/");
        if p.starts_with("__MACOSX/") {
            continue;
        }
        if p == "character.json" {
            prefix = Some(String::new());
            break;
        }
        if let Some(top) = p.strip_suffix("/character.json") {
            if !top.contains('/') && prefix.is_none() {
                prefix = Some(format!("{top}/"));
            }
        }
    }
    let prefix = prefix.ok_or("there's no character.json in it")?;

    // character.json first: the id says where it goes.
    let json_text = {
        let mut e = zip.by_name(&format!("{prefix}character.json")).map_err(|_| "there's no character.json in it".to_string())?;
        if e.size() > MAX_FILE {
            return Err("character.json is too big".into());
        }
        let mut s = String::new();
        e.by_ref().take(MAX_FILE).read_to_string(&mut s).map_err(|_| "character.json isn't text".to_string())?;
        s
    };
    let json: serde_json::Value = serde_json::from_str(&json_text).map_err(|e| format!("character.json isn't valid JSON: {e}"))?;
    if json.get("format").and_then(|v| v.as_u64()) != Some(1) {
        return Err("character.json is from a newer version of Felinquent (format isn't 1)".into());
    }
    let id = json.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if !id_ok(&id) {
        return Err("its id must be 2 to 24 lowercase letters, digits, - or _".into());
    }
    if built_in(&id) {
        return Err(format!("{id} is one of the built-in characters"));
    }
    let name = json.get("name").and_then(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && s.chars().count() <= 24).ok_or("its name is missing or longer than 24 characters")?;

    fs::create_dir_all(root).map_err(|e| format!("can't make the characters folder: {e}"))?;
    let incoming = root.join(format!(".incoming-{id}"));
    let _ = fs::remove_dir_all(&incoming);
    fs::create_dir_all(incoming.join("sprites")).map_err(|e| format!("can't write: {e}"))?;
    let result = (|| -> Result<usize, String> {
        let mut total = 0u64;
        let mut frames = 0usize;
        let (mut sit, mut stand) = (false, false);
        for i in 0..zip.len() {
            let mut e = zip.by_index(i).map_err(|e| format!("a broken entry: {e}"))?;
            if e.is_dir() {
                continue;
            }
            let Some(p) = e.enclosed_name() else { return Err("a file in it points outside the package".into()) };
            let p = p.to_string_lossy().replace('\\', "/");
            let Some(rel) = p.strip_prefix(&prefix) else { continue };
            let (dest, magic): (PathBuf, fn(&[u8]) -> bool) = if rel == "character.json" {
                (incoming.join("character.json"), |_| true)
            } else if rel == "icon.png" || rel == "decal.png" {
                (incoming.join(rel), |b| b.starts_with(b"\x89PNG\r\n\x1a\n"))
            } else if let Some(key) = rel.strip_prefix("sprites/").and_then(|f| f.strip_suffix(".webp")) {
                if !key_ok(key) {
                    continue;
                }
                sit |= key == "sit";
                stand |= key == "stand";
                frames += 1;
                (incoming.join("sprites").join(format!("{key}.webp")), |b| b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP")
            } else {
                continue;
            };
            if e.size() > MAX_FILE {
                return Err(format!("{rel} is bigger than 4 MB"));
            }
            let mut bytes = Vec::with_capacity(e.size() as usize);
            e.by_ref().take(MAX_FILE + 1).read_to_end(&mut bytes).map_err(|err| format!("can't read {rel}: {err}"))?;
            if bytes.len() as u64 > MAX_FILE {
                return Err(format!("{rel} is bigger than 4 MB"));
            }
            total += bytes.len() as u64;
            if total > MAX_TOTAL {
                return Err("it's bigger than 400 MB unpacked".into());
            }
            if !magic(&bytes) {
                return Err(format!("{rel} isn't the picture it says it is"));
            }
            fs::write(&dest, &bytes).map_err(|err| format!("can't write {rel}: {err}"))?;
        }
        if !sit || !stand {
            return Err("it needs at least sprites/sit.webp and sprites/stand.webp".into());
        }
        Ok(frames)
    })();
    let frames = match result {
        Ok(n) => n,
        Err(e) => {
            let _ = fs::remove_dir_all(&incoming);
            return Err(e);
        }
    };
    let dest = root.join(&id);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("can't replace the old copy: {e}"))?;
    }
    fs::rename(&incoming, &dest).map_err(|e| format!("can't put it in place: {e}"))?;
    Ok(Checked { id, name, frames })
}

/// Adds the package at `file` and tells the page, which switches to the new character.
pub fn add(app: &AppHandle, file: &Path, quiet: bool) {
    let Some(root) = dir(app) else { return };
    match unpack(file, &root) {
        Ok(c) => {
            logfile::write(&format!("characters: added {} ({} frames)", c.id, c.frames));
            let _ = app.emit_to("overlay", "ctl", format!("packs:{}", c.id));
        }
        Err(e) => {
            logfile::write(&format!("characters: can't add {}: {e}", file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
            #[cfg(any(target_os = "macos", windows))]
            if !quiet {
                let press = std::env::var("FELINQUENT_CHARACTER_TEST").ok().and_then(|s| crate::alert::test_press(&s));
                crate::alert::ask(app, "Couldn't add that character", &format!("This file can't be used: {e}."), &["OK"], 0, press);
            }
            let _ = quiet;
        }
    }
}

/// "Add a character…": a file picker, then `add`. Runs on its own thread (the picker waits).
pub fn pick_and_add(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || match pick() {
        Some(file) => add(&app, &file, false),
        None => logfile::write("characters: no file picked"),
    });
}

/// "Remove <name>": asks, then deletes its folder and tells the page.
pub fn remove(app: &AppHandle, id: &str) {
    if !id_ok(id) || built_in(id) {
        return;
    }
    let app = app.clone();
    let id = id.to_string();
    std::thread::spawn(move || {
        let Some(root) = dir(&app) else { return };
        let name = installed(&app).into_iter().find(|c| c.id == id).and_then(|c| serde_json::from_str::<serde_json::Value>(&c.json).ok()).and_then(|v| v.get("name").and_then(|n| n.as_str()).map(String::from)).unwrap_or_else(|| id.clone());
        #[cfg(any(target_os = "macos", windows))]
        {
            let press = std::env::var("FELINQUENT_CHARACTER_TEST").ok().and_then(|s| crate::alert::test_press(&s));
            let answer = crate::alert::ask(&app, &format!("Remove {name}?"), "It goes away from this computer. You can add it again from its package file.", &["Remove", "Cancel"], 1, press);
            if answer != 0 {
                logfile::write(&format!("characters: kept {id}"));
                return;
            }
        }
        match fs::remove_dir_all(root.join(&id)) {
            Ok(()) => logfile::write(&format!("characters: removed {id}")),
            Err(e) => logfile::write(&format!("characters: can't remove {id}: {e}")),
        }
        let _ = app.emit_to("overlay", "ctl", "packs".to_string());
    });
}

/// A native file picker. None when nothing was picked.
#[cfg(target_os = "macos")]
fn pick() -> Option<PathBuf> {
    // AppleScript's picker: no extra code in the app, and it comes to the front by itself.
    let out = std::process::Command::new("/usr/bin/osascript")
        .args(["-e", "activate", "-e", "POSIX path of (choose file with prompt \"Pick a Felinquent character (a .felinquent file)\")"])
        .output()
        .ok()?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !path.is_empty()).then(|| PathBuf::from(path))
}

#[cfg(windows)]
fn pick() -> Option<PathBuf> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::UI::Controls::Dialogs::{GetOpenFileNameW, OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_NOCHANGEDIR, OFN_PATHMUSTEXIST, OPENFILENAMEW};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let filter: Vec<u16> = "Felinquent characters (*.felinquent)\0*.felinquent;*.zip\0All files\0*.*\0\0".encode_utf16().collect();
    let title = wide("Pick a Felinquent character");
    let mut buf = vec![0u16; 4096];
    let mut ofn = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        lpstrFilter: PCWSTR(filter.as_ptr()),
        lpstrFile: PWSTR(buf.as_mut_ptr()),
        nMaxFile: buf.len() as u32,
        lpstrTitle: PCWSTR(title.as_ptr()),
        Flags: OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR,
        ..Default::default()
    };
    // SAFETY: every pointer in `ofn` points at a buffer that lives until the call returns.
    if !unsafe { GetOpenFileNameW(&mut ofn) }.as_bool() {
        return None;
    }
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(PathBuf::from(String::from_utf16_lossy(&buf[..end])))
}

#[cfg(not(any(target_os = "macos", windows)))]
fn pick() -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn webp() -> Vec<u8> {
        let mut b = b"RIFF\x10\x00\x00\x00WEBPVP8 ".to_vec();
        b.extend_from_slice(&[0; 8]);
        b
    }

    fn make(path: &Path, files: &[(&str, Vec<u8>)]) {
        let f = fs::File::create(path).unwrap();
        let mut z = zip::ZipWriter::new(f);
        for (name, bytes) in files {
            z.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(bytes).unwrap();
        }
        z.finish().unwrap();
    }

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("felinquent-pkg-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    const JSON: &str = r#"{"format":1,"id":"sprout","name":"Sprout"}"#;

    #[test]
    fn unpacks_a_good_package_and_leaves_the_rest_out() {
        let d = scratch("good");
        let file = d.join("t.felinquent");
        make(&file, &[("character.json", JSON.into()), ("sprites/sit.webp", webp()), ("sprites/stand.webp", webp()), ("readme.txt", b"hi".to_vec()), ("sprites/Bad Name.webp", webp()), ("decal.png", b"\x89PNG\r\n\x1a\nbadge".to_vec())]);
        let c = unpack(&file, &d.join("chars")).unwrap();
        assert_eq!(c, Checked { id: "sprout".into(), name: "Sprout".into(), frames: 2 });
        assert!(d.join("chars/sprout/sprites/sit.webp").exists());
        assert!(d.join("chars/sprout/decal.png").exists());
        assert!(!d.join("chars/sprout/readme.txt").exists());
        assert!(!d.join("chars/.incoming-sprout").exists());
    }

    #[test]
    fn a_zipped_folder_works_too() {
        let d = scratch("folder");
        let file = d.join("t.zip");
        make(&file, &[("Sprout/character.json", JSON.into()), ("Sprout/sprites/sit.webp", webp()), ("Sprout/sprites/stand.webp", webp()), ("__MACOSX/Sprout/._character.json", b"x".to_vec())]);
        assert_eq!(unpack(&file, &d.join("chars")).unwrap().frames, 2);
    }

    #[test]
    fn refuses_bad_packages() {
        let d = scratch("bad");
        let root = d.join("chars");
        let cases: Vec<(&str, Vec<(&str, Vec<u8>)>, &str)> = vec![
            ("nojson", vec![("sprites/sit.webp", webp())], "no character.json"),
            ("builtin", vec![("character.json", br#"{"format":1,"id":"tabby","name":"T"}"#.to_vec()), ("sprites/sit.webp", webp()), ("sprites/stand.webp", webp())], "built-in"),
            ("badid", vec![("character.json", br#"{"format":1,"id":"../x","name":"T"}"#.to_vec())], "id must be"),
            ("format", vec![("character.json", br#"{"format":2,"id":"sprout","name":"T"}"#.to_vec())], "newer version"),
            ("nosit", vec![("character.json", JSON.into()), ("sprites/stand.webp", webp())], "sit.webp"),
            ("notwebp", vec![("character.json", JSON.into()), ("sprites/sit.webp", b"#!/bin/sh\nrm -rf /".to_vec()), ("sprites/stand.webp", webp())], "isn't the picture"),
            ("escape", vec![("character.json", JSON.into()), ("../evil.webp", webp())], "outside"),
        ];
        for (name, files, want) in cases {
            let file = d.join(format!("{name}.felinquent"));
            make(&file, &files);
            let err = unpack(&file, &root).unwrap_err();
            assert!(err.contains(want), "{name}: {err}");
            assert!(!root.join("sprout").exists(), "{name} left files behind");
        }
        let junk = d.join("junk.felinquent");
        fs::write(&junk, b"not a zip").unwrap();
        assert!(unpack(&junk, &root).unwrap_err().contains("not a zip"));
    }

    #[test]
    fn ids() {
        assert!(id_ok("sprout") && id_ok("my-pet_2"));
        assert!(!id_ok("T") && !id_ok("Sprout") && !id_ok("1abc") && !id_ok("a/b") && !id_ok("ab.c"));
    }
}
