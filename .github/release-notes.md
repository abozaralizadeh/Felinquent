A desktop cat for your Mac, and now your Windows PC. It naps on your windows, sits on what you care about and ignores you when called.

## What's new

More characters, and you can download them right from the menu. Open **Character > Get more characters** and pick one: it downloads, gets checked and moves in. The Character menu is grouped now too: Cats, Dogs, Wild ones, and whatever you added.

The first ones up there are **Big tech**: eight tiny tech bosses with nicknames. Jacket holds up a new chip like at a keynote and signs your laptop. Rocket carries a sink in and launches tiny rockets. Bookworm reads, eats a cheeseburger and does the big jump. Brisket trains, smokes meat and puts on way too much sunscreen. Parcel laughs like a foghorn and delivers boxes. Earlybird says good morning to everyone. Cricket talks about empathy and drinks tea. Lucky says AI in every sentence. They're parodies of public personas, not the real people, and not affiliated with them or their companies.

Each of them has moves nobody else has, and those moves are just data in the character's file, so anyone making a character can give it their own: which drawings play, when the move fits (the time of day, what you're doing, its mood), what it means and what it says. With the local model on, it sees those moves by name and picks the one that fits the moment.

## Also new lately

Want only the pet on your screen? Tick **No toys or objects** in the menu. It stops bringing out its toy, nothing shows up on your windows anymore, and it leaves nothing behind. It's off by default.

If you unplugged a monitor while Felinquent was running, it could crash and vanish. That's fixed, and monitors can come and go as you like. And if Felinquent sits in a folder only an administrator can change, it now asks before updating and tells you macOS will want a password, instead of a password prompt popping up out of nowhere.

Menus keep working while Felinquent waits for an answer to a question (like whether to get the local model), and the question opens on the screen you're looking at.

No more "the cat's page stopped answering" error reports after you lock your computer or wake a sleeping screen.

Right-click the pet while it's up on your other monitor and its menu opens right next to it, not down at the bottom of your main screen.

Want your own pet in there? There's a guide for making your own character, starting from just two drawings, plus a tool that checks it and packs it into a .felinquent file. Since this version the guide also shows how to give it moves of its own.

Plug in a monitor while Felinquent is running and the pet can go there, no restart needed. Unplug it while the pet is up there and it lands back on your laptop's Dock. It can also leap from the Dock straight up onto a monitor that sits above your laptop, even when there's no window to climb on.

You can hide the cat from screen sharing. Turn on **Hide from screen sharing** in the menu and the people in your meeting won't see it when you share your screen, but you still will. On a Mac the newer meeting apps can still see it, so there it also walks off while your camera or mic is on and comes back after the call.

You can add new characters too. **Add a character…** in the Character menu takes a `.felinquent` file, and **Remove a character** takes it away again. A package is only drawings and a description, so nothing in it ever runs.

## Make your own character

The guide is [docs/CHARACTERS.md](https://github.com/abozaralizadeh/Felinquent/blob/main/docs/CHARACTERS.md). Draw your animal sitting and standing, write a few lines about who it is, run `npm run character -- pack` and add the file with **Character > Add a character…**. One more command gives it a real walk made from the standing drawing, and every drawing you add after that brings another move to life.

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
