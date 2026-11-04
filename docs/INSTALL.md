# Install

Felinquent is early software. The Mac app is a prototype without a signed installer, so you build it on your own machine. It takes a few minutes the first time.

## Mac

You need macOS 13 or newer and [Homebrew](https://brew.sh). The script installs Node and Rust through Homebrew if they're missing, builds the app, copies it into `/Applications` and starts it. Run it again any time to update.

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

It lives in the menu bar: give a treat, pick a character, set the chaos level, panic, shoo it for an hour, make it forget you, open the logs folder, quit. The panic hotkey is Cmd+Opt+Shift+P. Logs are size-limited and kept in `~/Library/Logs/Felinquent/`.

No macOS permission is needed. It doesn't ask for Screen Recording or Accessibility.

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
| `FELINQUENT_BRAIN=rules` | Never uses the local model |

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
