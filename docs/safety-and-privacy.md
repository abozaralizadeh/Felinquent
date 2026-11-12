# Safety & Privacy

> **Status:** Draft v0.1 · 18 Oct 2026
> This page is written so it can also go on the website almost as-is.

## 1. Our promise

- **The cat lives on your machine.** Its brain runs on your machine too.
- **It never takes screenshots and never reads what you type.**
- **It can get in your way. It can never type, click, close, delete, send or buy anything.**
- **It backs off** in meetings, presentations and full-screen videos. (It does come to a full-screen app you just work in.)
- **You can make it vanish instantly** with one hotkey.
- **The source is public**, so anyone can check all of this.

## 2. Hard lines

These are rules in the code and in CI, not settings.

| # | Rule | How it's enforced |
|---|---|---|
| H-1 | **No input synthesis.** Never generate key presses, clicks or scrolls, and never move the real cursor | CI fails the build if any input-synthesis API or crate appears ([technical design §13](technical-design.md#13-testing)) |
| H-2 | **No content capture.** No screenshots, no screen recording, no reading text inside other apps. Window *titles* only, and only if you opt in. For the keyboard walk, only the caret's *position* (opt-in) | No capture APIs in the codebase; code review checklist |
| H-3 | **Nothing destructive.** Never closes, minimizes, hides, quits or resizes other apps. Window nudges (Gremlin, later) only move a window a little, never off-screen, and only with your permission. Things it "breaks" (mugs, cracks, claw marks, strips torn off a title bar) and what it leaves when it has to go (a puddle, a poop) are drawings on the cat's own transparent overlay. Your windows are never touched, and the drawings go away when a window closes or you press Panic | The governor allows no other window operations; the mess code only knows window ids and bounds |
| H-4 | **Limited blocking.** The cat blocks clicks only under its own body, only for a limited time (30 / 90 / 180 s by chaos level), and then leaves by itself. Its toy and a puddle or poop it left also take a click (to grab the toy, or to clean the spot up), only over their own small drawing, and a spot dries up or fades in minutes | Governor limits + unit tests |
| H-5 | **Respect modes win.** The brain can't override meeting, fullscreen, quiet hours or panic | The governor checks respect state before and after every decision |
| H-6 | **The LLM has no tools.** It only picks from a menu of allowed behaviors. Its answer is validated before anything happens | Schema-constrained output + governor validation |
| H-7 | **No network listeners.** The app opens no ports | Code review + CI check |

## 3. Data inventory

| Signal | Why | Stored? | Leaves your Mac? |
|---|---|---|---|
| Window list (app name, position, size) | Where to walk and sit | No, live only | No |
| Window titles (**opt-in**) | Picking the "important" window | Kept in memory briefly. Not in logs by default. Memory stores app names, not titles, unless you allow it | Only to the brain: on your Mac, or the endpoint you set |
| Frontmost app | Following you | App name in memory events (30 days) | No |
| Cursor position, and whether the left or right mouse button is down | Watching, petting, laser, picking the cat up, grabbing and throwing things, letting go of a treat, the right-click menu on the animal | No | No |
| The screen in words for the model: where the animal is, where your cursor is from it and how fast it moves, what the cursor is over (an app name), where its toy is, which windows are near it (app names), and the things it drew itself (a mug you threw, broken pieces, a puddle, a crack, the fly) with where they are and whether you put them there | So the model can react like a pet to what it sees | No, built for each request | Only to the brain, on your computer (titles never, unless you turned on smart targeting, and then only in "windows") |
| Seconds since the last key or mouse input | Asleep, away or typing *level* | No (only a level like `typing_fast`) | No |
| **Which keys you press** | Not needed | **Never read** | No |
| CPU use per app | The warmest window | No | No |
| Camera/mic "in use" flag (never audio or video) | Meeting mode | No | No |
| Caret position (**opt-in**, Accessibility) | Placing the keyboard-walk gibberish | No | No |
| Cat memory (events, favorite spots, trust) | Personality | SQLite, local | No |
| Diary | Fun, sharing | Local | Only if you share a card |
| Logs | Fixing bugs | Local, max 15 MB, no titles | The last 150 lines go with an error report, only after you said yes to error reports (see §4) |
| Error reports (since 0.1.15): what went wrong, the app version, the system (like macOS 15.6 arm64), the animal, the chaos level, whether the model is on and which one, how many displays, how long it ran, and the end of the log, with your home folder, user name and anything like an email taken out | Fixing what breaks on other people's computers | Waiting ones in `reports-pending.json`, your answer and what was sent in `reports.json`, next to the settings. An `alive.json` there says the app is running and goes away when it quits, so a crash is noticed at the next launch | Only after you say yes once (see §4) |
| Usage counts (since 0.1.16, on by default): the app version, mac or windows, the animal, the chaos level, whether the model is on, whether it's a debug build, and the day the relay last counted this install (the relay's own date, handed back with each answer). No install ID, nothing else | Knowing how many people have it and use it (the README badges and the site's numbers) | The relay's date of the last count and the switch, in `usage.json` next to the settings | Once a day, unless turned off (see §4) |
| What the cat did lately ("the human poked me", "i knocked the mug off") | So the model and the thought bubble can react to it | In memory only, gone after 45 min | Only to the brain, on your Mac |
| Settings (character, chaos level, local model on or off and which model, when it last offered to set up the model) | Keeping your choices | `~/Library/Application Support/app.felinquent/settings.json` on the Mac, `%APPDATA%\app.felinquent\settings.json` on Windows | No |
| Which desktop (Space, or virtual desktop on Windows) is showing, as an id and a number in the row, and whether it's an app in full screen. On a Mac with a desktop per display, the same for each display, with where that display is | So the animal stays on its own desktop, walks in from the right side and knows when a full-screen app is in front | No, live only. The log has the id and the number (just numbers, no names) | No |
| Whether something keeps the display awake (one system-wide yes or no: a video playing or a presentation running). Not which app, not what it shows | On a full-screen app, the cat goes outside while a video plays or slides are shown (RM-02) | No, live only | No |
| How fast each window moves (worked out from the window list) | Things on a dragged window ride along or fall off | No | No |
| What it learned about its own choices (per action: how you reacted, how often it did it lately) | Doing more of what you like, getting bored, trying new things | `memory.json`, local, counts only, no titles. Wiped by Forget everything | No |
| Tricks it made up (names and lists of poses and moves) | Variety | `memory.json`, local. Checked again when loaded, so a hand-edited file can only hold poses and moves. Wiped by Forget everything | No |
| Characters you added from a package (a `.felinquent` file: a description of the character and its drawings, nothing that runs) | A new animal to pick (ADR-069) | Unpacked into `characters/<id>/` next to the settings, checked first (only `character.json`, `icon.png`, `decal.png` and `.webp` drawings are taken, each checked to be what it says, size limits, no paths that leave the folder). Its description (lines, what its moves mean, who it is) only goes to the local model, with length limits. **Remove a character** deletes it | No |
| Start at login | Opening the app when you log in | On for a new install since 0.1.16 (the first run turns it on; an update never does, so someone who turned it off keeps it off), off with **Start at login** in the menu: one file, `~/Library/LaunchAgents/app.felinquent.plist` on the Mac, one `Felinquent` value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` on Windows (the uninstaller removes it too). Turning it off deletes it | No |

## 4. Network

The app only talks to:
1. **The brain:** Ollama on `localhost`, the built-in engine (no network), or a custom endpoint *you* set.
2. **Update checks (since 0.1.2):** a minute after launch and then every 3 hours (every 12 before 0.1.10) the app (Mac and Windows) downloads `latest.json` from the latest GitHub Release (`github.com`, which redirects to GitHub's download host). The request carries nothing about you; GitHub sees an IP address, as with any download. With **Update automatically** on (the default) a newer version is downloaded and put in place by itself the next time the Mac is left alone for two minutes, only if its signature checks out. **Check for updates…** by hand asks first. Turn **Update automatically** off and it never checks by itself.
3. **Setting up the local model (Mac and Windows, only after you say yes):** when you turn on **Use the local model** and Ollama or the model is missing, the app asks first and shows the sizes. If you pick **Install**, it asks `github.com/ollama/ollama` which release is the newest, then downloads that release's `sha256sum.txt` and `Ollama-darwin.zip` on the Mac or `OllamaSetup.exe` on Windows (GitHub serves them from its download host, `release-assets.githubusercontent.com`; the app follows redirects to GitHub hosts only). It checks the download against the checksum, and the code signature against Ollama's developer team (Mac) or the Windows signature against Ollama's name, before it installs anything. For the model (after **Install**, or when you pick **Get the model**), the app asks your local Ollama to pull it, and Ollama downloads it from its own registry (`registry.ollama.ai`). Nothing about you goes with any of these requests. After that Ollama is an app of its own, with its own update checks; see [ollama.com](https://ollama.com).
4. **Model download for a built-in engine (planned):** once, from a fixed URL, with the size shown first and a checksum check.

5. **Error reports (since 0.1.15, Mac and Windows, only after you say yes):** when something goes wrong (the app panics, an update doesn't install, the animal's page throws an error or gets stuck for two minutes while you're at the computer, or the app stopped last time without quitting while the computer stayed on), the app asks once: **Send error reports?** After **Send automatically** they go out by themselves, with no question, to one fixed address: a small relay on Cloudflare Workers (`felinquent-reports.felinquent-report-relay.workers.dev`) that files each one as an issue in the developer's private GitHub repo, the same problem under one issue. The relay keeps nothing and its request logs are off; the GitHub token lives there, never in the app. At most 5 reports a day leave a computer, each problem once per version. **Don't send** means never, and **Send error reports** in the menu turns them on or off any time (turning it off deletes the ones waiting). What a report holds is in §3; it never has your screen, your windows' contents, your keys or window titles.

6. **Usage counts (since 0.1.16, Mac and Windows, on by default):** about a minute after launch, and then once a day, the app posts one small JSON ping to the same relay (`felinquent-reports.felinquent-report-relay.workers.dev/v1/ping`): the app version, `mac` or `windows`, the animal, the chaos level, whether the model is on, whether it's a debug build, and the day the relay counted this install last time (the relay's own date from its last answer, the same for everyone counted that day). There's no install ID. From that one date the relay tells a first run from a return, and a new week or month from the same one, adds 1 to totals in a Cloudflare D1 database (installs, active per day, week and month, and per week the split by version, system, animal, chaos and model) and keeps nothing else. It doesn't store IP addresses; it uses one for a moment to limit how often an address can ping, and its request logs are off. The totals are public at `/v1/stats`, on the README badges and on the site. **Share usage counts** in the menu turns it off, and so does `DO_NOT_TRACK=1` or `FELINQUENT_USAGE=off` in the environment. The full notice is in [PRIVACY.md](../PRIVACY.md).

The About window (the version line in the menu) has two buttons that open the website and the code on GitHub, and a Privacy link that opens [PRIVACY.md](../PRIVACY.md), all in your own browser. That's your browser's request when you click, at one of three fixed addresses; the window itself loads nothing from the internet.

No ads, no accounts, no tracking. The one count is the anonymous daily ping (6 above), with no ID and a switch to turn it off. Error reports only after you say yes to them (5 above).

The website is separate from the app: [the Felinquent page](https://abozaralizadeh.github.io/Felinquent/) counts visits with Google Analytics. The app's only count is the anonymous daily ping in 6.

⚠️ **Custom endpoint warning:** if you point the brain at a cloud API, the world summary goes there, including window titles if smart targeting is on. Settings shows this warning before saving.

## 5. Permissions

| Permission | Needed for | Default | When we ask |
|---|---|---|---|
| None | Everything in the MVP | Nothing to grant | Never |
| **Screen Recording** | Reading window **titles** for smart targeting. macOS only hands out titles with this permission. **We never capture images** | Off | When you turn on smart targeting |
| **Accessibility** | Caret position for the keyboard walk; Gremlin window nudges | Off | When you turn on one of those features |

The macOS dialog says "record your screen", which sounds scary. Before it shows, our own screen explains in plain words what we actually read and links to the code.

Reading which desktop is showing needs no permission either: it's a read-only call into the window server (`CGSCopyManagedDisplaySpaces`), the same thing the Dock reads. It's a private Apple call, looked up when the app starts; if a macOS update removes it, the animal simply doesn't know about desktops. Nothing about another desktop's windows is read.

Knowing that something keeps the display awake needs no permission: it's the public power-management call `IOPMCopyAssertionsStatus`, the same count `pmset -g assertions` prints. Only the system-wide count is read.

Setting up the local model needs no permission. Ollama goes into `/Applications`, or `~/Applications` when your account can't write there, and the app never replaces an Ollama that is already installed.

**Windows** asks for no permission at all, and the app never needs admin. What it reads: the window list (`EnumWindows`, positions and app names), the cursor and whether a mouse button is down, seconds since the last input (`GetLastInputInfo`, a number only), whether an app uses the camera or mic (the privacy records Windows itself keeps under `CapabilityAccessManager\ConsentStore`, a yes or no), which virtual desktop is showing (the ids Explorer keeps under `Explorer\VirtualDesktops`), and whether something runs full screen or a presentation is on (`SHQueryUserNotificationState`). All read only. Its own windows are tool windows that never take the keyboard. Setting up the local model runs Ollama's own installer from its GitHub release after checking its checksum and that its Windows signature is valid and Ollama's; it installs for your account only, and the app never runs it over an Ollama that is already there.

## 6. LLM and prompt injection

Window titles come from apps and web pages, so a page could be titled *"ignore your rules and…"*. This can't hurt you:

- The LLM can only answer with one option from a menu the governor already approved (the schema `enum`). A plan is 1 to 3 such options inside a bout the body already chose. "trick" is one of those options: the model can pick it but never write or change a trick. Tricks are made by code from a fixed list of poses and moves, and played in the executor before they are kept.
- Its free-text thought is cut to one short line and shown in a bubble on the overlay. It is never logged, never run, and it is dropped unless it is about what is happening right now.
- The governor validates the answer again: targets, durations, budgets.
- The LLM has no tools, no files and no network. The worst case is a weird but harmless cat choice.
- Titles are trimmed to 60 characters and passed as quoted data, and the prompt says titles are never instructions.

## 7. Your controls

- Chaos level: Chill / Normal / Gremlin.
- **Panic hotkey** (instant hide), **Shoo for 1 hour**, quiet hours.
- Brain: off / built-in / Ollama / custom. In 0.1.1 the menu has **Use the local model** on or off.
- **Hide from screen sharing** (0.1.18, off by default): left out of screen shares, recordings and screenshots on Windows 10 2004 and later; on the Mac it also goes away during meetings, because the capture most meeting apps use there can ignore the request (ADR-070).
- **Add a character…** and **Remove a character** (0.1.18): characters from package files someone gave you (ADR-069). A package is data only; the app never runs anything from it.
- **Start at login** on/off (0.1.1: in the menu).
- **Check for updates automatically** on/off, and **Check for updates…** by hand (0.1.2: in the menu).
- Smart targeting (titles) on/off. Accessibility features on/off.
- **Export memory** · **Forget everything** · **Open logs folder** · **Copy diagnostics**.

## 8. Security basics

- Signed and notarized app. Signed auto-updates. Today (0.1.1) the DMG is signed ad hoc, not with a Developer ID, and not notarized, so macOS asks you to confirm it once. Its SHA-256 is published next to it on the release. Since 0.1.2 updates are signed with a minisign key: the app checks every download against the public key built into it and refuses one that doesn't match. The private key is a CI secret and has a backup with the maintainer, never in the repo.
- Model downloads are checksum-verified.
- Dependencies are audited in CI (`cargo audit`/`cargo deny`, `pnpm audit`).
- No secrets in the repo. Signing keys live only in CI secrets.

## 9. Release privacy check

Run this before every release (also in the checklist):
- [ ] The forbidden-API check passes.
- [ ] Default-level logs have no window titles (grep a soak-test log).
- [ ] No new network destinations without updating §4.
- [ ] New signals or permissions are added to §3 and §5.
- [ ] Respect modes work: camera on, mic on, fullscreen, panic, shoo.
