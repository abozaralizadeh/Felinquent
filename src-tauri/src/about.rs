//! The About window (ADR-062): the version line at the top of the menu opens it. Made with love by
//! Abozar, with a button that opens the code on GitHub (asking for a star) and one for the website.
//! The buttons, and the Privacy link (ADR-065), open your browser at three fixed addresses; the
//! window itself sends nothing.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::logfile;

const SITE: &str = "https://abozaralizadeh.github.io/Felinquent/";
const REPO: &str = "https://github.com/abozaralizadeh/Felinquent";
const PRIVACY: &str = "https://github.com/abozaralizadeh/Felinquent/blob/main/PRIVACY.md";

/// Opens the About window, or brings it to the front when it is open already.
pub fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("about") {
        let _ = w.show();
        let _ = w.set_focus();
        activate(app);
        return;
    }
    // The page shows the version; it is set before the page's own script runs.
    let version = app.package_info().version.to_string().replace(['"', '\\'], "");
    let built = WebviewWindowBuilder::new(app, "about", WebviewUrl::App("about.html".into()))
        .title("About Felinquent")
        .inner_size(360.0, 510.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .center()
        .focused(true)
        .initialization_script(format!("window.FELINQUENT_VERSION = \"{version}\";"))
        .build();
    match built {
        Ok(w) => {
            let _ = w.set_focus();
            activate(app);
            logfile::write("about: open");
        }
        Err(e) => logfile::write(&format!("about: could not open ({e})")),
    }
}

/// The app has no Dock icon (an accessory app), so on a Mac it has to be brought forward by hand
/// for its window to come to the front.
fn activate(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(|| {
            if let Some(mtm) = objc2::MainThreadMarker::new() {
                #[allow(deprecated)]
                objc2_app_kit::NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// The page's two buttons, its Privacy link, Escape, and "shown" when the page has loaded (only logged).
#[tauri::command]
pub fn about_action(app: AppHandle, what: String) {
    match what.as_str() {
        "site" => open_url(SITE),
        "repo" => open_url(REPO),
        "privacy" => open_url(PRIVACY),
        "close" => {
            if let Some(w) = app.get_webview_window("about") {
                let _ = w.close();
            }
        }
        _ => {}
    }
    logfile::write(&format!("about: {what}"));
}

/// Opens one of the three fixed addresses in the default browser.
fn open_url(url: &str) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    // Explorer hands a web address to the default browser.
    #[cfg(windows)]
    let _ = std::process::Command::new("explorer").arg(url).spawn();
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}
