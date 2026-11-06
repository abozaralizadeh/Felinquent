//! Guided setup of the local model (macOS). When "Use the local model" is turned on and the model
//! isn't there, the page calls `model_setup`. This looks at what is missing and asks first, with
//! a native question:
//!
//! - no Ollama at all: download the Ollama app from its GitHub release, check it against the
//!   release's sha256sum.txt, unzip it, check its code signature and that Ollama's team signed it,
//!   put it in Applications (or ~/Applications) and open it, then get the model.
//! - Ollama installed but not running: start it and wait up to a minute for it to answer.
//! - Ollama running without the model: ask Ollama to pull it.
//!
//! Progress shows in the model's menu item. When it all works, the page gets the `ctl` message
//! "model-ready"; when something fails it gets "model-failed" and the user gets a short message.
//! "Not now" sends nothing, so the cat carries on with its rules. Only local addresses are used
//! for the Ollama server (the same rule as `isLocalUrl` on the page). The download talks to
//! github.com and GitHub's download host, nothing else.
//!
//! Test hooks:
//! - `FELINQUENT_MODEL_TEST=<n>[,<n>…][@seconds][:reason]` presses button n of each setup question
//!   after the given seconds (3 unless given). 0 is the first button. With a list, the first
//!   question gets the first number, the next one the next, and the last number repeats. With
//!   `:reason` (no-ollama, not-running or no-model) the app starts that setup by itself 5 s after
//!   launch, as if the page had asked, and takes the reason as it is instead of looking.
//! - `FELINQUENT_OLLAMA_DIR=<dir>` installs Ollama.app into that folder instead of Applications
//!   and doesn't open it.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use tauri::menu::CheckMenuItem;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::alert::{self, short};
use crate::logfile;

/// Where the Ollama app comes from.
const REPO: &str = "https://github.com/ollama/ollama";
/// The release asset with the Mac app in it.
const ZIP: &str = "Ollama-darwin.zip";
/// The size of that zip, for the question (229 MB in v0.40.15, Nov 2026). The space doesn't
/// break, so the number and MB stay on one line.
const ZIP_SIZE: &str = "about 230\u{a0}MB";
/// The Apple team that signs Ollama.app (Infra Technologies, Inc).
const TEAM: &str = "3MU9H2V9Y9";
/// Refuse a download bigger than this.
const MAX_ZIP: u64 = 2 * 1024 * 1024 * 1024;
/// Where the user can do it by hand.
const SITE: &str = "https://ollama.com/download";
const AGENT: &str = concat!("Felinquent/", env!("CARGO_PKG_VERSION"));

/// A setup is running, so a second call doesn't start another.
static RUNNING: AtomicBool = AtomicBool::new(false);
/// Questions asked so far, for the test hook's list.
static ASKED: AtomicUsize = AtomicUsize::new(0);

/// The model's menu item, which shows the progress, and its own text to put back.
pub struct Item {
    item: CheckMenuItem<Wry>,
    text: String,
}

/// Keeps the menu item. Call it once, after the menu is built.
pub fn menu_item(app: &tauri::App, item: &CheckMenuItem<Wry>) {
    let text = item.text().unwrap_or_else(|_| "Use the local model".into());
    app.manage(Item { item: item.clone(), text });
}

/// What is missing.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Need {
    Nothing,
    Ollama,
    Start,
    Model,
}

impl Need {
    fn parse(s: &str) -> Option<Need> {
        match s {
            "no-ollama" => Some(Need::Ollama),
            "not-running" => Some(Need::Start),
            "no-model" => Some(Need::Model),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Need::Nothing => "ready",
            Need::Ollama => "no-ollama",
            Need::Start => "not-running",
            Need::Model => "no-model",
        }
    }
}

/// Why the setup stopped: what didn't work, and the reason.
struct Failure {
    what: &'static str,
    why: String,
}

fn fail(what: &'static str) -> impl FnOnce(String) -> Failure {
    move |why| Failure { what, why }
}

/// The page's way in. Returns at once: true when a setup started, false when it was refused or
/// one is already running. The answer comes later as a `ctl` message.
pub fn setup(app: AppHandle, reason: &str, model: String, url: String) -> bool {
    begin(app, reason, model, url, false)
}

/// The test hook: with a reason in FELINQUENT_MODEL_TEST, start that setup 5 s after launch.
pub fn start(app: &AppHandle) {
    let Some(reason) = test_hook().and_then(|t| t.reason) else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(5));
        let (url, model) = crate::ollama_target();
        logfile::write(&format!("model setup: test start ({reason})"));
        begin(app, &reason, model, url, true);
    });
}

