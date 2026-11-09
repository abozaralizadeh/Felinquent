//! Start at login.
//!
//! - macOS: a LaunchAgent in ~/Library/LaunchAgents that opens the app. The install script writes
//!   the same file, so both ways of installing agree on it.
//! - Windows: a "Felinquent" value under the current user's Run key in the registry, the way
//!   Windows starts apps when you sign in (and lists them in Settings, Apps, Startup).

#[cfg(target_os = "macos")]
pub use mac::{is_on, set};
#[cfg(windows)]
pub use win::{is_on, set};

#[cfg(target_os = "macos")]
mod mac {
    use std::path::PathBuf;

    const LABEL: &str = "app.felinquent";

    pub(super) fn plist() -> PathBuf {
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
}

#[cfg(windows)]
mod win {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::RegKey;

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const NAME: &str = "Felinquent";

    pub(super) fn is_on_as(name: &str) -> bool {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(RUN, KEY_READ)
            .and_then(|k| k.get_value::<String, _>(name))
            .is_ok_and(|v| !v.trim().is_empty())
    }

    pub(super) fn set_as(name: &str, on: bool) -> bool {
        let Ok((key, _)) = RegKey::predef(HKEY_CURRENT_USER).create_subkey_with_flags(RUN, KEY_SET_VALUE) else {
            return is_on_as(name);
        };
        if on {
            let exe = std::env::current_exe().unwrap_or_default();
            let _ = key.set_value(name, &format!("\"{}\"", exe.display()));
        } else {
            let _ = key.delete_value(name);
        }
        is_on_as(name)
    }

    pub fn is_on() -> bool {
        is_on_as(NAME)
    }

    /// Turns it on or off and returns what it is now.
    pub fn set(on: bool) -> bool {
        set_as(NAME, on)
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn writes_a_valid_launch_agent_and_removes_it() {
        let home = std::env::temp_dir().join(format!("felinquent-login-{}", std::process::id()));
        std::env::set_var("HOME", &home);
        assert!(!super::is_on());
        assert!(super::set(true));
        let lint = std::process::Command::new("plutil").arg("-lint").arg(super::mac::plist()).output().expect("plutil");
        assert!(lint.status.success(), "{}", String::from_utf8_lossy(&lint.stdout));
        assert!(!super::set(false));
        let _ = std::fs::remove_dir_all(&home);
    }

    /// Uses its own value name, so the real "Felinquent" entry is never touched.
    #[cfg(windows)]
    #[test]
    fn writes_the_run_value_and_removes_it() {
        let name = format!("FelinquentTest{}", std::process::id());
        assert!(!super::win::is_on_as(&name));
        assert!(super::win::set_as(&name, true));
        assert!(!super::win::set_as(&name, false));
    }
}
