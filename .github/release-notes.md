A desktop cat for your Mac. It naps on your windows, sits on what you care about and ignores you when called.

## What's new

You can throw it its toy now! Grab the toy with the mouse (or pick "Throw its toy" in the menu) and fling it. Your animal sees where it lands and decides what to do: the puppy brings it back to you, the squirrel buries its acorn. Its head follows your pointer all the way round, the tongue really moves when it washes, and at gremlin it sometimes runs after your pointer.

## More about 0.1.8

After a swipe to another desktop you don't see the cat flash in its old spot any more. The local model doesn't freeze it while it thinks, and it now gets the screen in words: where your pointer is from the animal's side, where the toy is, which apps are near (names only, never titles). Nothing looks at your screen.

Every animal got 27 new drawings: the head three quarters toward you, looking back over its shoulder, a head tilt, and a tongue that moves. That makes the download about SIZE MB.

New in 0.1.7 too, if you skipped it: it shows up on full-screen apps, and goes outside while one plays a video or shows slides.

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
