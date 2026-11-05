# Install

Felinquent is early software. On a Mac you can download it like any other app, or build it yourself.

## Mac: download

You need macOS 13 or newer, on Apple Silicon or Intel.

1. [Download Felinquent.dmg](https://github.com/abozaralizadeh/Felinquent/releases/latest/download/Felinquent.dmg) and open it.
2. Drag Felinquent into Applications.
3. Open it from Applications.

The first time, macOS says it can't check the app. That's because it isn't signed with an Apple Developer ID yet. Click **Done**, then open **System Settings > Privacy & Security**, scroll down and click **Open Anyway** next to Felinquent (it may ask for your password). You only do this once. If you'd rather use Terminal, this does the same:

```bash
xattr -dr com.apple.quarantine /Applications/Felinquent.app
```

From 0.1.2 on, the app updates itself. Every 12 hours it asks GitHub if there's a newer version. If there is, it asks you first: **Update now**, **Later** or **Skip this version**. Update now downloads it, checks its signature, puts it in place of the old one and restarts the cat. Your cat keeps what it learned. On 0.1.1, download the new DMG and drag it into Applications once more.

### The menu

Everything is in the cat icon in the menu bar. A tick shows what's on right now.

| Item | What it does |
|---|---|
| Check for updates… | Looks for a new version right now. Shows "Update to 0.x.y…" when one is waiting |
| Give a treat | Calls the cat over (and ends a shoo) |
| Character | Tabby, Inky, Pearl, Mochi, Bandit or Biscuit. The current one has a tick |
| Chaos level | Chill, Normal or Gremlin |
| Panic: hide the cat | Hides it until you click again. Also Cmd+Opt+Shift+P |
| Shoo for 1 hour | Keeps it away for an hour. Click again to call it back early |
| Use the local model | Lets a small local model pick what the cat wants to do. Needs [Ollama](https://ollama.com) with `gemma3:1b`. Without it, or with this off, a rules brain does the same job |
| Start at login | Opens Felinquent when you log in |
| Check for updates automatically | Looks for a new version every 12 hours and asks before installing it. On by default |
| Forget everything it learned | Wipes its memory of you |
| Open logs folder | The logs are size-limited and kept in `~/Library/Logs/Felinquent/` |

No macOS permission is needed. It doesn't ask for Screen Recording or Accessibility. The only thing it fetches from the internet is the update check, one small file from GitHub, and you can turn that off. Its settings and memory are in `~/Library/Application Support/app.felinquent/`.

To remove it, quit it from the menu and drag it from Applications to the Trash. Turn off **Start at login** first if you turned it on.

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

## Windows (untested)

`scripts/install-windows.ps1` installs Node, Rust and the Visual Studio C++ build tools with winget, then builds and installs the app. It has never been run on Windows, so read it first.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

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
