# Shadow Reapers Target Finder

A Torn PDA and desktop userscript. Tap **TF** to check and open your next available target within
your estimated-stat, fair-fight, inactivity and faction limits. It was formerly *Shadow Reapers
Halloween Targets* in the [Company Command Center](https://github.com/SilverlazeR/torn-company-command-center)
repository, and moved here at v0.5.0.

## Install

Install [`shadow-reapers-target-finder.user.js`](https://raw.githubusercontent.com/SilverlazeR/shadow-reapers-target-finder/main/shadow-reapers-target-finder.user.js)
in Torn PDA (Userscripts, add from URL) or a desktop userscript manager that supports
`GM_xmlhttpRequest`, `GM_getValue` and `GM_setValue`. Updates come from that same URL on `main`.

**Upgrading from the website version:** installs from `shadowreapersfaction.com/userscripts/`
receive a hand-off copy and then follow this repository automatically. Saved keys, targets and
history carry over. If an old PDA entry does not update, set its Remote URL to the link above;
do not delete the entry.

## How it works

- **One target per tap:** one trusted tap checks candidates (Torn API `profile`, paced 1.15s
  apart) and opens **one** native attack page. It never clicks attack controls.
- **Bounded taps:** a tap stops after 20 checks and shows **0**; tap again to continue.
- **Candidates:** they come from FFScouter. The default order is *most likely available first*.
  Recently opened, often-hospitalised and skipped statuses (federal, travel, fallen) are deferred.
- **Settings and logs:** settings live under **TF Settings** on your own Torn profile. **Logs**
  copies a diagnostic report without keys, player identities or response bodies. **Send to
  leadership** uploads that report to the Shadow Reapers owner and shows a log number for Discord.

## Data use

| Data storage | Data sharing | Purpose | Key storage & sharing | Key access level |
|---|---|---|---|---|
| Only locally on your device until cleared; a log you choose to send is kept 30 days on shadowreapersfaction.com | Nobody here; FFScouter receives requested IDs under its policy; a sent log (plus your Torn name and ID only if ticked) goes to the Shadow Reapers owner | Competitive advantage: find targets | Sent only to Torn and FFScouter; saved locally only if you choose Remember | Custom: basic, battlestats, attacks, hof, profile |

## Development

```bash
npm test
```

Node 22 or newer; no dependencies. Keep the userscript ASCII-only (PDA import). Bump `@version` and
the `VERSION` constant together. Changes reach users as soon as they merge to `main`. See
[docs/CHANGELOG.md](docs/CHANGELOG.md) for the full history and owner decisions.
