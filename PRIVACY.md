# Privacy notice

Last updated: 10 November 2026, for Felinquent 0.1.16 and later (the Mac and Windows app) and its website.

Felinquent is made by Abozar Alizadeh ([github.com/abozaralizadeh](https://github.com/abozaralizadeh)). For questions about this notice, open an issue at [github.com/abozaralizadeh/Felinquent/issues](https://github.com/abozaralizadeh/Felinquent/issues).

## The short version

Felinquent runs on your computer and keeps what it learns there. Three things can leave your computer:

1. **Usage counts, on by default.** One anonymous ping a day, so the project can count installs and users. No ID, nothing about you. Turn it off in the menu.
2. **Error reports, only after you say yes.** When something breaks, the app asks once whether it may send them.
3. **Update checks.** A small file from GitHub every few hours. You can turn these off too.

It never takes screenshots, never reads what you type, and never sends window titles, file names or anything from your screen. The full list of what it looks at, and what it keeps, is in [docs/safety-and-privacy.md](docs/safety-and-privacy.md).

## 1. Usage counts (on by default)

**What is sent.** Once a day, about a minute after the app starts, it sends this and nothing else:

| Field | Example | Why |
|---|---|---|
| App version | `0.1.16` | Which versions are still in use |
| System | `mac` or `windows` | How many use each |
| Animal | `tabby` | Which characters people pick |
| Chaos level | `normal` | How people set it |
| Local model on or off | `true` | How many use the model |
| The date it was last counted | `2026-11-09` | To tell a first run from a return, and a new week or month from the same one |
| Debug build or not | `false` | So test copies stay out of the numbers |

The date is the one the relay itself handed back last time, the same for everyone counted that day. There is **no install ID, no user name, no device name, no hardware details and nothing from your files, windows or screen.**

**Where it goes.** To a small relay of ours running on Cloudflare Workers (`felinquent-reports.felinquent-report-relay.workers.dev`). The relay adds 1 to some totals and throws the ping away. The totals live in a Cloudflare D1 database in Cloudflare's European region.

**What is stored.** Only totals: how many installs ever, how many were active each day, each week and each month, and for each week how many of them used each version, system, animal, chaos level and model setting. Nothing in the database belongs to any one person, so the totals are kept with no end date. They are public: [the website](https://abozaralizadeh.github.io/Felinquent/#numbers) and the README badges show them, and anyone can read them at the relay's `/v1/stats` address.

**What is not stored.** Your IP address. Like any web server, Cloudflare receives it with the request; the relay uses it only for a moment to stop one address from sending too many pings, never writes it down, and its request logs are turned off.

**Turning it off.** Untick **Share usage counts** in the menu (the icon in the menu bar or by the clock). Setting the environment variable `DO_NOT_TRACK=1` or `FELINQUENT_USAGE=off` also turns it off. Blocking the address above in a firewall works too, and the app carries on as normal.

**Why it's on by default.** Without it there's no way to know whether anyone uses Felinquent at all. Because the counts can't be tied to anyone, there is nothing personal in them. Where EU data protection law still applies to sending them, the basis is the project's legitimate interest in knowing how the app is used (Article 6(1)(f) GDPR), and the switch in the menu is your right to object, honoured at once. The counts are never used for ads, never combined with other data and never sold.

## 2. Error reports (only after you say yes)

When something goes wrong (the app crashes, an update doesn't install, the animal's page throws an error or gets stuck, or the app stopped last time without quitting), the app asks once: **Send error reports?**

- **Don't send** means none are ever sent.
- **Send automatically** means later reports go out by themselves. **Send error reports** in the menu turns this off any time, and turning it off deletes the ones still waiting.

A report holds what went wrong, the app version, the system (like `macOS 15.6 arm64`), the animal, chaos level, whether the model is on and which one, how many displays, how long the app ran, and the last 150 lines of the app's own log. Your home folder, user name and anything that looks like an email are taken out first. The log never has window titles, what you type or what's on your screen.

Reports go to the same relay, which files each one as an issue in the developer's private GitHub repository, so it can be fixed. They're kept there until the problem is fixed and the issue is closed, and stay in the repository's history after that. At most 5 reports a day leave a computer. The basis is your consent (Article 6(1)(a) GDPR), which you can take back in the menu at any time.

## 3. Update checks and downloads

- **Updates.** A minute after it starts and then every 3 hours, the app downloads `latest.json` from the project's latest GitHub release. Nothing about you is in the request. With **Update automatically** on, a newer version downloads from GitHub and installs while you're away. Turn **Update automatically** off and it never checks by itself.
- **The local model (optional).** Only if you turn on the model and say yes, the app downloads Ollama from GitHub and Ollama downloads the model from its own registry.
- **The About window** has buttons that open the website and the code in your own browser.

GitHub, Ollama and your browser have their own privacy policies. They see your IP address, as with any download.

## 4. What stays on your computer

Your settings, what the animal learned about you, the tricks it made up and the app's logs (at most 15 MB) stay on your computer. **Forget everything it learned** in the menu wipes what it learned, and uninstalling removes the app. The table in [docs/safety-and-privacy.md](docs/safety-and-privacy.md) lists every signal the app uses and where each one goes.

## 5. The website

The website ([abozaralizadeh.github.io/Felinquent](https://abozaralizadeh.github.io/Felinquent/)) is hosted by GitHub Pages and counts visits with Google Analytics. Its numbers section reads the public totals from the relay. Neither of these is part of the app.

## 6. Your rights

The usage counts can't be linked to you, so there's nothing in them to look up, correct or delete. You can stop them at any time with the switch. For error reports, you can turn them off at any time. If you think a report you sent contains something about you, open an issue with roughly when it was sent and it will be removed. If you are in the EU you can also complain to your data protection authority.

## 7. Changes

If this notice changes, the new version is in this file (its history is on GitHub) and the release notes of the version that brings the change say so.
