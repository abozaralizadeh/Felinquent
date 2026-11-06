A desktop cat for your Mac. It naps on your windows, sits on what you care about and ignores you when called.

## What's new

It follows you to the new desktop for real now, even when it was napping, and Give treat calls it over right away. It doesn't wander onto full-screen apps any more, where you couldn't see it at all. Every animal has its own toy now (a fish, a carrot, an acorn...). And the download is about half the size.

## More about 0.1.6

**Desktops.** Sliding between desktops confused it. Halfway through the swipe macOS already shows the next desktop's windows, so the cat fell off windows that were still there and never really left. That's fixed. If it was asleep it now naps a minute more and then comes looking, and **Give treat** calls it over at once. It also used to follow you onto an app in full screen, where macOS doesn't show it, so it was just gone. Now it waits on its own desktop and comes over once you're back on one. Showing it on full-screen apps too is next.

**Toys.** Tabby keeps the red yarn. Inky has a catnip fish, Pearl a jingle ball, Mochi a sock it stole, Bandit a ball of shiny foil, Biscuit a tennis ball, Chili a tiny squeaky bone, Clover a carrot and Hazel an acorn. The round ones roll, the others skid and flop over.

**Smaller download.** About 97 MB instead of 173. The drawings were packed in twice (once for Apple Silicon and once for Intel), now they're in there once.

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
