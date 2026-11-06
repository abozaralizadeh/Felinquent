A desktop cat for your Mac. It naps on your windows, sits on what you care about and ignores you when called.

## What's new

It shows up on full-screen apps now. Switch to one and it walks over like on any other desktop. When a full-screen app plays a video or shows slides, it goes outside and comes back once that stops.

## More about 0.1.7

Until now macOS kept the cat off apps in full screen, so if you work in full screen it was mostly just gone (and in 0.1.5 it could even get stuck there where you couldn't see it). Now its window follows you to whatever is on screen, full-screen apps too, on every display. Clicking it also never pulls Felinquent to the front any more.

It still backs off for videos and presentations. It doesn't look at what's on screen: macOS says when something is keeping the display awake (a playing video, a slideshow), and that's enough.

New in 0.1.6 too, if you skipped it: each animal has its own toy, a treat calls it over from another desktop, and the download is 97 MB instead of 173.

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