fn begin(app: AppHandle, reason: &str, model: String, url: String, as_given: bool) -> bool {
    let Some(hint) = Need::parse(reason) else {
        logfile::write(&format!("model setup: refused, unknown reason {:?}", short(reason, 40)));
        return false;
    };
    if !is_local_url(&url) {
        logfile::write("model setup: refused, the model address is not local");
        return false;
    }
    if !is_model_name(&model) {
        logfile::write("model setup: refused, odd model name");
        return false;
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        logfile::write("model setup: already running");
        return false;
    }
    let url = url.trim_end_matches('/').to_string();
    std::thread::spawn(move || {
        let _done = Done(app.clone());
        // The page can only see whether the server answers, so look again here.
        let need = if as_given { hint } else { look(&url, &model) };
        logfile::write(&format!("model setup: asked for {}, found {} ({model})", hint.name(), need.name()));
        match run(&app, need, &url, &model) {
            Ok(true) => {
                logfile::write(&format!("model setup: {model} is ready"));
                let _ = app.emit_to("overlay", "ctl", "model-ready".to_string());
            }
            Ok(false) => logfile::write("model setup: not now"),
            Err(f) => {
                let why = scrub(&f.why);
                logfile::write(&format!("model setup: failed. {}: {why}", f.what));
                let _ = app.emit_to("overlay", "ctl", "model-failed".to_string());
                restore(&app);
                let text = format!(
                    "{}: {}\n\nThe cat carries on with its own rules for now. You can try again from the menu, or set Ollama up yourself from ollama.com.",
                    f.what,
                    short(&why, 200)
                );
                let answer = question(&app, "The local model isn't set up", &text, &["Open ollama.com", "Close"]);
                logfile::write(&format!("model setup: told the user, answer {}", ["open ollama.com", "close"].get(answer).unwrap_or(&"none")));
                if answer == 0 {
                    open_site();
                }
            }
        }
    });
    true
}

/// Puts the menu text back and lets the next setup run, however this one ends.
struct Done(AppHandle);

impl Drop for Done {
    fn drop(&mut self) {
        restore(&self.0);
        RUNNING.store(false, Ordering::SeqCst);
    }
}

fn run(app: &AppHandle, need: Need, url: &str, model: &str) -> Result<bool, Failure> {
    match need {
        Need::Nothing => Ok(true),
        Need::Model => get_model(app, url, model, true),
        Need::Start => {
            let text = "The local model runs in Ollama. It's on this Mac but it isn't running right now.";
            let answer = question(app, "Ollama isn't running", text, &["Start Ollama", "Not now"]);
            logfile::write(&format!("model setup: asked to start Ollama, answer {}", ["start", "not now"].get(answer).unwrap_or(&"none")));
            if answer != 0 {
                return Ok(false);
            }
            start_ollama(app, url)?;
            after_start(app, url, model, true)
        }
        Need::Ollama => {
            let what = match model_size(model) {
                Some(size) => format!("the model (about {size})"),
                None => format!("the model {model}"),
            };
            let text = format!(
                "The cat can think with a small model that runs on this Mac, through Ollama, a free app.\n\nThis downloads Ollama ({ZIP_SIZE}) and {what}. After that the cat thinks on your Mac and nothing it sees leaves it."
            );
            let answer = question(app, "Set up the local model?", &text, &["Install", "Open ollama.com", "Not now"]);
            logfile::write(&format!("model setup: asked to install Ollama, answer {}", ["install", "open ollama.com", "not now"].get(answer).unwrap_or(&"none")));
            match answer {
                0 => {}
                1 => {
                    open_site();
                    return Ok(false);
                }
                _ => return Ok(false),
            }
            let installed = install(app).map_err(fail("Ollama didn't install"))?;
            if test_dir().is_some() {
                logfile::write("model setup: test folder, so Ollama is not opened");
            } else {
                show(app, "Starting Ollama…");
                open_app(&installed).map_err(fail("Ollama didn't start"))?;
            }
            wait_for(app, url, 90).map_err(fail("Ollama didn't start"))?;
            // The first question already said the model comes too.
            after_start(app, url, model, false)
        }
    }
}

/// Ollama answers now. Gets the model if it's missing.
fn after_start(app: &AppHandle, url: &str, model: &str, ask_first: bool) -> Result<bool, Failure> {
    match has_model(url, model) {
        Ok(true) => Ok(true),
        Ok(false) => get_model(app, url, model, ask_first),
        Err(e) => Err(Failure { what: "Couldn't reach Ollama", why: e }),
    }
}

