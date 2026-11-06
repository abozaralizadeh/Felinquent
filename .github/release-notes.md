A desktop cat for your Mac. It naps on your windows, sits on what you care about and ignores you when called.

## What's new

The cat notices you now. It looks at your cursor, follows it and sometimes plays with it. Drag a window and whatever sits on it rides along, and a fast drag throws it off. Switch desktops and it walks over later. It learns what you like and makes up its own tricks. Every move is fully drawn, there's a new icon, and three new animals: a chihuahua, a rabbit and a squirrel.

## More about 0.1.5

**You and the cursor.** Bring the cursor close and the cat looks up at it, and its head follows it around. Sometimes it follows you across the screen, or decides the cursor is prey and plays with it (getting in your way on purpose). That red ball finally makes sense: it's a real toy now that rolls in, gets chased and batted around.

**Windows.** Drag a window with the cat or a mug on it and they move with it right away, no lag. Drag fast or yank it and things slide and fall off. The cat lands, looks startled and glares at you.

**Desktops.** Switch to another desktop and the cat stays where it was. A bit later it walks in from the side you came from.

**It learns.** It remembers what you liked (a pet, a treat) and what got it shooed, gets bored of doing the same thing over and over, and gets curious about stuff it hasn't done in a while. It also makes up its own tricks from its moves and tells you the name the first time it shows one. **Forget everything it learned** in the menu wipes all of it.

**Art.** Every move is drawn with its in-between frames now (sitting, loafing, perching on a window edge, howling, begging, digging...), so it moves a lot more like a real animal. Three new animals: Chili the chihuahua, Clover the rabbit and Hazel the squirrel. The rabbit and the squirrel hop. The app icon is the tabby now, drawn like the rest of them, and the menu bar shows its head.

The download is bigger because of all the new drawings, about 170 MB (it was 75 MB).

## Updating

Already on 0.1.2 or newer? The app asks you within 12 hours, or pick **Check for updates…** in the menu now. On 0.1.2 and 0.1.3 that question still has the old bug, so if Update now doesn't react, click it again.

Coming from 0.1.1? Download the DMG below and drag it into Applications once more, or run the one-line installer below (it replaces the old copy and keeps what the cat learned).

## Install

1. Download **Felinquent.dmg** below and open it.
2. Drag Felinquent into Applications.
3. Open it from Applications. The first time, macOS says it can't check the app. Click **Done**, then go to **System Settings > Privacy & Security**, scroll down and click **Open Anyway** next to Felinquent. You only do this once.

The cat shows up on your screen and a cat icon appears in the menu bar. That menu has everything: pick a character, change the chaos level, hide the cat, start at login, quit.

Works on macOS 13 or newer, Apple Silicon and Intel. The app isn't signed with an Apple Developer ID yet, which is why step 3 is needed.

Or skip step 3 and paste this in Terminal. It downloads the same DMG, checks it against the checksum below, puts the app in Applications and starts it, with no warning:

```bash
curl -fsSL https://raw.githubusercontent.com/abozaralizadeh/Felinquent/main/scripts/get-mac.sh | bash
```

## Optional: the local model

The cat thinks with simple rules out of the box. Turn on **Use the local model** in the menu and it uses [Ollama](https://ollama.com) with `gemma3:1b` as its slow brain. If Ollama or the model isn't there yet, the app asks first and then sets it up for you (about 1 GB in total). Everything stays on your Mac.

## Check the download

`Felinquent.dmg.sha256` holds the SHA-256 of the DMG. Compare it with `shasum -a 256 Felinquent.dmg`.
