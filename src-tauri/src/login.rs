//! Start at login on macOS: a LaunchAgent in ~/Library/LaunchAgents that opens the app.
//! The install script writes the same file, so both ways of installing agree on it.
use std::path::PathBuf;

const LABEL: &str = "app.felinquent";

fn plist() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join("Library/LaunchAgents").join(format!("{LABEL}.plist"))
}

pub fn is_on() -> bool {
    plist().exists()
}

/// Opens the .app this binary runs from, or runs the binary itself outside a bundle (a dev build).
fn program() -> Vec<String> {
    let exe = std::env::current_exe().unwrap_or_default();
    match exe.ancestors().nth(3) {
        Some(app) if app.extension().is_some_and(|e| e == "app") => vec!["/usr/bin/open".into(), app.display().to_string()],
        _ => vec![exe.display().to_string()],
    }
}

fn xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Turns it on or off and returns what it is now.
pub fn set(on: bool) -> bool {
    let path = plist();
    if !on {
        let _ = std::fs::remove_file(&path);
        return is_on();
    }
    let args: String = program().iter().map(|a| format!("<string>{}</string>", xml(a))).collect();
    let text = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key><array>{args}</array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
"#
    );
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&path, text);
    is_on()
}

#[cfg(test)]
mod tests {
    #[test]
    fn writes_a_valid_launch_agent_and_removes_it() {
        let home = std::env::temp_dir().join(format!("felinquent-login-{}", std::process::id()));
        std::env::set_var("HOME", &home);
        assert!(!super::is_on());
        assert!(super::set(true));
        let lint = std::process::Command::new("plutil").arg("-lint").arg(super::plist()).output().expect("plutil");
        assert!(lint.status.success(), "{}", String::from_utf8_lossy(&lint.stdout));
        assert!(!super::set(false));
        let _ = std::fs::remove_dir_all(&home);
    }
}