fn get_model(app: &AppHandle, url: &str, model: &str, ask_first: bool) -> Result<bool, Failure> {
    if ask_first {
        let (size, button) = match model_size(model) {
            Some(s) => (format!("a one-time download of about {s}"), format!("Get the model ({s})")),
            None => ("a one-time download".into(), "Get the model".into()),
        };
        let text = format!("Ollama is running but doesn't have the model the cat thinks with ({model}). It's {size}, and after that it runs on your Mac.");
        let answer = question(app, "Get the cat's brain?", &text, &[&button, "Not now"]);
        logfile::write(&format!("model setup: asked to get {model}, answer {}", ["get it", "not now"].get(answer).unwrap_or(&"none")));
        if answer != 0 {
            return Ok(false);
        }
    }
    pull(app, url, model).map_err(fail("The model didn't download"))?;
    Ok(true)
}

/// The download size of the models we know, for the question.
fn model_size(model: &str) -> Option<&'static str> {
    match model {
        "gemma3:1b" => Some("815\u{a0}MB"),
        _ => None,
    }
}

// ---- Asking and showing ----------------------------------------------------------------

struct TestHook {
    presses: Vec<usize>,
    secs: f64,
    reason: Option<String>,
}

fn parse_test_hook(spec: &str) -> Option<TestHook> {
    let (rest, reason) = match spec.split_once(':') {
        Some((rest, r)) => (rest, Some(r.trim().to_string()).filter(|r| !r.is_empty())),
        None => (spec, None),
    };
    let (list, secs) = match rest.split_once('@') {
        Some((list, s)) => (list, s.trim().parse().unwrap_or(3.0)),
        None => (rest, 3.0),
    };
    let presses = list.split(',').map(|n| n.trim().parse().ok()).collect::<Option<Vec<usize>>>()?;
    Some(TestHook { presses, secs, reason })
}

fn test_hook() -> Option<TestHook> {
    std::env::var("FELINQUENT_MODEL_TEST").ok().and_then(|t| parse_test_hook(&t))
}

fn press_for(hook: &TestHook, n: usize) -> Option<(usize, f64)> {
    hook.presses.get(n).or(hook.presses.last()).map(|b| (*b, hook.secs))
}

/// A setup question. Escape is the last button (Not now, or Close).
fn question(app: &AppHandle, title: &str, text: &str, buttons: &[&str]) -> usize {
    let n = ASKED.fetch_add(1, Ordering::SeqCst);
    let press = test_hook().and_then(|h| press_for(&h, n));
    alert::ask(app, title, text, buttons, buttons.len().saturating_sub(1), press)
}

fn show(app: &AppHandle, text: &str) {
    if let Some(i) = app.try_state::<Item>() {
        let _ = i.item.set_text(text);
    }
}

fn restore(app: &AppHandle) {
    if let Some(i) = app.try_state::<Item>() {
        let _ = i.item.set_text(&i.text);
    }
}

fn open_site() {
    logfile::write("model setup: opening ollama.com");
    let _ = Command::new("/usr/bin/open").arg(SITE).spawn();
}

/// Paths in messages and logs show the home folder as ~, so the user name stays out.
fn scrub(s: &str) -> String {
    match std::env::var("HOME") {
        Ok(home) if home.len() > 1 => s.replace(&home, "~"),
        _ => s.to_string(),
    }
}

// ---- Looking -------------------------------------------------------------------------------

/// The same rule as `isLocalUrl` on the page: localhost, 127.0.0.1, ::1 or a .localhost name.
pub fn is_local_url(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else { return false };
    if u.scheme() != "http" && u.scheme() != "https" {
        return false;
    }
    let host = u.host_str().unwrap_or("");
    host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1" || host.ends_with(".localhost")
}

/// Names like gemma3:1b or library/llama3.2:3b. Nothing else goes to Ollama.
fn is_model_name(model: &str) -> bool {
    !model.is_empty() && model.len() <= 100 && model.chars().all(|c| c.is_ascii_alphanumeric() || "._:/-".contains(c))
}

/// The Ollama app, in Applications or ~/Applications.
fn find_app() -> Option<PathBuf> {
    let mut places = vec![PathBuf::from("/Applications/Ollama.app")];
    if let Ok(home) = std::env::var("HOME") {
        places.push(Path::new(&home).join("Applications/Ollama.app"));
    }
    places.into_iter().find(|p| p.is_dir())
}

/// The command-line ollama, from the app's helper link or Homebrew.
fn find_bin() -> Option<PathBuf> {
    ["/usr/local/bin/ollama", "/opt/homebrew/bin/ollama"].iter().map(PathBuf::from).find(|p| p.is_file())
}

fn test_dir() -> Option<PathBuf> {
    std::env::var("FELINQUENT_OLLAMA_DIR").ok().filter(|d| !d.trim().is_empty()).map(PathBuf::from)
}

fn look(url: &str, model: &str) -> Need {
    match has_model(url, model) {
        Ok(true) => Need::Nothing,
        Ok(false) => Need::Model,
        Err(_) if find_app().is_some() || find_bin().is_some() => Need::Start,
        Err(_) => Need::Ollama,
    }
}

fn block_on<T>(f: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(f)
}

