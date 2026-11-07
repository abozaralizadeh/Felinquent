A desktop cat for your Mac. It naps on your windows, sits on what you care about and ignores you when called.

## What's new

Give it a treat and one hangs at your pointer, the right one for the animal: a fish for a cat, a bone biscuit for a dog, a strawberry for the rabbit. It begs under it until you click, then eats it bite by bite. Right-click it for a quick menu, grab the mugs too, and it reacts to a thrown toy at once. Jumps stay on the screen. And from now on it updates by itself.

## More about 0.1.10

Its eyes follow a flying toy or treat, it turns its head toward you from the loaf and the window edge too, and when you come back after a while it comes over to say hello. It's the same size in every pose now, and the toy sits in its mouth. With **Update automatically** on (it is by default) a new version installs itself once you've left the Mac alone for two minutes, never in a call or over a full-screen app. The download is about 110 MB.

## Updating

Already on 0.1.2 or newer? The app asks you within 12 hours, or pick **Check for updates…** in the menu now. This is the last time you have to: from 0.1.10 on, updates come by themselves. On 0.1.2 and 0.1.3 that question still has the old bug, so if Update now doesn't react, click it again.

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
