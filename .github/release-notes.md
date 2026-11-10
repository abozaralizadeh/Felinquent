A desktop cat for your Mac, and now your Windows PC. It naps on your windows, sits on what you care about and ignores you when called.

## What's new

New: Felinquent counts how many of us there are. Once a day the app sends one anonymous ping, with no ID and nothing about you, so the README and the website can show how many people have it and use it. **Share usage counts** in the menu turns it off, and exactly what's sent is in [PRIVACY.md](https://github.com/abozaralizadeh/Felinquent/blob/main/PRIVACY.md).

A new install now starts at login. If you already turned that off, it stays off.

## More about 0.1.16

The ping holds the app version, Mac or Windows, which animal, the chaos level, whether the local model is on, and the date it was last counted. The relay adds 1 to some totals and keeps nothing else, not even your IP address. Setting `DO_NOT_TRACK=1` turns it off too. The totals are live on [the website](https://abozaralizadeh.github.io/Felinquent/#numbers).

There's now a short [privacy notice](https://github.com/abozaralizadeh/Felinquent/blob/main/PRIVACY.md) and [terms of use](https://github.com/abozaralizadeh/Felinquent/blob/main/TERMS.md), and installing means you agree to them. The About window (the version line in the menu) links to the privacy notice. Error reports still only go out after you say yes. The same on Mac and Windows.

## Updating

On 0.1.10 or newer it updates itself the next time you leave the computer alone for a couple of minutes, or pick **Check for updates…** in the menu now. On 0.1.2 to 0.1.9 the app asks you within 12 hours (if Update now doesn't react on 0.1.2 or 0.1.3, click it again).

Coming from 0.1.1? Download the DMG below and drag it into Applications once more, or run the one-line installer below (it replaces the old copy and keeps what the cat learned).

## Install on a Mac

1. Download **Felinquent.dmg** below and open it.
2. Drag Felinquent into Applications.
3. Open it from Applications. The first time, macOS says it can't check the app. Click **Done**, then go to **System Settings > Privacy & Security**, scroll down and click **Open Anyway** next to Felinquent. You only do this once.

The cat shows up on your screen and a cat icon appears in the menu bar. That menu has everything: pick a character, change the chaos level, hide the cat, start at login, quit.

Works on macOS 13 or newer, Apple Silicon and Intel. The app isn't signed with an Apple Developer ID yet, which is why step 3 is needed.

Or skip step 3 and paste this in Terminal. It downloads the same DMG, checks it against the checksum below, puts the app in Applications and starts it, with no warning:

```bash
curl -fsSL https://raw.githubusercontent.com/abozaralizadeh/Felinquent/main/scripts/get-mac.sh | bash
```

## Install on Windows

1. Download **Felinquent-setup.exe** below and open it.
2. If SmartScreen says it protected your PC, click **More info**, then **Run anyway**. You only do this once.

The cat shows up on your taskbar and its icon sits by the clock. Panic is Ctrl+Alt+Shift+P. To remove it, use Settings > Apps.

Or paste this in PowerShell. It downloads the same installer, checks it against the checksum below, installs it and starts it, with no SmartScreen question:

```powershell
irm https://raw.githubusercontent.com/abozaralizadeh/Felinquent/main/scripts/get-windows.ps1 | iex
```

## Optional: the local model

The cat thinks with simple rules out of the box. Turn on **Use the local model** in the menu and it uses [Ollama](https://ollama.com) with `gemma3:1b` as its slow brain, or any other model you pick in the menu's **Model** list. If Ollama or the model isn't there yet, the app asks first and then sets it up for you (about 1 GB in total on a Mac, 2.5 GB on Windows, where Ollama's installer is bigger). Everything stays on your computer.

## Check the download

`Felinquent.dmg.sha256` holds the SHA-256 of the DMG. Compare it with `shasum -a 256 Felinquent.dmg`. `Felinquent-setup.exe.sha256` is the same for the Windows installer: `Get-FileHash Felinquent-setup.exe` in PowerShell.
