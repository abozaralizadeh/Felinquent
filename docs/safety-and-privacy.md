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
| H-3 | **Nothing destructive.** Never closes, minimizes, hides, quits or resizes other apps. Window nudges (Gremlin, later) only move a window a little, never off-screen, and only with your permission. Things it "breaks" (mugs, cracks, claw marks, strips torn off a title bar) are drawings on the cat's own transparent overlay. Your windows are never touched, and the drawings go away when a window closes or you press Panic | The governor allows no other window operations; the mess code only knows window ids and bounds |
| H-4 | **Limited blocking.** The cat blocks clicks only under its own body, only for a limited time (30 / 90 / 180 s by chaos level), and then leaves by itself | Governor limits + unit tests |
| H-5 | **Respect modes win.** The brain can't override meeting, fullscreen, quiet hours or panic | The governor checks respect state before and after every decision |
| H-6 | **The LLM has no tools.** It only picks from a menu of allowed behaviors. Its answer is validated before anything happens | Schema-constrained output + governor validation |
| H-7 | **No network listeners.** The app opens no ports | Code review + CI check |

## 3. Data inventory

| Signal | Why | Stored? | Leaves your Mac? |
|---|---|---|---|
| Window list (app name, position, size) | Where to walk and sit | No, live only | No |
| Window titles (**opt-in**) | Picking the "important" window | Kept in memory briefly. Not in logs by default. Memory stores app names, not titles, unless you allow it | Only to the brain: on your Mac, or the endpoint you set |
| Frontmost app | Following you | App name in memory events (30 days) | No |
| Cursor position, and whether the primary mouse button is down | Watching, petting, laser, picking the cat up, grabbing and throwing its toy | No | No |
| The screen in words for the model: where the animal is, where your cursor is from it and how fast it moves, what the cursor is over (an app name), where its toy is, which windows are near it (app names) | So the model can react like a pet to what it sees | No, built for each request | Only to the brain, on your Mac (titles never, unless you turned on smart targeting, and then only in "windows") |
| Seconds since the last key or mouse input | Asleep, away or typing *level* | No (only a level like `typing_fast`) | No |
| **Which keys you press** | Not needed | **Never read** | No |
| CPU use per app | The warmest window | No | No |
| Camera/mic "in use" flag (never audio or video) | Meeting mode | No | No |
| Caret position (**opt-in**, Accessibility) | Placing the keyboard-walk gibberish | No | No |
| Cat memory (events, favorite spots, trust) | Personality | SQLite, local | No |
| Diary | Fun, sharing | Local | Only if you share a card |
| Logs | Fixing bugs | Local, max 15 MB, no titles | Only if you send them |
| What the cat did lately ("the human poked me", "i knocked the mug off") | So the model and the thought bubble can react to it | In memory only, gone after 45 min | Only to the brain, on your Mac |
| Settings (character, chaos level, local model on or off, when it last offered to set up the model) | Keeping your choices | `~/Library/Application Support/app.felinquent/settings.json` | No |
| Which desktop (Space) is showing, as an id and a number in the row, and whether it's an app in full screen | So the animal stays on its own desktop, walks in from the right side and knows when a full-screen app is in front | No, live only. The log has the id and the number (just numbers, no names) | No |
| Whether something keeps the display awake (one system-wide yes or no: a video playing or a presentation running). Not which app, not what it shows | On a full-screen app, the cat goes outside while a video plays or slides are shown (RM-02) | No, live only | No |
| How fast each window moves (worked out from the window list) | Things on a dragged window ride along or fall off | No | No |
| What it learned about its own choices (per action: how you reacted, how often it did it lately) | Doing more of what you like, getting bored, trying new things | `memory.json`, local, counts only, no titles. Wiped by Forget everything | No |
| Tricks it made up (names and lists of poses and moves) | Variety | `memory.json`, local. Checked again when loaded, so a hand-edited file can only hold poses and moves. Wiped by Forget everything | No |
| Start at login | Opening the app when you log in | Only if you turn it on: one file, `~/Library/LaunchAgents/app.felinquent.plist`. Turning it off deletes it | No |

## 4. Network

The app only talks to:
1. **The brain:** Ollama on `localhost`, the built-in engine (no network), or a custom endpoint *you* set.
2. **Update checks (since 0.1.2):** every 12 hours the Mac app downloads `latest.json` from the latest GitHub Release (`github.com`, which redirects to GitHub's download host). The request carries nothing about you; GitHub sees an IP address, as with any download. If a newer version is out, the app asks before downloading it, and installs it only if its signature checks out. Turn the checks off with **Check for updates automatically** in the menu.
3. **Setting up the local model (Mac, only after you say yes):** when you turn on **Use the local model** and Ollama or the model is missing, the app asks first and shows the sizes. If you pick **Install**, it asks `github.com/ollama/ollama` which release is the newest, then downloads that release's `sha256sum.txt` and `Ollama-darwin.zip` (GitHub serves them from its download host, `release-assets.githubusercontent.com`; the app follows redirects to GitHub hosts only). It checks the zip against the checksum and the app's code signature against Ollama's developer team before it puts anything in Applications. For the model (after **Install**, or when you pick **Get the model**), the app asks your local Ollama to pull it, and Ollama downloads it from its own registry (`registry.ollama.ai`). Nothing about you goes with any of these requests. After that Ollama is an app of its own, with its own update checks; see [ollama.com](https://ollama.com).
4. **Model download for a built-in engine (planned):** once, from a fixed URL, with the size shown first and a checksum check.

No analytics, no ads, no accounts, no crash reporting unless you send diagnostics yourself.

The website is separate from the app: [the Felinquent page](https://abozaralizadeh.github.io/Felinquent/) counts visits with Google Analytics. The app has no analytics of any kind.

⚠️ **Custom endpoint warning:** if you point the brain at a cloud API, the world summary goes there, including window titles if smart targeting is on. Settings shows this warning before saving.

## 5. Permissions (macOS)

| Permission | Needed for | Default | When we ask |
|---|---|---|---|
| None | Everything in the MVP | Nothing to grant | Never |
| **Screen Recording** | Reading window **titles** for smart targeting. macOS only hands out titles with this permission. **We never capture images** | Off | When you turn on smart targeting |
| **Accessibility** | Caret position for the keyboard walk; Gremlin window nudges | Off | When you turn on one of those features |

The macOS dialog says "record your screen", which sounds scary. Before it shows, our own screen explains in plain words what we actually read and links to the code.

Reading which desktop is showing needs no permission either: it's a read-only call into the window server (`CGSCopyManagedDisplaySpaces`), the same thing the Dock reads. It's a private Apple call, looked up when the app starts; if a macOS update removes it, the animal simply doesn't know about desktops. Nothing about another desktop's windows is read.

Knowing that something keeps the display awake needs no permission: it's the public power-management call `IOPMCopyAssertionsStatus`, the same count `pmset -g assertions` prints. Only the system-wide count is read.

Setting up the local model needs no permission. Ollama goes into `/Applications`, or `~/Applications` when your account can't write there, and the app never replaces an Ollama that is already installed.

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
