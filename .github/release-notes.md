A desktop cat for your Mac, and now your Windows PC. It naps on your windows, sits on what you care about and ignores you when called.

## What's new

Every animal now does things only that kind of animal does! The dogs shake off with fur flying, Biscuit lies down and chews its ball, Chili hides under a blanket or stands there shivering with one paw up. Mochi the fox listens, leaps and dives head first into the ground after a mouse. Bandit washes its hands in a little puddle and digs through a snack box for grapes. Clover twists in the air when it's happy, thumps when it's not, flops over and nibbles the edge of your window. Hazel eats a nut sitting up and hangs head down off the side of a window.

And no animal grows or shrinks for a moment when it sits or lies down anymore.

## More about 0.1.17

A click gets reactions only that animal has too: a wag, a shake, a paw up, listening, a look at its clean hands, a binky, a flop, a thump, a flick of the tail. Going from lying to standing and back is now a real move instead of a fade.

The earth, the puddle and the nut shells are drawn on the cat's own layer like the rest of the mess, so click them to clean up or wait and they go away. The bites in your window edge are drawn too and fade after a few minutes. The rubbish and the window nibbling only happen at normal and gremlin, never at chill. All of it works with the local model off, and it's the same on Mac and Windows.

Also fixed: a dog could get stuck holding its toy forever when the spot to drop it was very close.

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