/// reqwest is built with rustls but no crypto provider; the updater installs ring the same way.
fn tls_ready() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

/// For the Ollama server on this Mac. Never through a proxy.
fn local_client(read: Duration) -> Result<reqwest::Client, String> {
    tls_ready();
    reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(2))
        .read_timeout(read)
        .user_agent(AGENT)
        .build()
        .map_err(|e| e.to_string())
}

fn version(url: &str) -> Result<String, String> {
    block_on(async {
        let client = local_client(Duration::from_secs(3))?;
        let r = client.get(format!("{url}/api/version")).timeout(Duration::from_secs(3)).send().await.map_err(|e| e.to_string())?;
        let v: serde_json::Value = r.error_for_status().map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        Ok(v["version"].as_str().unwrap_or("?").to_string())
    })
}

/// Whether Ollama has the model, by the same rule as the page: the exact name, or name:tag.
fn has_model(url: &str, model: &str) -> Result<bool, String> {
    block_on(async {
        let client = local_client(Duration::from_secs(3))?;
        let r = client.get(format!("{url}/api/tags")).timeout(Duration::from_secs(3)).send().await.map_err(|e| e.to_string())?;
        let v: serde_json::Value = r.error_for_status().map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        Ok(model_in_tags(&v, model))
    })
}

fn model_in_tags(tags: &serde_json::Value, model: &str) -> bool {
    let prefix = format!("{model}:");
    tags["models"].as_array().is_some_and(|ms| ms.iter().filter_map(|m| m["name"].as_str()).any(|n| n == model || n.starts_with(&prefix)))
}

/// Waits for the server to answer, up to `secs` seconds.
fn wait_for(app: &AppHandle, url: &str, secs: u64) -> Result<(), String> {
    let t0 = Instant::now();
    loop {
        if let Ok(v) = version(url) {
            logfile::write(&format!("model setup: Ollama {v} answers after {} s", t0.elapsed().as_secs()));
            return Ok(());
        }
        if t0.elapsed() >= Duration::from_secs(secs) {
            return Err(format!("it didn't answer within {secs} seconds"));
        }
        show(app, "Starting Ollama…");
        std::thread::sleep(Duration::from_secs(1));
    }
}

// ---- Starting ------------------------------------------------------------------------------

fn open_app(path: &Path) -> Result<(), String> {
    let ok = Command::new("/usr/bin/open").arg("-a").arg(path).status().map_err(|e| e.to_string())?.success();
    if ok {
        Ok(())
    } else {
        Err("macOS couldn't open the app".into())
    }
}

fn start_ollama(app: &AppHandle, url: &str) -> Result<(), Failure> {
    show(app, "Starting Ollama…");
    if let Some(path) = find_app() {
        logfile::write(&format!("model setup: opening {}", scrub(&path.display().to_string())));
        open_app(&path).map_err(fail("Ollama didn't start"))?;
    } else if let Some(bin) = find_bin() {
        logfile::write(&format!("model setup: running {} serve", bin.display()));
        let mut cmd = Command::new(&bin);
        cmd.arg("serve").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        if let Ok(u) = reqwest::Url::parse(url) {
            if let (Some(host), Some(port)) = (u.host_str(), u.port_or_known_default()) {
                cmd.env("OLLAMA_HOST", format!("{host}:{port}"));
            }
        }
        let mut child = cmd.spawn().map_err(|e| Failure { what: "Ollama didn't start", why: e.to_string() })?;
        // Reap it when it ends, so it never lingers as a zombie.
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    } else {
        return Err(Failure { what: "Ollama didn't start", why: "it isn't installed".into() });
    }
    wait_for(app, url, 60).map_err(fail("Ollama didn't start"))
}

// ---- Installing ----------------------------------------------------------------------------

/// Downloads, checks and installs Ollama.app. Returns where it went.
fn install(app: &AppHandle) -> Result<PathBuf, String> {
    // Never replace an Ollama.app, so don't download one that has nowhere to go.
    if let Some(dir) = install_dirs().into_iter().find(|d| d.join("Ollama.app").exists()) {
        return Err(format!("there's already an Ollama.app in {}", scrub(&dir.display().to_string())));
    }
    let work = std::env::temp_dir().join(format!("felinquent-ollama-{}", std::process::id()));
    // Our own scratch folder from an earlier try, if any.
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).map_err(|e| format!("couldn't make a temp folder: {e}"))?;
    let result = install_in(app, &work);
    let _ = std::fs::remove_dir_all(&work);
    result
}

