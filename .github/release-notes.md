A desktop cat for your Mac. It naps on your windows, sits on what you care about and ignores you when called.

## What's new

The update question works on the first click now. Before, it could ignore clicks on Update now and you had to click a few times. The same fix goes for the questions that set up the local model. Coming from 0.1.2? Then you also get 0.1.3: the cat acts in calmer stretches, thinks in a bubble, and at normal and gremlin knocks things off your windows.

## New in 0.1.3

The cat stopped repeating itself. It now does things in little stretches (rest, explore, play, mischief) and takes its time between moves. With the local model on, it plans a few steps ahead and thinks out loud in a small bubble. No model yet? The app offers to set it up. At normal and gremlin it knocks things off your windows and they break (only drawn, your real windows are fine).

## The mess, in more detail

At normal and gremlin, little things show up on top of your windows now and then: a mug, a plant, a vase, a rubber duck. The cat walks over, gives one a push and watches it fall. Some break into pieces. It also claws window edges and chases flies. At gremlin it lands hard enough to crack a window, does zoomies from window to window and misses more jumps, hanging off a ledge before it drops. All of it is drawn on the cat's own see-through layer and fades away after a while. Nothing touches your real windows, and chill keeps it all off.

The thought bubble only talks about real stuff: you poked it, you've been in the same app for an hour, a mug just broke. When the model writes something off topic (the 1b model loves dust and sunbeams), the cat says a written line for that moment instead. Thoughts are never logged.

## Updating

Already on 0.1.2 or 0.1.3? The app asks you within 12 hours, or pick **Check for updates…** in the menu now. That question still has the old bug one last time, so if Update now doesn't react, click it again.

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
