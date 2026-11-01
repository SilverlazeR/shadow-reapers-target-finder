# Target Finder changelog

Formerly Halloween Targets in `SilverlazeR/torn-company-command-center` (PRs #124, #139-#146).
History below is preserved as written there; file paths in older entries refer to that repository.

v0.5.6 fills in a missing sender name (owner request, November 1, 2026). Players who connected
before v0.5.1 had their Torn ID saved but not their name, so their logs arrived as "Name not sent".
On the first **Send to leadership** tap, TF makes one paced Torn profile check of the key's own
owner and saves the name; later sends make no extra request. It is skipped while a search is
running, and any failure still sends the log with the ID only.

v0.5.5 always includes the sender's Torn ID and name with **Send to leadership** (owner request,
October 31, 2026). The opt-in box is removed; the note beside the button and the data-use table
say so. The key is still never sent, and nothing is uploaded without the tap.

v0.5.4 writes to device storage less often during a search (owner request, October 31, 2026).
Owner logs showed about 44 full-cache writes and 4 seconds of storage time per 20-check tap. The
safety write before each Torn check stays; the write after each check (and after estimate
lookups) is now made at most every 5 seconds, since the next safety write carries it. Opening a
target and the end of every action still save immediately. A full tap drops from 45 to 25 writes.
Torn request spacing is now 1.15s (was 1.25s): at most 52 profile checks a minute, leaving 48 of
Torn's 100 for other tools. A full 20-check tap takes about 23 seconds of spacing instead of 25.

v0.5.3 fixes three code-review items (owner request, October 31, 2026).
- **Torn rules:** the data-use table now sits open directly above the key field instead of inside a
  collapsed section, so it is clearly visible where the key is entered. Data Sharing mentions Send
  to leadership.
- **Saved keys:** only wrong keys are erased (Torn 1/2, FFScouter 1/2, or FFScouter 6 twice in a
  row). Torn 10/13/16/18 (federal jail, inactive owner, access too low, paused) and FFScouter bans
  stop the tap with a specific reason and keep the key.
- **Failed IDs:** players set aside after a Torn backend error (code 17) return to normal checks
  after an hour. A full list of 100 drops the oldest instead of blocking searches. Older saves give
  their IDs one more hour.

v0.5.2 adds a **Settings** line to the diagnostic report (owner request, October 31, 2026): FF
range and priority, stat limits, inactive days, faction, order, source, ID range and skip boxes,
so a shared log shows how the search was set up. It contains only the user's own filters.

v0.5.1 adds **Send to leadership** to the Logs panel (owner request, October 31, 2026), for
reports too long to paste in Discord.
- **What is sent:** one tap uploads only the visible diagnostic report to
  `shadowreapersfaction.com/api/public/script-logs`, where only the Shadow Reapers owner can read
  it; it is deleted after 30 days. The reply shows a log number to mention in Discord.
- **Identity is opt-in:** an unticked-by-default box adds the key owner's Torn ID and name. The
  name is remembered from Torn's own-profile reply when the key is connected (reconnect once to
  fill it in); the ID is already known. The key is never sent. Upload failures never pause TF.
- **Metadata:** adds `@connect shadowreapersfaction.com`.

v0.5.0 moves the script to this repository (owner request, October 31, 2026). `@downloadURL` and
`@updateURL` now point at this repository's `main` branch. The website keeps a hand-off copy at both
old addresses so existing installs move here on their next update. Storage names, settings and
behaviour are unchanged.

v0.4.6 ends fruitless taps sooner (owner approval, October 31, 2026). A v0.4.5 tap confirmed the
fresh-first fix (`newCandidateChecks=26`), but 28 of 29 checks were hospitalised and the owner
stopped it after 35s; roughly nine in ten checks were hospitalised near the end of Halloween.
- **Bad fresh lists:** after three hospital misses, TF requests another list even when players
  from the previous fresh list remain (at most three early lists per tap). Only the newest list is
  preferred.
- **Tap limit:** one tap stops after **20 checks** (about 25s at 1.25s spacing, previously up to 90)
  and skips the ID-search fallback. It shows **0** and "Checked 20 candidates; none were available".
  Another tap continues. Summaries record `tapLimitReached`.

v0.4.5 fixes the fresh-list feature. Owner logs showed it fetching lists after misses (the pool
grew 353 to 603), but every check counted as `cachedChecks` and none as `newCandidateChecks`.
Hundreds of never-checked players from earlier lists tied with the new ones and outranked them on
fair fight, because each list covers a lower FF range. Now players added by a list during the
current tap are checked before anything else in the cache. Once they are used up, three more
hospital misses can request another list, at most three early lists per tap. Lists that refill an
empty queue are unchanged. The same v0.4.4 session had no code 5 pause at 41 TF requests a minute.