fn install_in(app: &AppHandle, work: &Path) -> Result<PathBuf, String> {
    show(app, "Getting Ollama…");
    let tag = block_on(latest_tag())?;
    logfile::write(&format!("model setup: Ollama {tag} from GitHub"));
    let sums = block_on(get_text(&format!("{REPO}/releases/download/{tag}/sha256sum.txt")))?;
    let want = checksum_for(&sums, ZIP).ok_or_else(|| format!("the release has no checksum for {ZIP}"))?;
    let zip = work.join(ZIP);
    let got = block_on(download(app, &format!("{REPO}/releases/download/{tag}/{ZIP}"), &zip))?;
    if got != want {
        return Err("the download doesn't match its checksum".into());
    }
    logfile::write("model setup: checksum matches sha256sum.txt");
    show(app, "Checking Ollama…");
    let unpacked = work.join("unpacked");
    let ok = Command::new("/usr/bin/ditto").args(["-x", "-k"]).arg(&zip).arg(&unpacked).status().map_err(|e| e.to_string())?.success();
    let bundle = unpacked.join("Ollama.app");
    if !ok || !bundle.is_dir() {
        return Err("the zip didn't hold Ollama.app".into());
    }
    let _ = std::fs::remove_file(&zip);
    check_signature(&bundle)?;
    logfile::write(&format!("model setup: signature checks out, team {TEAM}"));
    let placed = place(&bundle)?;
    logfile::write(&format!("model setup: installed in {}", if test_dir().is_some() { "the test folder".to_string() } else { scrub(&placed.display().to_string()) }));
    Ok(placed)
}

/// Every request to GitHub: https only, and redirects only to GitHub's own hosts.
fn github_client(follow: bool) -> Result<reqwest::Client, String> {
    tls_ready();
    let policy = if follow {
        reqwest::redirect::Policy::custom(|attempt| {
            let ok = attempt.url().scheme() == "https" && attempt.url().host_str().is_some_and(is_github_host);
            if attempt.previous().len() >= 10 {
                attempt.error("too many redirects")
            } else if ok {
                attempt.follow()
            } else {
                attempt.error("GitHub sent the download somewhere else")
            }
        })
    } else {
        reqwest::redirect::Policy::none()
    };
    reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .redirect(policy)
        .user_agent(AGENT)
        .build()
        .map_err(|e| e.to_string())
}

fn is_github_host(host: &str) -> bool {
    host == "github.com" || host.ends_with(".githubusercontent.com")
}

/// The newest release's tag, from where /releases/latest redirects to. Fetching the checksum file
/// and the zip from that one tag keeps them from two different releases.
async fn latest_tag() -> Result<String, String> {
    let r = github_client(false)?.get(format!("{REPO}/releases/latest")).send().await.map_err(|e| format!("GitHub didn't answer ({e})"))?;
    let to = r.headers().get(reqwest::header::LOCATION).and_then(|l| l.to_str().ok()).unwrap_or("");
    tag_from(to).ok_or_else(|| format!("GitHub didn't say which release is the newest ({})", r.status()))
}

fn tag_from(location: &str) -> Option<String> {
    let tag = location.split("/releases/tag/").nth(1)?.trim_end_matches('/');
    let ok = !tag.is_empty() && tag.len() <= 40 && tag.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    ok.then(|| tag.to_string())
}

async fn get_text(url: &str) -> Result<String, String> {
    let r = github_client(true)?.get(url).send().await.map_err(|e| format!("GitHub didn't answer ({e})"))?;
    let r = r.error_for_status().map_err(|e| e.to_string())?;
    r.text().await.map_err(|e| e.to_string())
}

/// The SHA-256 for `name` in a sha256sum.txt ("<hex>  ./name" lines).
fn checksum_for(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let (hash, file) = (parts.next()?, parts.next()?);
        let file = file.trim_start_matches('*').trim_start_matches("./");
        (file == name && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit())).then(|| hash.to_ascii_lowercase())
    })
}

