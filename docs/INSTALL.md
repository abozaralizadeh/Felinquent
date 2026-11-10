# Install

Felinquent is early software. On a Mac or a Windows PC you can download it like any other app, or build it yourself.

## Mac: download

You need macOS 13 or newer, on Apple Silicon or Intel.

1. [Download Felinquent.dmg](https://github.com/abozaralizadeh/Felinquent/releases/latest/download/Felinquent.dmg) and open it.
2. Drag Felinquent into Applications.
3. Open it from Applications.

The first time, macOS says it can't check the app. That's because it isn't signed with an Apple Developer ID yet. Click **Done**, then open **System Settings > Privacy & Security**, scroll down and click **Open Anyway** next to Felinquent (it may ask for your password). You only do this once. If you'd rather use Terminal, this does the same:

```bash
xattr -dr com.apple.quarantine /Applications/Felinquent.app
```

### Or in one line, with no warning

Paste this in Terminal instead of downloading the DMG in a browser:

```bash
curl -fsSL https://raw.githubusercontent.com/abozaralizadeh/Felinquent/main/scripts/get-mac.sh | bash
```

It downloads the same `Felinquent.dmg` from the latest release, checks it against the SHA-256 published next to it (and stops if it doesn't match), copies the app into Applications and starts it. macOS only asks "is this safe?" about files a browser tagged as downloaded from the internet, and a download made by `curl` doesn't get that tag, so there's no Open Anyway step. Run it again any time to update. The script is [scripts/get-mac.sh](../scripts/get-mac.sh) if you want to read it first. Add `-s -- --no-open` after `bash` to install without starting it.

From 0.1.10 on, the app updates itself. A minute after it starts and then every 3 hours it asks GitHub if there's a newer version. If there is, it downloads it, checks its signature and puts it in place of the old one the next time you leave the Mac alone for a couple of minutes (not in a call, nothing full screen), then restarts the cat. Your cat keeps what it learned. Turn off **Update automatically** in the menu and it won't check by itself; **Check for updates…** asks first either way: **Update now**, **Later** or **Skip this version**. Versions 0.1.2 to 0.1.9 check every 12 hours and ask before updating. On 0.1.1, download the new DMG and drag it into Applications once more.

### The menu

Everything is in the cat icon in the menu bar. A tick shows what's on right now.

| Item | What it does |
|---|---|
| Felinquent 0.x.y… | The version at the top. Opens the About window, with links to the website and to the code on GitHub (a star there really helps) |
| Check for updates… | Looks for a new version right now. Shows "Update to 0.x.y…" when one is waiting |
| Give a treat | A treat hangs at your pointer and the animal comes to beg under it. Click anywhere to drop it and it eats it. Also calls it over and ends a shoo |
| Throw its toy | Drops its toy at your pointer. You can also grab the toy (or a mug, a plant) with the mouse and throw it |
| Pet it, Zoomies!, Nap time | The same as on the animal's own menu: it starts at once, with or without the local model |
| Character | Tabby, Inky, Pearl, Mochi, Bandit, Biscuit, Chili, Clover or Hazel. The current one has a tick |
| Chaos level | Chill, Normal or Gremlin |
| Panic: hide the cat | Hides it until you click again. Also Cmd+Opt+Shift+P |
| Shoo for 1 hour | Keeps it away for an hour. Click again to call it back early |
| Use the local model | Lets a small local model pick what the cat wants to do. Needs [Ollama](https://ollama.com) with `gemma3:1b`. If they're missing when you turn it on, the app offers to set them up: it asks first, shows the sizes (Ollama about 230 MB, the model about 815 MB), checks the download and shows the progress right here in the menu. Without it, or with this off, a rules brain does the same job |
| Model | Every model your Ollama has, the one in use ticked. Pick any of them: `ollama pull <name>` in Terminal, and it shows up here within two minutes. Small ones (1 to 4B) answer in time; a big one gets 20 s per answer and the rules fill in while it thinks |
| Start at login | Opens Felinquent when you log in. On from the first run since 0.1.16; untick it and it stays off, updates included |
| Update automatically | Looks for a new version at launch and every 3 hours and puts it in place by itself when you leave the Mac alone for a couple of minutes. On by default |
| Send error reports | Sends a cleaned-up report when something breaks. It asks the first time; this switches it later |
| Share usage counts | One anonymous ping a day, so the project can count installs and users. No ID and nothing about you, see [PRIVACY.md](../PRIVACY.md). On by default |
| Forget everything it learned | Wipes its memory of you |
| Open logs folder | The logs are size-limited and kept in `~/Library/Logs/Felinquent/` |

Right-click the animal for a shorter menu right there (its actions are in the menu bar menu too): Give a treat, Throw its toy, Pet it, Zoomies!, Nap time, Character, Chaos level, Shoo for 1 hour and Panic. They start at once, with or without the local model. The click stays with the animal: the app under it doesn't get it and keeps the keyboard. In the browser playground the same menu opens on a right-click too.

No macOS permission is needed. It doesn't ask for Screen Recording or Accessibility. On its own it fetches the update check, one small file from GitHub, and sends one anonymous usage count a day; you can turn both off. Installing it means you agree to the [terms](../TERMS.md) and the [privacy notice](../PRIVACY.md). Setting up the local model downloads Ollama and the model, but only after you say yes. Its settings and memory are in `~/Library/Application Support/app.felinquent/`.

To remove it, quit it from the menu and drag it from Applications to the Trash. Turn off **Start at login** first (it's on from the first run), or delete `~/Library/LaunchAgents/app.felinquent.plist` afterwards.

## Mac: build it yourself

You need macOS 13 or newer and [Homebrew](https://brew.sh). The script installs Node and Rust through Homebrew if they're missing, builds the app, copies it into `/Applications` and starts it. It takes a few minutes the first time. Run it again any time to update.

```bash
git clone https://github.com/abozaralizadeh/Felinquent.git
cd Felinquent
bash scripts/install-mac.sh
```

Options:

| Option | What it does |
|---|---|
| `--with-model` | Also installs [Ollama](https://ollama.com) and the small local model `gemma3:1b` (about 1 GB). The cat works fine without it. |
| `--login` | Starts it when you log in |
| `--prefix DIR` | Installs into `DIR` instead of `/Applications` |
| `--no-launch` | Doesn't start it at the end |
| `--dry-run` | Only prints what it would do |

The menu is the same as above.

To remove it (add `--purge` to also delete its memory and settings):

```bash
bash scripts/uninstall-mac.sh
```

### Run it without installing

```bash
npm install
npm run build
cd src-tauri && cargo build --release && cd ..
FELINQUENT_DEMO=1 ./src-tauri/target/release/felinquent    # Ctrl+C to stop
```

| Variable | Effect |
|---|---|
| `FELINQUENT_DEMO=1` | Sends the cat to a window every 25 seconds |
| `FELINQUENT_DEBUG=1` | Draws a red box where clicks are blocked |
| `FELINQUENT_BRAIN=rules` | Never uses the local model, whatever the menu says |

To make the DMG yourself: `npm run bundle:mac-dmg` (this Mac's chip only) or `npm run bundle:mac-universal` (Apple Silicon and Intel, needs `rustup target add x86_64-apple-darwin`). The release workflow in `.github/workflows/release.yml` does the universal one on GitHub when a version tag is pushed.

## Windows: download

You need Windows 10 or 11, 64-bit.

1. [Download Felinquent-setup.exe](https://github.com/abozaralizadeh/Felinquent/releases/latest/download/Felinquent-setup.exe) and open it.
2. Windows SmartScreen may say it protected your PC, because the installer isn't signed with a Windows certificate yet. Click **More info**, then **Run anyway**. You only do this once.
3. The installer puts Felinquent in your user folder (no admin needed) and starts it.

The cat shows up at the bottom of your screen, standing on the taskbar, and its icon appears in the notification area by the clock (it may be under the little arrow). Click the icon for the menu: everything the Mac's menu bar menu has, including **Start at login**, **Update automatically** and the local model. Panic is **Ctrl+Alt+Shift+P**. Right-click the animal for its own menu.

### Or in one line, with no warning

Paste this in PowerShell instead of downloading the installer in a browser:

```powershell
irm https://raw.githubusercontent.com/abozaralizadeh/Felinquent/main/scripts/get-windows.ps1 | iex
```

It downloads the same `Felinquent-setup.exe` from the latest release, checks it against the SHA-256 published next to it (and stops if it doesn't match), installs it without questions and starts it. SmartScreen only asks about files a browser marked as downloaded from the internet, and a download made by PowerShell doesn't get that mark. Run it again any time to update. The script is [scripts/get-windows.ps1](../scripts/get-windows.ps1) if you want to read it first.

It updates itself like the Mac app: it checks GitHub a minute after it starts and every 3 hours, and with **Update automatically** on it installs a new version the next time you leave the PC alone for a couple of minutes (a small progress window shows for a few seconds and the cat comes back). Your cat keeps what it learned (in `%APPDATA%\app.felinquent`). To remove it, use **Settings > Apps > Installed apps > Felinquent > Uninstall**.

What's different from the Mac: a full-screen window on Windows is nearly always a video, a game or slides, so the cat goes outside while one is in front (on the Mac it stays on a full-screen app unless a video or slides keep the display awake). Logs are in `%LOCALAPPDATA%\Felinquent\Logs` (**Open logs folder** in the menu).

The local model works on Windows too. Turn on **Use the local model** and, if Ollama isn't there, the app offers to get Ollama's own Windows installer (about 1.7 GB, checked against its checksum and its signature) and then `gemma3:1b` (about 815 MB). On a PC without a graphics card Ollama is slow, 10 to 20 seconds per plan, so the cat keeps going on its rules while it thinks.

## Windows: build it yourself

`scripts/install-windows.ps1` installs Node, Rust and the Visual Studio C++ build tools with winget, then builds and installs the app. Read it first.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

To make the installer yourself: `npm run bundle:win` (the NSIS installer lands in `src-tauri\target\release\bundle\nsis`). The release workflow builds it on GitHub next to the DMG.

## The browser playground

The same cat on pretend windows, in any browser. You need Node.js 22 or newer.

```bash
npm install
npm run dev     # http://localhost:5173
```

## The playground as a Linux service

`setup_service.sh` serves the playground on a Linux server with systemd. Run it the first time and after every update: it installs Node if needed, builds, writes the service and restarts it.

```bash
sudo ./setup_service.sh            # --port 4173 to change the port
journalctl -u felinquent-playground.service -f
```

The server only serves the demo page. The desktop cat itself is a Mac app.
