# Felinquent

A cat that lives on your desktop and does whatever it wants.

![Tabby walks along the top of a code window and lies down, gets petted, gets poked, then gets carried over to a video window](docs/assets/demo.gif)

**Website: [abozaralizadeh.github.io/Felinquent](https://abozaralizadeh.github.io/Felinquent/)**. The clip above is the browser playground, which runs the same brain and animals as the Mac and Windows app on pretend windows.

It walks along the tops of your windows, naps on the Dock, sits on the thing you're reading and ignores you when you call it. Pet it and it purrs, for a while. Poke it and it reacts like the animal it is. It's not useful, and that's the point.

Turn the chaos level up and it gets worse. Mugs, plants and glasses show up on your windows and it pushes them off, slowly, while looking at you. They break into pieces on the floor. It claws title bars, chases flies, and at gremlin it runs laps across your windows and lands hard enough to crack one. Once in a while it has to go, so it pees or poops right there on your window, looks back at it, and (if it's a cat) turns round and covers it up. Click the mess to clean it, or wait and it dries up. Never at chill. None of it is real: the mess is drawn on the cat's own see-through layer, your windows are never touched, and Panic clears it all.

Move your cursor close and it looks at it, its head following it all the way round, up, over its shoulder, and a tilt of the head when you stop. Lying down or sitting on a ledge it just turns its head. Sometimes it follows you around and pesters you, or decides the cursor is prey and pounces on it. At gremlin, move the cursor fast near it and it chases it across your windows. Each animal has its own toy: a red yarn ball, a catnip fish, a stolen sock, a tennis ball, a carrot, an acorn and so on. Grab the toy with the mouse and throw it (or pick "Throw its toy" in the menu) and the animal is after it right away: the puppy fetches it and drops it at your feet, the fox runs off with it, the squirrel buries it, a cat might just bat it about or ignore it. You can pick up the mugs and plants too, and throw them: its eyes follow it through the air, and when it lands the animal jumps, bolts, goes over to sniff it or pretends it saw nothing, and the local model hears exactly what you threw and where it smashed. Give it a treat and one hangs at your pointer, its own kind (a fish biscuit for a cat, a bone biscuit for a dog, a strawberry for the rabbit, a peanut for the squirrel...). It comes and begs right under it until you click, then it eats it, bite by bite. Right-click the animal for a little menu of things to do to it: give it a treat, throw its toy, pet it, set off its zoomies, send it for a nap, switch the character or the chaos level, shoo it or hide it. They all happen at once, model or no model. Shoo it for an hour and it comes back in a huff. Come back after a while away and it comes over to say hi. Drag the window it's sitting on and it rides along; fling it and the animal (and the mug next to it) goes flying. Switch to another desktop and it stays behind, then wanders over a bit later from the side you came from, full-screen apps included (a treat from the menu calls it over right away). With two monitors on a Mac it goes by the one it's on: switch that one and it stays behind, switch the other and it doesn't care.

<img src="docs/assets/pet-menu.png" width="320" alt="The menu you get when you right-click the animal, next to Biscuit the puppy: Give a treat, Throw its toy, Pet it, Zoomies!, Nap time, Character, Chaos level, Shoo for 1 hour, Panic: hide the cat">

It also makes up its own tricks. When it wakes from a nap it sometimes remixes something it knows into a new little routine, tries it out, and the first time it shows you, the bubble names it ("new trick: the needy snub"). It notices what you pet it for and what you shoo it for, gets bored of doing the same thing, and is curious about what it hasn't done in a while, so it doesn't settle into a loop.

![Tabby, Inky, Pearl, Mochi, Bandit, Biscuit, Chili, Clover and Hazel, each in eleven poses](docs/assets/characters-sprites.jpg)

There are nine characters: three cats (Tabby, Inky, Pearl), a fox (Mochi), a raccoon (Bandit), two dogs (Biscuit, and Chili the chihuahua), a rabbit (Clover) and a squirrel (Hazel). Each has its own instincts. The cats nap and ignore you, the dogs come running (the chihuahua yaps about it), the fox stalks, the raccoon steals, the rabbit startles and does happy little jumps, the squirrel can't sit still and tells you off. The rabbit and the squirrel hop instead of walking. Every pose is a little drawn sequence, not one still picture.

![Eight moments of the walk cycle over the same patch of floor](docs/assets/rigged-walk-film.jpg)

**Status: early.** The brain, rules, movement and animation are built and tested, and a browser playground runs all of it on pretend windows. The Mac and Windows app is a working prototype: a transparent overlay where the cat stands on your real windows.

## Install on a Mac

[Download Felinquent.dmg](https://github.com/abozaralizadeh/Felinquent/releases/latest/download/Felinquent.dmg), open it and drag Felinquent into Applications. It needs macOS 13 or newer and runs on Apple Silicon and Intel.

The first time you open it, macOS says it can't check the app, because it isn't signed with an Apple Developer ID yet. Click Done, open System Settings > Privacy & Security, scroll down and click Open Anyway. You only do this once.

Or skip that step and paste this in Terminal. It downloads the same app, checks it against the checksum on the release, puts it in Applications and starts it, with no warning:

```bash
curl -fsSL https://raw.githubusercontent.com/abozaralizadeh/Felinquent/main/scripts/get-mac.sh | bash
```

After that it lives in the menu bar. Pick a character, set the chaos level, give it a treat, throw its toy, pet it, set off the zoomies, send it for a nap, hide it, shoo it for an hour, turn the local model on or off and pick which Ollama model it uses (any you have pulled), make it start at login. A tick shows what's on, and the version at the top opens a little About window. From 0.1.10 it checks GitHub for a new version at launch and every 3 hours and updates itself when you leave the Mac alone for a couple of minutes (turn off "Update automatically" in the menu if you'd rather not; "Check for updates…" asks first). More in [docs/INSTALL.md](docs/INSTALL.md), including how to build it yourself.

## Install on Windows

[Download Felinquent-setup.exe](https://github.com/abozaralizadeh/Felinquent/releases/latest/download/Felinquent-setup.exe) and open it. It needs Windows 10 or 11 (64-bit) and installs for you only, no admin. SmartScreen may say it protected your PC, because the installer isn't signed with a Windows certificate yet: click More info, then Run anyway. You only do this once.

Or skip that and paste this in PowerShell. It downloads the same installer, checks it against the checksum on the release, installs it and starts it, with no SmartScreen question:

```powershell
irm https://raw.githubusercontent.com/abozaralizadeh/Felinquent/main/scripts/get-windows.ps1 | iex
```

The cat stands on your taskbar, and its menu is the icon by the clock: the same menu as on the Mac. Panic is Ctrl+Alt+Shift+P. It updates itself the same way too.

## What it will and won't do

- It can get in your way, on purpose. It never types, clicks, scrolls, moves your cursor, closes anything or sends anything. A check in CI fails the build if code that fakes input shows up.
- No screenshots or screen capture, ever. It reads window positions, idle time and whether the camera or mic is on, nothing else.
- It backs off in meetings, full-screen videos and presentations, and screen sharing, and there's a panic hotkey.
- Everything runs locally. No accounts, no analytics, no cloud. The one thing it fetches on its own is the update check, a small file from GitHub with nothing about you in it, and you can turn it off. An optional small local model (through [Ollama](https://ollama.com)) plans what the cat does next and gives it thoughts in a little bubble. Turn it on in the menu and, if Ollama or the model is missing, the app offers to set them up (it asks first and shows the sizes). Without it a rules brain does the same job, and every move still happens: the toy, the chase, the potty, all of it.

The full list is in [docs/safety-and-privacy.md](docs/safety-and-privacy.md).

## Try it in the browser

No install, just the playground. You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. Drag the pretend windows (slowly, then fast), hover over the cat to pet it, drag it to pick it up, shake it to shoo it, click it to poke it. Drag its toy and throw it, or press Throw toy. Press Give treat, then click to drop it. Press Has to pee or Has to poop to skip the wait. Try the Meeting and Panic switches, the chaos level, the desktop arrows, its ball, and "Make up a trick".

To build the Mac app from source instead of downloading it (needs Rust):

```bash
bash scripts/install-mac.sh
```

## Tests

```bash
npm run typecheck
npm test                   # unit and simulation tests (hours of simulated cat life)
npm run check:forbidden    # fails if any code fakes input or captures the screen
npm run build
npm run eval -- --brain rules    # scores a brain on repeatable scenarios (also: fake, ollama)
npm run pace -- 60 biscuit       # how busy an animal looks over a simulated hour
npm run month -- 30 normal       # a simulated month: variety, tricks, and whether it learns what you like
```

## How it works

The cat's day comes in bouts: a long rest, a stroll, some play, a visit to you, some mischief. Its body picks the next bout from what it just did, how it feels and the chaos level. A slow brain (rules, or a small local model) then plans a few steps inside it, with pauses in between, and can only pick from a menu that the rules and a governor prepare. What it learned about you, what it's bored of and what's new to it tilt that menu, and its own tricks are on it too. The governor approves every action. A fast layer moves the cat, plays the animation and handles your pointer. The Mac shell is [Tauri](https://tauri.app): one transparent, click-through window per display.

| Doc | What's in it |
|---|---|
| [docs/LOGICAL-FLOW.md](docs/LOGICAL-FLOW.md) | How the cat thinks and moves, step by step |
| [docs/DESIGN.md](docs/DESIGN.md) | Module map, the seams, how to extend it |
| [docs/technical-design.md](docs/technical-design.md) | Architecture, the intent schema, the governor |
| [docs/behavior-catalog.md](docs/behavior-catalog.md) | Every behavior, reflex and respect mode |
| [docs/art-and-ux.md](docs/art-and-ux.md) | The look, the animation list, the art tools |
| [docs/safety-and-privacy.md](docs/safety-and-privacy.md) | The hard lines and the data it touches |
| [docs/spikes/](docs/spikes/README.md) | Notes from the prototype runs on a real Mac |
| [docs/INSTALL.md](docs/INSTALL.md) | Install on a Mac, on Windows or on a Linux server for the demo |

## Contributing

Issues and pull requests are welcome. Keep the hard lines: no synthetic input, no screen capture, nothing destructive to other apps, and the governor approves every action. Run the checks above before you open a pull request. A new behavior needs a row in the behavior catalog and a test. The details, and what you agree to when you send code, are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Felinquent is source available, free for non-commercial use. Personal use, hobby projects, research, schools and charities are all fine. Selling it or using it in a commercial product isn't, unless you ask first.

- Code: [PolyForm Noncommercial 1.0.0](LICENSE)
- Art (sprites, icons, images): [CC BY-NC 4.0](LICENSE-ART.md)
- Other people's work it uses, including the optional Gemma model: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

The character art is AI-assisted and animated in code.