v0.4.4 sets Torn request spacing to **1.25 seconds** (at most 48 TF requests a minute, leaving 52
of Torn's shared 100/minute), at the owner's request on October 31, 2026. A v0.4.3 session hit
Torn code 5 while TF had made only 12 requests in that minute; Company/War telemetry showed only a
few server requests per minute, so other tools on the account used most of the limit. Early v0.4.3
results: about 2.2 checks and 1.5s per target opened.

v0.4.3 fixes a ranking flaw seen in owner logs (October 31, 2026). A target TF had just opened
counted as "seen Okay in the last 10 minutes". After the 2-minute duplicate-open hold, it jumped
to the front while usually hospitalised by the owner's own attack. Now a target opened after
its last Okay sighting, with no check since, is checked only after everyone else, and fair-fight
order no longer treats it as likely available. Any later check (for example a hospital stay with
a timer) restores normal ranking, so re-hitting after release still works. Early v0.4.2 logs:
about 3.5s per tap versus about 6s before, and a fresh list after three misses opened its first
fresh candidate in two taps.

v0.4.2 attacks the main remaining cost shown in owner logs (October 31, 2026). Most checks
found the target already hospitalised; each miss costs about one second.
- **New default order, "Most likely available first":** the owner chose this as the default,
  including a one-time switch for existing installs; a later choice in settings is kept.
  It ranks, in order:
  - players seen Okay in the last 10 minutes;
  - candidates never checked on this device;
  - everyone else, with players usually found hospitalised last;
  - then most recently seen Okay, then fair fight.

  Every FF/stat/inactivity/faction limit, skip box and the fresh Okay check before opening
  still apply. Fair-fight and other orders remain options; they now list heavily contested
  players last (at least 3 recent checks, 75% or more hospitalised).
- **Check history:** each profile check records `checks`, `hospitalHits` and `okayAt`. History
  halves after 20 checks so it follows current competition. It is local evidence, never shared.
- **Fresh candidates after misses:** after 3 hospital misses in one tap, TF requests a fresh
  FFScouter list (up to three until one adds a new player) before checking more cached
  candidates. It still uses the 20-lists-per-minute budget. If no list is available, checking
  continues normally.
- **Log summaries** add `earlyBatches` and `contestedAtStart`.

v0.4.1 speeds up searching and improves troubleshooting, at the owner's request (October 31, 2026):
- **Request spacing:** Torn profile checks are spaced **1 second** apart (was 1.5s), at most 60 a minute.
  That leaves 40 of Torn's shared 100/minute for PDA, FFScouter and other tools.
- **Fewer saves:** the spacing timer stays in memory instead of rewriting the whole saved state
  before every Torn request. Every check still saves afterwards, the safety "Unverified" write
  before a check is kept, and opening a target saves before navigating.
- **Fresher estimates:** FFScouter estimates are cached for 7 days and refreshed after a matching
  profile. A newer provider estimate updates a cached candidate without losing its profile
  evidence or timers; an older one, or a refresh with no estimate, keeps the dated value.
- **Error labels:** logs give each error a fixed label (for example `opened history full`,
  `failed-ID list full`, `Torn backend errors (3 in a row)`) instead of only a broad category.
  Still no free-form text, keys or player identities.
- **Summary counts:** status rejections are split into hospital/jail/federal/travel/fallen;
  summaries also record `estimateRefreshes`, `storageWrites` and `storageMs`, which shows
  whether device storage is slowing a tap.

v0.4.0 renames the script for year-round use: **Shadow Reapers Target Finder**,
**TF** dock button and **TF Settings** on the owner's profile. Storage names
(`sr_halloween_*`) and the single-run guard are unchanged, so keys, targets, opened
history and budgets carry over; legacy HF log/cooldown reasons are mapped to TF.
@downloadURL/@updateURL point to the new file. Existing installs check the old
address, receive this identical copy, then follow its new update URL. PDA/Tampermonkey
handling of the @name change on update still needs live validation; if an old entry
does not update, use its Remote URL control with the new address rather than
deleting it. Keep the old address published until installs have moved.

New **Skip players in** checkboxes (all ticked by default, also for existing installs)
stop rechecking long-lived statuses after one profile check: **Federal jail** until
Torn's reported release (7 days if none), **Traveling / abroad** for 15 minutes, and
**Fallen** until Clear shortlist. Holds are computed from the last check, so unticking
takes effect on the next tap; changing them keeps the cached pool. A skip only delays
a check and never qualifies a player. Hospital/jail release-timer behaviour is unchanged.
Applies to the automatic pool, the Torn ID fallback and quick saved rechecks.

v0.3.11 restores the download and declares @downloadURL and @updateURL pointing
to the stable public .user.js URL (no version query). PDA reads these headers for
remote checks; pasted older versions without a saved remote URL need one manual
update in the existing script entry. Use its Remote URL / Check for Update control,
or replace its source in place, preserving the entry and its storage. Do not delete
and recreate the script. Searching, key storage and cache formats are unchanged.

v0.3.10 moves the entire HF/Logs stack above FFScouter's standard button position
(32% from the viewport top), with an 8px gap. CSS anchors the bottom of the stack
so badge height cannot push Logs into FF. No new observers, requests, storage or
behavior changes; the existing 30px HF size and HF-then-Logs order remain.

v0.3.9 follows the owner's priority: operation first, diagnostics second. Log
storage is best-effort and is never awaited during startup, search completion or
attack-page navigation. One in-flight write and one replaceable latest snapshot
bound the write queue even if storage stalls. An immediate navigation/close can
lose recent events. Log reads merge asynchronously; explicit clearing prevents a
late read from resurrecting old history. This is bounded troubleshooting history,
not a complete or guaranteed audit trail, and local recording still has small CPU
and storage overhead. No additional API requests or altered targeting behavior.

Keep 100 detailed events plus 20 separate action summaries, so request bursts do
not evict all summaries. Summaries identify the action and outcome, request counts,
network/request-pacing milliseconds, cached versus newly supplied candidate checks,
independent-ID checks, estimate reuse, initial pool eligibility/skip snapshots and
evaluated rejection counts. Snapshot skip categories can overlap; outcome counts
are evaluations rather than distinct players. Decision duration excludes final log
storage. Error categories are allowlisted rather than raw messages. Unknown errors
remain generic; keys, URLs, player identities and raw bodies remain excluded.

634 full tests, including 134 targeted tests, cover update metadata and slow/hung PDA/GM log reads/writes without blocked startup
or navigation, coalesced writes, bounded summaries across reloads, counters/timing,
safe validation errors, clearing during a pending read and previous safeguards.

v0.3.8 adds a compact Logs button below HF on every supported Torn page. It opens
a separate, manually requested diagnostics panel; normal HF taps still search/open
one target, and no error popup appears automatically. Copy logs uses the clipboard
when available and otherwise selects a readonly report for native manual copying.
Refresh logs only refreshes local text. Clear logs leaves scouting data, keys,
opened history and all request budgets/cooldowns intact.

The last 100 events persist under sr_halloween_logs_v1 on PDA/GM (nonsecret local
storage fallback where needed). The report includes request endpoint labels,
HTTP/API error codes, durations, recorded last-minute request counts, cache totals,
pause cause/expiry and script version. It distinguishes Torn/FFScouter provider
throttles from the local FF list budget and repeated-code-17 pause. Counts cover
only retained events from this installation, not other scripts/devices. Expired
WAIT notices explicitly say another HF tap can retry. Opening/copying logs sends
no API requests; no new polling, retry behavior or rate-limit changes.

Strict field/enum allowlists exclude keys, raw URLs, response/error text, player
IDs/names and profile data on both recording and reload. Writes are batched at
action completion, cancellation and before navigation, rather than per request;
abrupt closure before a flush may lose that in-progress action. Diagnostic storage
errors keep reports available in memory and do not block scouting or reset its
cache/key. Simultaneous tabs can overwrite each other's diagnostic history. Older
WAIT history cannot be reconstructed; new events begin after updating.

Validation: 593 full tests including 127 Halloween regressions pass. Logs tests
cover provider/local/backend pauses, timeout/cancellation, copy/fallback, malformed
and oversized history, credential exclusion, storage failure and reloads. Fictional
390px mobile and 1366px desktop browser checks verify manual access/copy, no extra
API calls and no overflow. Real Torn PDA clipboard behavior remains device-specific;
the native selection fallback is available.

v0.3.7 audits the cache, discovery and final-check paths and removes three avoidable
costs. Filter edits retain the candidate pool and hospital timers, resetting only
the shortlist/pending samples and sample cursor; all retained evidence is evaluated
against the new limits before use. Explicit Clear shortlist still clears the pool.
Independent fallback batches local ID-skip progress instead of serializing the
whole cache for each skipped ID. Progress is saved before a new request and on
completion; profile errors/cancellation still cannot qualify a player.

New automatic fallback profiles use a fresh Torn request. Its result can replace
the redundant second status call only within five seconds in the same invocation,
matching the existing cached-pool fast path. Slow enrichment and pending/queued
profiles from earlier taps still require another fresh check. No faster request
pacing, concurrent network requests, background activity or relaxed FF/stat limits.
The 1,000-entry limits, saved keys and provider budgets remain unchanged.

120 focused regressions cover PDA/GM persistence, retained timers after filter
edits, fewer than 15 storage writes while skipping 1,000 cached IDs, one profile
request on a fast new fallback, slow enrichment/re-hospitalization, old pending
profiles and cancellation. Mobile/desktop fictional browser checks pass. This
proves request/write reductions, not real-world provider latency or freedom from
shared account/IP rate limits. API specification comparison on October 26 found
no functional changes from the preceding 1.14.0 snapshot.

v0.3.6 removes the optional BSP integration at the owner's request. FFScouter is
now the only source of FF and estimated total stats; Torn supplies profile/status.
BSP controls, permission grant, subscription calls, predictions and source selector
are removed. Old source selections migrate without clearing numeric limits,
inactivity, faction, saved targets, opened history or scouting credentials. Obsolete
BSP estimates are discarded during decoding; unknown FF stats still cannot match.
Startup deletes only HF's stored BSP key copy, without contacting that provider or
changing the separately installed BSP script or Torn key. Cleanup failure does not
wipe HF data. An obsolete BSP-only cooldown is cleared; Torn/FF cooldowns remain.

The automatic ID fallback now skips IDs already in the candidate pool, avoiding
second profile/estimate calls for known rejections or failures from that pass.
FFScouter get-targets calls reserve a local rolling budget of 20 requests per
60 seconds, below the documented 25/minute/IP endpoint limit. Timestamp-only budget
storage is separate from cache/keys, so reloads, changing filters and clearing the
shortlist do not reset it. Cached matches keep their one-fresh-Torn-call path even
when this list budget is full. Automatic discovery can try new independent IDs;
if none match, HF shows WAIT with an explicitly labeled local-budget explanation.
No background polling or automatic retry was added. Torn pacing remains 1.5 seconds.

This reduces HF traffic; it cannot guarantee freedom from rate limits. Torn's
100/minute allowance is shared across all keys/tools for the account; FFScouter's
list limit is shared by IP. Other devices/apps are outside this local budget, and
simultaneous tabs without shared locking may race. A first or exhausted-cache
search can still reach a budget; cached availability and difficulty checks are
never skipped. Current validation includes 112 targeted tests, replacing obsolete
BSP-operation cases with migration/removal and request-budget regressions. Real
provider response times and cross-app usage remain live validation.

Sources checked October 26, 2026: https://www.torn.com/api.html and
https://ffscouter.com/openapi/spec.yaml (get-targets 429 documentation).
The release notes below describe history; BSP integration and early hospital
probes in older versions no longer apply.

v0.3.5 follows the owner's preference to wait for known hospital release times.
Automatic HF now skips a cached hospital/jail profile until its reported release,
including older entries with one-minute retry deadlines. After expiry, a fresh
Torn profile must confirm Okay before navigation. If the player has been hit again,
the new release replaces the old timer and persists across PDA/desktop reloads.
Missing/invalid release times retain the one-minute retry; manual Recheck saved
still explicitly requests a refresh. Automatic saved lookup and independent-ID
fallback also respect known future releases. No background timers or API polling.

This supersedes the early one-minute checks for known releases in v0.3.3/v0.3.4.
It saves requests but deliberately misses early discharges until the cached time.
Existing inactivity settings (including the owner's 20 days), FF/stat limits,
keys and 1,000-profile caches are preserved. Updated regressions and five new tests
cover no early checks, expired timers, re-hospitalization and saved replacement
timers, independent fallback, and missing Hospital/Jail timers. Actual provider
response times and device behavior remain separate from mocked tests.

v0.3.4 doubles the candidate pool, saved matching library and shortlist limits to
1,000 each on PDA and desktop. These collections overlap; this is not a promise
of 3,000 distinct players. Existing caches, keys and history survive the update.
The working pool still rolls over oldest entries at capacity; the saved library
keeps its first 1,000 matches and continues updating them. Opened history stays
at 2,000 and per-tap request budgets are unchanged.

For quicker reuse, proven current-filter matches last seen Okay or past their
reported hospital/jail release are checked before early hospital rechecks, highest
FF first within each tier by default. Due early rechecks remain ahead of unverified
profiles when the likely-available group runs out. This can skip wasted calls but
never treats a cached status or expired timer as proof: fresh Okay and all existing
FF/stat/profile limits are required. Checks remain foreground/on-tap only, with
unchanged API pacing. Five new regressions cover 1,000-entry persistence/caps on
PDA/GM, request-count improvements, and freshly hospitalized cached candidates.

v0.3.3 speeds the automatic pool's cached path and revisits hospital targets sooner.
Candidates with previously checked matching profile/strength evidence are tried
before unverified profiles, using the selected order (highest FF by default) within
each tier. Every chosen target still needs a fresh Torn status check. A cached
recent action that cannot yet meet the inactivity threshold skips a futile request;
filter changes reevaluate that evidence immediately. No FF/stat bound is relaxed.

Hospital/jail entries become due at their reported release or 60 seconds after the
last check, whichever comes first. This deadline also applies to previously stored
five-minute waits without clearing data. Checks occur on a foreground HF tap, not
through unattended polling. If a stay was observed after opening a target and its
reported release has passed, HF may recheck before the usual two-minute opened hold.
It still must receive Okay and matching profile evidence; an extended stay remains
excluded. Opening again restores the normal duplicate-open hold.

99 targeted tests cover cached-first request counts on PDA/GM, old wait deadlines,
early releases, extended stays, short post-open stays, current inactivity filters,
and cancellation of cached checks. Request spacing, rate-limit handling and API
permissions are unchanged. Real response times and release behavior need operator
validation separately from deterministic fixtures.

v0.3.2 fixes the desktop report of Torn returning its retired-endpoint error.
HF's single manual attack navigation now uses `page.php?sid=attack&user2ID=...`
instead of `loader.php`. FFScouter's published target finder uses this same route.
All navigation fixtures now assert the current path, including a trusted HF tap
from an already-open retired-loader error page. The browser fixture intercepts
navigation generically and validates the real generated URL. No automatic redirect,
combat interaction, filter changes or storage reset. 91 targeted regressions cover
PDA/GM behavior; an authenticated live desktop attack-page load remains an operator
check, not something proven by mocked navigation.

v0.3.1 corrects the owner's reported 1.01 FF selection with a configured minimum
of 2. New installs default to FF 2-3 and Use my FF range. Existing installs receive
a one-time switch to enforced FF bounds and highest-FF-first ordering, preserving
the exact numerical limits, keys, profile filters, cache and history. Old FF sample
cursors restart at the configured maximum so a depleted low-FF window cannot hide
new qualifying candidates. Subsequent deliberate preference changes persist.

The former Halloween: allow lower FF option is now explicitly labeled Allow below
minimum FF and is never enabled automatically. Low-FF cached, saved, provider and
independent-discovery candidates cannot bypass the enforced minimum. If the bounded
search finds no match, HF reports zero instead of silently relaxing the range. This
supersedes the automatic minimum relaxation described in older release notes below.
Maximum FF/stat limits, fresh availability checks and foreground-only actions stay
unchanged. 89 targeted tests include the exact reported upgrade settings, cached
ordering, depleted sample cursors, no-match behavior and one-time migration.

v0.3.0 puts the candidate-pool workflow behind the existing HF button. No results
page or Start finder step: each trusted foreground tap checks candidates in the
selected order (highest FF by default) and opens the first available match within
all configured limits. The three main settings remain unchanged. Existing installs
upgrade to Automatic cached pool, preserving filters, keys, saved targets and ID
bounds. Explicit Torn-only and legacy FF sampling remain optional advanced modes.

The pool saves up to 500 candidates locally, including unverified and hospitalized
profiles. FFScouter supplies batches of up to 50 with known stats/FF; successive
samples lower maxFF below the previous lowest score. This is bounded sampling,
not exhaustive pagination; same-score ties may be missed. Candidate estimates
avoid separate FF lookups. Status comes from a fresh Torn profile check, reused
for at most five seconds within the same tap. BSP still uses its separate key and
is checked where it can affect qualification. Unknown strength cannot qualify.

Hospital/jail profiles wait until the reported release time or five minutes,
whichever is sooner; other rejections wait one minute. These timers only skip
requests, never prove availability. Opened targets can be rechecked after two
minutes, and require a fresh matching profile before reuse. Opened still means
visited, not attacked or defeated. This automatic reuse applies to the new pool;
the older explicit modes retain manual saved-target rechecks.

One tap checks at most 90 pool profiles, then supplements with up to nine new
independent IDs and one final fresh status check. At most 20 FF batches are fetched
per pass, with one-second spacing between new batches. A completed FF sample may
restart after 15 minutes on a later tap. Progress persists; the working HF button
can cancel. No background polling, automatic navigation, new start control or
status sharing with another service. Existing Torn/BSP pacing and provider
throttles remain. First-time/all-hospital searches may still take time. Estimates
and a fresh Okay response cannot guarantee a win or availability after navigation.

Validation: 84 Halloween regression tests pass, covering PDA/GM pool reuse,
hospital expiry, safe reopened targets, hard limits, separate BSP, FF windows,
independent fallback, cancellation, errors, migration and bounded requests. Browser
fixtures check mobile/desktop and the one-tap pool across reloads. These checks use
fictional data; actual PDA/provider behavior still needs live validation.

v0.2.9 simplifies the profile panel to maximum estimated stats, minimum inactivity
and faction, with Save settings and Find target actions. Find target saves and
validates current edits before searching, and becomes Stop search while running.
The main panel shows a short summary of all active stat/FF limits. Existing hidden
settings, keys and saved targets are preserved; no difficulty thresholds change.
Advanced filters, batch/search recovery controls, ready/saved lists and provider
data-use tables are collapsed. API connections remain separate and accessible;
provider consent and storage behavior are unchanged.

v0.2.8 follows the owner's Halloween priority: find an available target within
their difficulty limits instead of insisting on a minimum fair-fight reward.
The default Target priority is **Halloween: allow lower FF**; Strict FF range
restores the configured minimum. Maximum FF, both selected-source stat bounds,
known FF/stats, inactivity, faction and Okay status remain mandatory. Existing
filter values are retained on upgrade; only the minimum FF requirement becomes
optional in Halloween mode. Estimates cannot guarantee a win.

When a final fresh check rejects a queued target, HF checks the next queued entry
during the same tap, up to ten distinct entries. One qualifying target opens at
most; API errors, throttles, cancellation and blur stop the run. No combat actions
are triggered. This replaces the older stop-on-first-unavailable queue behavior.

v0.2.7 avoids repeat requests for saved profiles rejected within the last minute
during automatic HF lookup. Current filters are reevaluated, manual saved rechecks
can bypass the minute, and deferred backend-error IDs require manual retry/recheck.
This negative cache only skips requests; a cached status never authorizes navigation.
Discovery also skips BSP when missing/out-of-range fair fight, an FF-only stat
rejection, or an already excessive FF estimate under Higher makes a match impossible.
BSP is still requested when it could change qualification. Provider estimates are
not refreshed by status rechecks. No change to API pacing or availability safeguards.

v0.2.6 removes the floating popup entirely, including errors and pauses. The 30px
HF button shows its progress count (S for saved-target checks), ellipsis during a
check, 0 for no match, ! for errors, WAIT for an API pause, and II when stopped.
Tap the working HF button to stop; no second search/navigation starts from that
tap. Detailed action messages are retained locally for HF Settings after navigation.

HF now stops discovery at the first qualifying target instead of finishing a
ten-profile batch. Existing ready targets retain the selected sorting. For a larger
sorted queue, use Find / check more. When the queue is empty, HF first checks up to
ten stat-compatible saved targets that have not been opened, stopping at the first
available match before scanning new IDs. Previously opened targets still require
the deliberate Recheck saved targets control to become eligible again.

A saved-target check made during this HF tap is reused for up to five seconds;
older results and all other paths require the final fresh availability check.
No estimate requests are needed for that saved fast path. Hidden result cards are
not rebuilt during discovery. Request spacing, filter requirements, error pauses,
rate-limit handling and foreground/cancellation safeguards are unchanged. Fixture
request counts confirm reduced work; real-device response time is not benchmarked.

v0.2.5 automatically saves up to 500 matching profiles in a separate device-local
library. Opened targets, search resets, shortlist clearing and filter changes do
not delete it. Existing shortlists with known matching estimates are imported on
upgrade; no keys or progress are reset. **Recheck saved targets** checks the next
ten saved profiles through Torn's API (fresh status requests), returning available
current-filter matches to HF even if previously opened. Rechecks never navigate;
HF still needs a separate tap and final status check. Estimates retain their cached
values and displayed dates. A failed or cancelled recheck leaves that target
unverified, not ready. The recheck position persists across reloads.

**Saved targets** shows the count, last known status/check time and last opened
time where known. Clear saved targets deletes the library separately from the
shortlist; Clear all local data and changing key owner also clear it. Clearing the
library does not prevent future matching discoveries being saved. The library is
local to this script installation/device, with no server or cross-device sync.
There is no scheduled/background polling; each batch requires a foreground tap.

Pause countdowns now preserve their cause: provider throttle/block versus HF's
own 60-second pause after three consecutive backend errors. Older stored pauses
show reason unavailable rather than claiming Torn rate-limited the user. This
changes the message, not request pacing, limits or pause duration.

v0.2.4 fixes two discovery bottlenecks: independent searches now continue past ten
profiles when none qualify, up to 100 profiles per foreground tap, and an isolated
Torn code 17 no longer traps subsequent searches on one ID. Those IDs are saved
separately (maximum 100) for **Retry failed IDs** under Search and history. They are
never treated as qualifying targets. Three consecutive code 17 profile responses
pause requests for 60 seconds; another tap is required afterward. Other errors and
rate limits still halt the run. Retry failed IDs checks up to ten saved IDs without
navigation. Restart ID search also resets that queue. Existing saved data migrates
without clearing keys, filters or progress.

Search remains independent of FFScouter's target lists in Torn ID mode, but needs
known provider estimates and a known FFScouter fair-fight value to qualify. Filters
are not relaxed. Extended searches may take several minutes; Stop and leaving the
foreground still cancel them. A final HF check uses Torn's documented timestamp
cache bypass before opening a target; a failed final check never opens it. The HF
dock is now 30px square at 37% viewport height, with its message moved alongside it.
Regression and browser fixtures cannot prove live provider availability or matches.

v0.2.3 follows the owner's live reports: HF now fills an empty shortlist with one
bounded search batch, then rechecks and opens at most one qualifying target from
that batch. Search failures and zero matches never open the settings panel; only
the separate HF Settings button opens it. Zero-match messages explain exclusions
such as status, inactivity, faction, missing estimates or ranges. Another batch
requires another tap. That version used a Stop search toast; v0.2.6 replaces it
with a second tap on the working HF button.

Both key sections show Not connected / Connected for this page only / Connected
and saved on this device. Saved checkboxes restore on reload, while password fields
remain blank for replacement. Save key on device (and its BSP counterpart) saves
an already connected key without re-entry or network calls. Writes are read back
before success is claimed, and setup/storage errors appear next to the relevant
key input. Remember remains opt-in; a checked box takes effect when connecting.

v0.2.2 fixes PDA import mojibake by distributing ASCII-only JavaScript with
Unicode escapes for punctuation. The profile button is now compact **HF Settings**
with an accessible Halloween Settings label, matching the adjacent BSP control's
scale. Storage keys and scouting behavior are unchanged. A regression executes the
script after Latin-1 decoding to reproduce the reported import path.

## Torn rules review — October 25, 2026

Reviewed the actual request/navigation paths against [Torn's scripting rule](https://www.torn.com/rules.php),
the [January 2026 administrator clarification](https://www.torn.com/forums.php?p=threads&t=16534470),
and [API usage/disclosure requirements](https://www.torn.com/api.html).
Discovery reads only APIs. The profile DOM observer mounts UI; it does not collect
player data, observe WebSockets, poll game pages or generate background alerts.
The sole game-page navigation follows one trusted foreground HF tap and one API
status check. No attack control, CAPTCHA, item, energy or gameplay action is called.
Requests stop on blur/cancellation; invalid keys and rate limits halt access.

v0.2.1 adds the five API disclosure categories beside **each** key input, including
provider use/retention limits, key access levels and the distinction between local
Forget and provider revocation. Each opt-in links the provider's published usage
terms. BSP's published setup describes key use, but does not establish a retention
period or confirm this third-party adapter's compatibility. This is a code review
against published rules, not Torn staff certification or a guarantee about provider
implementations. Do not describe it as officially approved.

## Controls and setup

Install the `.user.js` file in Torn PDA (document-end injection) or a desktop
userscript manager supporting `GM_xmlhttpRequest`, `GM_getValue`, `GM_setValue`.
**Halloween Settings** appears in your own profile header and opens inline,
matching the owner's BSP reference. Before the owner is known, profile pages
offer setup. Other pages have only the small right-edge **HF** target button.

1. In **Key and data use**, enter your Torn / FFScouter key. Read the linked terms
   and data policy and check the consent box. **Connect key** validates the Torn
   owner, checks FFScouter registration and registers only if necessary. Required
   FFScouter permissions are Limited/Full, or custom `basic,battlestats,attacks,hof`;
   include `profile` for this script. A policy update must be accepted on the
   provider's site; bans and denied permissions stop setup. No bypass/retry.
2. Optionally expand **BSP connection** and enter your **separate BSP primary key**,
   accepting its separate disclosure. Connect verifies the same Torn owner and an
   active subscription. It never reads or changes the installed BSP script's keys.
3. Set min/max estimated total stats (numbers or `k/m/b/t`), minimum inactive days
   (365 by default), faction (either/none/has faction), FF range, and ordering.
   Highest FF first is default. **Stat range uses** chooses FFScouter, BSP, or the
   higher available estimate. Both estimates and dates are shown separately.
4. **Apply filters**, then **Find / check more**. Independent discovery checks ten
   profiles initially and continues up to 100 if none qualify. FF sample mode
   checks up to ten profiles per tap.
   All candidates must have Torn status **Okay**: hospital, jail, travelling,
   abroad and unknown status are excluded. Exact inactivity and faction evidence
   must also match before independent discovery requests estimates.
5. **HF** uses the sorted ready queue, then suitable saved unopened profiles, then
   discovery until its first match. It checks availability, records the target as
   opened locally and opens its native attack page. The user performs every combat action. If it no
   longer qualifies, nothing opens; the next target requires another HF tap.
   Status can change after Torn returns a response.

Remembering either key is optional and separate. Keys use PDA/private userscript
storage; otherwise reconnect after navigation. Reconnecting the same account
preserves the shortlist. Changing the scouting account clears candidates, history
and the BSP connection. **Forget** erases the corresponding key, retaining cached
estimates. Opened means visited, not attacked or defeated.

## Independent discovery and repeat avoidance

Default **Torn ID search** does not call FFScouter's target-list endpoint. It walks
the chosen player ID range from a randomized starting position, wrapping once.
The saved cursor prevents repeated profile checks during that pass, including
after reload, filter changes and **Clear shortlist**. Invalid/nonexistent IDs
consume a position. Code 17 profiles move to the manual-retry list and advance
discovery; other failed/cancelled profile requests do not. Estimate failures
retain the pending candidate and successful first-provider result for a later
manual continuation.

Default range is ID 1 through the validated owner's ID, favoring older accounts.
This is not a claim to cover all Torn accounts: ID does not prove inactivity and
some IDs do not exist. Set explicit first/last IDs for a different range, then
use **Restart ID search**. Restart intentionally permits previously checked IDs;
opened IDs remain excluded until **Clear opened history**. There is no automatic
loop, background scanning or automatic relaxation of filters. Sparse matches can
take many manual batches. Filter changes do not revisit earlier rejects unless
the operator explicitly restarts the ID pass.

Optional **FF samples** keeps the original capped search: one level band of up to
50 candidates per tap, ten bands (91–100 down to 1–10), and up to ten profile
checks. FFScouter has no documented pagination or exact day/stat-range filters
for this endpoint. Repeating this mode can return the same samples.

Shortlist storage is bounded to 1,000 rows, pending to 50, opened history to 2,000.
At capacity the script stops and offers explicit clearing. Clear shortlist resets
the optional FF sample pass but retains independent ID progress. Unknown or
missing FF/required stats exclude a candidate; unknown never becomes zero.

## Provider contracts and limits

Checked October 25, 2026 against:

- [FFScouter OpenAPI](https://ffscouter.com/openapi) and
  [API reference](https://ffscouter.com/api-docs): `check-key`, consented POST
  `register`, `get-stats` by known target ID, optional `get-targets` samples.
- [BSP author's published client](https://github.com/tdup-torn/userscripts/blob/master/battle_stats_predictor.user.js)
  and [BSP service discussion](https://www.torn.com/forums.php?p=threads&t=16290324).
  The experimental adapter uses `www.lol-manager.com/api/battlestats/user/{key}/{version}`
  for subscription validation and `battlestats/{key}/{id}/{version}` for predictions.
  It sends this script's own version, not the official BSP client's version.
  Compatibility with third-party clients is **not confirmed**. No upload endpoint
  is called. Result 1/5/6 numeric totals are usable estimates; too weak/strong and
  failure/model errors are unknown, not invented exact totals. Dates without a
  timezone are treated as UTC as in BSP's client.
- [Torn API](https://www.torn.com/api.html): `user/profile` for identity, inactivity,
  faction and status. No HTML scraping or bulk player-search API is assumed.
- [Torn PDA bridge](https://github.com/Manuito83/torn-pda/blob/master/userscripts/TornPDA_API.js):
  GET and JSON POST, with desktop GM equivalents.

FF is supplied by FFScouter and relative to its key owner. BSP independently
supplies estimated total stats. This version does not derive FF from BSP or total
stats; missing FF remains excluded even with a BSP prediction. Higher estimate
uses the larger known total for the stat-range filter; one unknown provider does
not erase the other's known estimate. Selecting BSP specifically requires a BSP
connection for new searches. Connecting BSP affects new candidates; clear the
shortlist/restart explicitly to revisit earlier rows. Estimates show dates and
are not a win guarantee. No real provider access is proven by fixture tests.

## Request and storage behavior

All requests require a deliberate foreground action. Torn profile and BSP requests
are paced at 1.5 seconds within each serial run. Other tabs/tools and BSP's own
backend Torn usage share limits; this script is not an account-wide limiter.
429/provider throttles impose a persisted pause of at least 60 seconds, respecting
advertised waits up to an hour. No automatic retries. Each request times out after
20 seconds; Stop, blur and backgrounding cancel the logical run. Failed profile IDs
may be deferred so discovery can check other IDs; they are retried only through the
explicit Retry failed IDs control. GM requests abort
where supported; PDA may finish its current request, but late results are ignored.

Keys are separate from nonsecret target state and never fall back to Torn
localStorage. The scouting key goes only to Torn and FFScouter; the BSP key goes
only to Torn for owner validation and BSP for its subscription/predictions.
Provider storage is governed by their policies. No keys are sent to our Workers,
shared faction storage or Discord. Error text and echoed request parameters are
not displayed or persisted. There are no combat requests, automatic clicks,
attack uploads, unattended navigation or background discovery.

## Validation and remaining live check

`tests/halloween-targets.test.js` covers PDA/GM transports, inline registration and
consent, provider separation, subscription/owner failures, independent continuation,
profile prefilters, missing evidence, source selection, cached failure recovery,
HF rechecks, cancellation, timeouts, throttles, storage and canonical/public parity.
Local browser fixtures exercise 390px mobile and desktop profile layout with both
connections and one intercepted target navigation. They never contact real services.

Before calling this released/live-verified, install in real Torn PDA, connect both
keys in your own profile, run one small discovery batch, verify source estimates
and inactivity/faction/status, then tap HF once to check the destination. No attack
is required. Check coexistence with the existing FF overlay. BSP version acceptance,
subscription responses, actual FF registration and iOS PDA behavior need this live
check. Publishing the Hub asset requires an intentional Hub deployment; green CI
alone does not make the download URL live.
