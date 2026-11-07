A desktop cat for your Mac. It naps on your windows, sits on what you care about and ignores you when called.

## What's new

Your pet has to go now and then! Rarely: a few times a day at normal, more at gremlin, never at chill. It sniffs a spot on your window, pees or poops, looks back at it, and a cat covers it up. Click the mess to clean it, or wait and it dries up. All drawn, your windows are fine. And with the local model off every move still happens: the toy, the chase, all of it.

## More about 0.1.9

It holds on in a meeting, on a full-screen video and in quiet hours. Each animal does it its own way: the dog kicks back without turning round, the rabbit leaves a few pellets and hops off, and a cat sometimes gets the zoomies right after. Every animal got nine new drawings with smooth in-betweens, and the download is 110 MB (it was 109).

New in 0.1.8 too, if you skipped it: grab its toy and throw it, and its head follows your pointer all the way round.

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
