//! A size-limited log file called overlay.log (5 MB x 3) in the folder from `dir()`,
//! easy to copy when something needs fixing. The overlay never logs window titles.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BYTES: u64 = 5 * 1024 * 1024;
const KEEP: usize = 3;

static LOCK: Mutex<()> = Mutex::new(());

/// macOS: ~/Library/Logs/Felinquent. Windows: %LOCALAPPDATA%\Felinquent\Logs. Elsewhere: ~/.local/state/felinquent.
pub fn dir() -> PathBuf {
    #[cfg(windows)]
    {
        let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
        return PathBuf::from(base).join("Felinquent").join("Logs");
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        return PathBuf::from(home).join("Library/Logs/Felinquent");
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        PathBuf::from(home).join(".local/state/felinquent")
    }
}

/// Opens the log folder in Finder, Explorer or the file manager.
pub fn open_folder() {
    let opener = if cfg!(windows) { "explorer" } else if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    let _ = fs::create_dir_all(dir());
    let _ = std::process::Command::new(opener).arg(dir()).spawn();
}

fn path(n: usize) -> PathBuf {
    dir().join(if n == 0 { "overlay.log".to_string() } else { format!("overlay.log.{n}") })
}

fn rotate() {
    let _ = fs::remove_file(path(KEEP - 1));
    for n in (0..KEEP - 1).rev() {
        let _ = fs::rename(path(n), path(n + 1));
    }
}

pub fn write(line: &str) {
    let _g = LOCK.lock();
    let _ = fs::create_dir_all(dir());
    if fs::metadata(path(0)).map(|m| m.len()).unwrap_or(0) >= MAX_BYTES {
        rotate();
    }
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let f: Option<File> = OpenOptions::new().create(true).append(true).open(path(0)).ok();
    if let Some(mut f) = f {
        let _ = writeln!(f, "{secs} {line}");
    }
}
