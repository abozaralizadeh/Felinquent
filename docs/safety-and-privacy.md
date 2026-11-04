# Safety & Privacy

> **Status:** Draft v0.1 · 18 Oct 2026
> This page is written so it can also go on the website almost as-is.

## 1. Our promise

- **The cat lives on your machine.** Its brain runs on your machine too.
- **It never takes screenshots and never reads what you type.**
- **It can get in your way. It can never type, click, close, delete, send or buy anything.**
- **It backs off** in meetings, presentations and fullscreen apps.
- **You can make it vanish instantly** with one hotkey.
- **The source is public**, so anyone can check all of this.

## 2. Hard lines

These are rules in the code and in CI, not settings.

| # | Rule | How it's enforced |
|---|---|---|
| H-1 | **No input synthesis.** Never generate key presses, clicks or scrolls, and never move the real cursor | CI fails the build if any input-synthesis API or crate appears ([technical design §13](technical-design.md#13-testing)) |
| H-2 | **No content capture.** No screenshots, no screen recording, no reading text inside other apps. Window *titles* only, and only if you opt in. For the keyboard walk, only the caret's *position* (opt-in) | No capture APIs in the codebase; code review checklist |
| H-3 | **Nothing destructive.** Never closes, minimizes, hides, quits or resizes other apps. Window nudges (Gremlin, later) only move a window a little, never off-screen, and only with your permission | The governor allows no other window operations |
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
| Cursor position, and whether the primary mouse button is down | Watching, petting, laser, picking the cat up | No | No |
| Seconds since the last key or mouse input | Asleep, away or typing *level* | No (only a level like `typing_fast`) | No |
| **Which keys you press** | Not needed | **Never read** | No |
| CPU use per app | The warmest window | No | No |
| Camera/mic "in use" flag (never audio or video) | Meeting mode | No | No |
| Caret position (**opt-in**, Accessibility) | Placing the keyboard-walk gibberish | No | No |
| Cat memory (events, favorite spots, trust) | Personality | SQLite, local | No |
| Diary | Fun, sharing | Local | Only if you share a card |
| Logs | Fixing bugs | Local, max 15 MB, no titles | Only if you send them |
| Settings (character, chaos level, local model on or off) | Keeping your choices | `~/Library/Application Support/app.felinquent/settings.json` | No |
| Start at login | Opening the app when you log in | Only if you turn it on: one file, `~/Library/LaunchAgents/app.felinquent.plist`. Turning it off deletes it | No |

## 4. Network

The app only talks to:
1. **The brain:** Ollama on `localhost`, the built-in engine (no network), or a custom endpoint *you* set.
2. **Update checks:** GitHub Releases. They can be turned off.
3. **Model download:** once, from a fixed URL, with the size shown first and a checksum check.

No analytics, no ads, no accounts, no crash reporting unless you send diagnostics yourself.

⚠️ **Custom endpoint warning:** if you point the brain at a cloud API, the world summary goes there, including window titles if smart targeting is on. Settings shows this warning before saving.

## 5. Permissions (macOS)

| Permission | Needed for | Default | When we ask |
|---|---|---|---|
| None | Everything in the MVP | Nothing to grant | Never |
| **Screen Recording** | Reading window **titles** for smart targeting. macOS only hands out titles with this permission. **We never capture images** | Off | When you turn on smart targeting |
| **Accessibility** | Caret position for the keyboard walk; Gremlin window nudges | Off | When you turn on one of those features |

The macOS dialog says "record your screen", which sounds scary. Before it shows, our own screen explains in plain words what we actually read and links to the code.

## 6. LLM and prompt injection

Window titles come from apps and web pages, so a page could be titled *"ignore your rules and…"*. This can't hurt you:

- The LLM can only answer with one option from a menu the governor already approved (the schema `enum`).
- The governor validates the answer again: targets, durations, budgets.
- The LLM has no tools, no files and no network. The worst case is a weird but harmless cat choice.
- Titles are trimmed to 60 characters and passed as quoted data, and the prompt says titles are never instructions.

## 7. Your controls

- Chaos level: Chill / Normal / Gremlin.
- **Panic hotkey** (instant hide), **Shoo for 1 hour**, quiet hours.
- Brain: off / built-in / Ollama / custom. In 0.1.0 the menu has **Use the local model** on or off.
- **Start at login** on/off (0.1.0: in the menu).
- Smart targeting (titles) on/off. Accessibility features on/off.
- **Export memory** · **Forget everything** · **Open logs folder** · **Copy diagnostics**.

## 8. Security basics

- Signed and notarized app. Signed auto-updates. Today (0.1.0) the DMG is signed ad hoc, not with a Developer ID, and not notarized, so macOS asks you to confirm it once. Its SHA-256 is published next to it on the release. No auto-updates yet.
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
