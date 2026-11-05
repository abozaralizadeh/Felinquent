A desktop cat for your Mac. It naps on your windows, sits on what you care about and ignores you when called.

## What's new

The cat turns round properly now instead of flipping like a sheet of paper. It washes from the head down, a few licks on each spot, scratches its ear with a hind leg, and moves more smoothly overall. And the app now checks for updates and offers to install them for you.

## Updating

Coming from 0.1.1? Download the DMG below and drag it into Applications once more. From this version on, the app checks GitHub for a new version every 12 hours and asks before it installs anything. Turn that off in the menu with Check for updates automatically.

## Install

1. Download **Felinquent.dmg** below and open it.
2. Drag Felinquent into Applications.
3. Open it from Applications. The first time, macOS says it can't check the app. Click **Done**, then go to **System Settings > Privacy & Security**, scroll down and click **Open Anyway** next to Felinquent. You only do this once.

The cat shows up on your screen and a cat icon appears in the menu bar. That menu has everything: pick a character, change the chaos level, hide the cat, start at login, quit.

Works on macOS 13 or newer, Apple Silicon and Intel. The app isn't signed with an Apple Developer ID yet, which is why step 3 is needed.

## Optional: the local model

The cat thinks with simple rules out of the box. If you have [Ollama](https://ollama.com) running with `gemma3:1b` pulled, it uses that as its slow brain. Turn it on or off in the menu with **Use the local model**. Everything stays on your Mac.

## Check the download

`Felinquent.dmg.sha256` holds the SHA-256 of the DMG. Compare it with `shasum -a 256 Felinquent.dmg`.