/// Saves the file and returns its SHA-256. The menu item shows how far it got.
async fn download(app: &AppHandle, url: &str, to: &Path) -> Result<String, String> {
    let mut r = github_client(true)?.get(url).send().await.map_err(|e| format!("GitHub didn't answer ({e})"))?;
    r = r.error_for_status().map_err(|e| e.to_string())?;
    let total = r.content_length().unwrap_or(0);
    if total > MAX_ZIP {
        return Err("the download is far bigger than it should be".into());
    }
    logfile::write(&format!("model setup: downloading {ZIP}, {} MB", total / 1_000_000));
    let mut file = std::fs::File::create(to).map_err(|e| format!("couldn't save the download: {e}"))?;
    let mut hash = ring::digest::Context::new(&ring::digest::SHA256);
    let (mut got, mut shown, mut logged) = (0u64, u64::MAX, 0u64);
    while let Some(chunk) = r.chunk().await.map_err(|e| format!("the download stopped ({e})"))? {
        got += chunk.len() as u64;
        if got > MAX_ZIP {
            return Err("the download is far bigger than it should be".into());
        }
        hash.update(&chunk);
        file.write_all(&chunk).map_err(|e| format!("couldn't save the download: {e}"))?;
        if let Some(pct) = (got * 100).checked_div(total).map(|p| p.min(100)) {
            if pct != shown {
                shown = pct;
                show(app, &format!("Getting Ollama… {pct}%"));
            }
            if pct >= logged + 25 {
                logged = pct - pct % 25;
                logfile::write(&format!("model setup: Ollama download {logged}%"));
            }
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    if total > 0 && got != total {
        return Err("the download stopped before the end".into());
    }
    Ok(hex(hash.finish().as_ref()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A valid, sealed signature, made by Ollama's team.
fn check_signature(bundle: &Path) -> Result<(), String> {
    let verify = Command::new("/usr/bin/codesign").args(["--verify", "--deep", "--strict"]).arg(bundle).output().map_err(|e| e.to_string())?;
    if !verify.status.success() {
        let why = String::from_utf8_lossy(&verify.stderr).lines().next().unwrap_or("").to_string();
        return Err(format!("its signature doesn't check out ({})", short(&why, 120)));
    }
    let info = Command::new("/usr/bin/codesign").args(["-dv", "--verbose=2"]).arg(bundle).output().map_err(|e| e.to_string())?;
    let team = team_of(&String::from_utf8_lossy(&info.stderr));
    match team.as_deref() {
        Some(TEAM) => Ok(()),
        Some(other) => Err(format!("it's signed by someone else (team {other})")),
        None => Err("it isn't signed by a team".into()),
    }
}

fn team_of(codesign_output: &str) -> Option<String> {
    codesign_output.lines().find_map(|l| l.strip_prefix("TeamIdentifier=")).map(|t| t.trim().to_string()).filter(|t| t != "not set")
}

/// The test folder, or /Applications and then ~/Applications.
fn install_dirs() -> Vec<PathBuf> {
    match test_dir() {
        Some(d) => vec![d],
        None => {
            let mut v = vec![PathBuf::from("/Applications")];
            if let Ok(home) = std::env::var("HOME") {
                v.push(Path::new(&home).join("Applications"));
            }
            v
        }
    }
}

/// Moves the app into the test folder, /Applications, or ~/Applications when /Applications
/// can't be written to. Never replaces an Ollama.app that is already there.
fn place(bundle: &Path) -> Result<PathBuf, String> {
    let dirs = install_dirs();
    let mut last = String::from("there's nowhere to put it");
    for (i, dir) in dirs.iter().enumerate() {
        let target = dir.join("Ollama.app");
        if target.exists() {
            return Err(format!("there's already an Ollama.app in {}", scrub(&dir.display().to_string())));
        }
        if i > 0 || test_dir().is_some() {
            let _ = std::fs::create_dir_all(dir);
        }
        match std::fs::rename(bundle, &target) {
            Ok(()) => return Ok(target),
            // Another disk: copy it instead.
            Err(e) if e.raw_os_error() == Some(18) => {
                let ok = Command::new("/usr/bin/ditto").arg(bundle).arg(&target).status().map(|s| s.success()).unwrap_or(false);
                if ok {
                    return Ok(target);
                }
                last = format!("couldn't copy it into {}", scrub(&dir.display().to_string()));
            }
            Err(e) => last = format!("couldn't put it in {} ({e})", scrub(&dir.display().to_string())),
        }
    }
    Err(last)
}

// ---- Getting the model ---------------------------------------------------------------------

/// Asks Ollama to pull the model and follows its progress lines.
fn pull(app: &AppHandle, url: &str, model: &str) -> Result<(), String> {
    show(app, "Getting the cat's brain…");
    logfile::write(&format!("model setup: pulling {model}"));
    block_on(async {
        // Checking a big model's digest can take a while without a line, so wait up to 5 minutes.
        let client = local_client(Duration::from_secs(300))?;
        let body = serde_json::json!({ "model": model, "stream": true });
        let mut r = client.post(format!("{url}/api/pull")).json(&body).send().await.map_err(|e| format!("Ollama didn't answer ({e})"))?;
        if !r.status().is_success() {
            let status = r.status();
            let text = r.text().await.unwrap_or_default();
            let mut p = Pull::default();
            p.line(text.as_bytes());
            return Err(p.error.unwrap_or_else(|| format!("Ollama said {status}")));
        }
        let mut p = Pull::default();
        let (mut buf, mut shown, mut logged) = (Vec::<u8>::new(), u64::MAX, 0u64);
        let mut step = |p: &mut Pull, line: &[u8]| {
            if let Some(pct) = p.line(line) {
                if pct != shown {
                    shown = pct;
                    show(app, &format!("Getting the cat's brain… {pct}%"));
                }
                if pct >= logged + 25 {
                    logged = pct - pct % 25;
                    logfile::write(&format!("model setup: pull {logged}%"));
                }
            }
        };
        while let Some(chunk) = r.chunk().await.map_err(|e| format!("the download stopped ({e})"))? {
            buf.extend_from_slice(&chunk);
            while let Some(end) = buf.iter().position(|b| *b == b'\n') {
                let line: Vec<u8> = buf.drain(..=end).collect();
                step(&mut p, &line);
            }
            if let Some(e) = p.error.take() {
                return Err(e);
            }
        }
        step(&mut p, &buf);
        match (p.error, p.done) {
            (Some(e), _) => Err(e),
            (None, true) => Ok(()),
            (None, false) => Err(format!("Ollama stopped before it finished ({})", if p.status.is_empty() { "no status" } else { &p.status })),
        }
    })
}

/// What Ollama's pull has said so far.
#[derive(Default)]
struct Pull {
    /// (digest, completed, total) of each layer.
    layers: Vec<(String, u64, u64)>,
    status: String,
    done: bool,
    error: Option<String>,
}

impl Pull {
    /// Reads one line. Returns the percent over all layers seen, once there is one.
    fn line(&mut self, line: &[u8]) -> Option<u64> {
        let v: serde_json::Value = serde_json::from_slice(line).ok()?;
        if let Some(e) = v["error"].as_str() {
            self.error = Some(e.to_string());
        }
        if let Some(s) = v["status"].as_str() {
            self.status = short(s, 60);
            if s == "success" {
                self.done = true;
            }
        }
        if let (Some(digest), Some(total)) = (v["digest"].as_str(), v["total"].as_u64()) {
            let completed = v["completed"].as_u64().unwrap_or(0).min(total);
            match self.layers.iter_mut().find(|l| l.0 == digest) {
                Some(l) => {
                    l.1 = completed;
                    l.2 = total;
                }
                None => self.layers.push((digest.to_string(), completed, total)),
            }
        }
        let total: u64 = self.layers.iter().map(|l| l.2).sum();
        let completed: u64 = self.layers.iter().map(|l| l.1).sum();
        (total > 0).then(|| (completed * 100 / total).min(100))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_local_addresses_count() {
        for ok in ["http://localhost:11434", "http://127.0.0.1:11434/", "http://[::1]:11434", "http://cat.localhost:1", "https://localhost"] {
            assert!(is_local_url(ok), "{ok}");
        }
        for no in ["http://example.com", "http://localhost.example.com", "http://localhost@evil.com", "file:///etc/passwd", "ftp://localhost", "nonsense", "http://192.168.1.2:11434"] {
            assert!(!is_local_url(no), "{no}");
        }
    }

    #[test]
    fn model_names_are_plain() {
        assert!(is_model_name("gemma3:1b"));
        assert!(is_model_name("library/llama3.2:3b-instruct"));
        assert!(!is_model_name(""));
        assert!(!is_model_name("gemma3:1b\"; rm"));
        assert!(!is_model_name(&"a".repeat(101)));
    }

    #[test]
    fn reasons_read_back() {
        for r in ["no-ollama", "not-running", "no-model"] {
            assert_eq!(Need::parse(r).unwrap().name(), r);
        }
        assert!(Need::parse("ready").is_none());
    }

    #[test]
    fn the_test_hook_reads_buttons_delay_and_reason() {
        let h = parse_test_hook("0").unwrap();
        assert_eq!((h.presses.clone(), h.secs, h.reason.clone()), (vec![0], 3.0, None));
        let h = parse_test_hook("0,1@2:no-ollama").unwrap();
        assert_eq!((h.presses.clone(), h.secs, h.reason.clone()), (vec![0, 1], 2.0, Some("no-ollama".into())));
        assert_eq!(press_for(&h, 0), Some((0, 2.0)));
        assert_eq!(press_for(&h, 1), Some((1, 2.0)));
        assert_eq!(press_for(&h, 5), Some((1, 2.0)));
        let h = parse_test_hook("1:no-model").unwrap();
        assert_eq!((h.presses.clone(), h.reason.clone()), (vec![1], Some("no-model".into())));
        assert!(parse_test_hook("yes").is_none());
    }

    #[test]
    fn the_checksum_file_is_read_like_sha256sum() {
        let sums = "607c79d5d6315ef9d896db83adde736a4c0057196329843544e79b95afb260a8  ./ollama-darwin.tgz\n\
                    DE3298B9897828480C361C101E3EFD2D3C499D08882C8EE972DF524064ABC3DB  ./Ollama-darwin.zip\n\
                    46b2cd03d4f2b110a67207a9c411a2837134abb07a3e64584a1de317d4ca2383 *Ollama.dmg\n";
        assert_eq!(checksum_for(sums, "Ollama-darwin.zip").as_deref(), Some("de3298b9897828480c361c101e3efd2d3c499d08882c8ee972df524064abc3db"));
        assert_eq!(checksum_for(sums, "Ollama.dmg").as_deref(), Some("46b2cd03d4f2b110a67207a9c411a2837134abb07a3e64584a1de317d4ca2383"));
        assert_eq!(checksum_for(sums, "ollama-darwin.zip"), None);
        assert_eq!(checksum_for("short  ./Ollama-darwin.zip", "Ollama-darwin.zip"), None);
    }

    #[test]
    fn the_tag_comes_from_the_redirect() {
        assert_eq!(tag_from("https://github.com/ollama/ollama/releases/tag/v0.40.15").as_deref(), Some("v0.40.15"));
        assert_eq!(tag_from("https://github.com/ollama/ollama/releases"), None);
        assert_eq!(tag_from("https://github.com/ollama/ollama/releases/tag/../../x"), None);
        assert_eq!(tag_from(""), None);
    }

    #[test]
    fn only_github_hosts_are_followed() {
        assert!(is_github_host("github.com"));
        assert!(is_github_host("release-assets.githubusercontent.com"));
        assert!(is_github_host("objects.githubusercontent.com"));
        assert!(!is_github_host("githubusercontent.com.evil.com"));
        assert!(!is_github_host("evil-github.com"));
    }

    #[test]
    fn the_team_is_read_from_codesign() {
        let out = "Executable=/x/Ollama\nIdentifier=com.electron.ollama\nAuthority=Developer ID Application: Infra Technologies, Inc (3MU9H2V9Y9)\nTeamIdentifier=3MU9H2V9Y9\n";
        assert_eq!(team_of(out).as_deref(), Some(TEAM));
        assert_eq!(team_of("Signature=adhoc\nTeamIdentifier=not set\n"), None);
        assert_eq!(team_of("nothing"), None);
    }

    #[test]
    fn apple_tools_are_not_ollama() {
        let e = check_signature(Path::new("/bin/ls")).unwrap_err();
        assert!(e.contains("isn't signed by a team"), "{e}");
    }

    /// Reads real apps on this Mac (read only): `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn the_signature_check_knows_ollama_from_other_teams() {
        if Path::new("/Applications/Ollama.app").is_dir() {
            assert_eq!(check_signature(Path::new("/Applications/Ollama.app")), Ok(()));
        }
        for other in ["/Applications/Firefox.app", "/Applications/Google Chrome.app", "/Applications/Visual Studio Code.app"] {
            if Path::new(other).is_dir() {
                // Refused either way: another team, or (Chrome) extra file attributes --strict rejects.
                let e = check_signature(Path::new(other)).unwrap_err();
                assert!(e.starts_with("it's signed by someone else") || e.starts_with("its signature doesn't check out"), "{other}: {e}");
                println!("{other}: {e}");
            }
        }
    }

    #[test]
    fn pull_progress_counts_all_layers() {
        let mut p = Pull::default();
        assert_eq!(p.line(br#"{"status":"pulling manifest"}"#), None);
        assert_eq!(p.line(br#"{"status":"pulling aaa","digest":"sha256:aaa","total":800,"completed":200}"#), Some(25));
        assert_eq!(p.line(br#"{"status":"pulling bbb","digest":"sha256:bbb","total":200}"#), Some(20));
        assert_eq!(p.line(br#"{"status":"pulling aaa","digest":"sha256:aaa","total":800,"completed":800}"#), Some(80));
        assert_eq!(p.line(br#"{"status":"pulling bbb","digest":"sha256:bbb","total":200,"completed":200}"#), Some(100));
        assert!(!p.done);
        p.line(br#"{"status":"success"}"#);
        assert!(p.done && p.error.is_none());
        let mut p = Pull::default();
        p.line(br#"{"error":"pull model manifest: file does not exist"}"#);
        assert_eq!(p.error.as_deref(), Some("pull model manifest: file does not exist"));
        assert_eq!(p.line(b"not json"), None);
    }

    #[test]
    fn tags_match_like_the_page() {
        let tags = serde_json::json!({ "models": [{ "name": "gemma3:1b" }, { "name": "llama3.2:latest" }] });
        assert!(model_in_tags(&tags, "gemma3:1b"));
        assert!(model_in_tags(&tags, "llama3.2"));
        assert!(model_in_tags(&tags, "gemma3"));
        assert!(!model_in_tags(&tags, "gemma3:4b"));
        assert!(!model_in_tags(&tags, "gemma"));
        assert!(!model_in_tags(&serde_json::json!({}), "gemma3:1b"));
    }

    #[test]
    fn hex_is_lowercase_pairs() {
        assert_eq!(hex(&[0, 15, 255]), "000fff");
    }
}
