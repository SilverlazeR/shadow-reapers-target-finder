// ==UserScript==
// @name         Shadow Reapers Target Finder
// @namespace    https://shadowreapersfaction.com
// @version      0.5.3
// @downloadURL  https://raw.githubusercontent.com/SilverlazeR/shadow-reapers-target-finder/main/shadow-reapers-target-finder.user.js
// @updateURL    https://raw.githubusercontent.com/SilverlazeR/shadow-reapers-target-finder/main/shadow-reapers-target-finder.user.js
// @description  Tap TF to open your next matching target; estimated stats, inactivity, faction and fair-fight filters.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      ffscouter.com
// @connect      api.torn.com
// @connect      shadowreapersfaction.com
// ==/UserScript==

// Keep this download ASCII-only; use Unicode escapes in UI strings for PDA imports.
// Read-only API scouting. The TF tap opens one native attack page; it never
// clicks attack controls. The scouting key is entered with consent.
(function () {
  'use strict';
  // Renamed from Halloween Targets. The guard and storage names keep their
  // original spelling so upgrades retain data and side-by-side installs run once.
  if (window.top !== window.self || window.__srHalloweenTargets) return;
  window.__srHalloweenTargets = true;
  const STORE = 'sr_halloween_targets_v1', KEY = 'sr_halloween_key_v1', DAY = 86400;
  const LEGACY_BSP_KEY = 'sr_halloween_bsp_key_v1';
  const SEARCH_BUDGET = 'sr_halloween_search_budget_v1';
  const LOG_STORE = 'sr_halloween_logs_v1', LOG_LIMIT = 100;
  const LOG_UPLOAD = 'https://shadowreapersfaction.com/api/public/script-logs';
  let logs = [], logPanel, logText, logHint, logIdentity, logSending = false, logStorageError = false, logWriting = false, pendingLogSnapshot = null;
  let logEpoch = 0;
  let activeTrace = null;
  const TRACE_COUNTS = ['tornRequests', 'ffRequests', 'networkMs', 'pacingMs', 'cachedChecks', 'newCandidateChecks', 'newIDChecks',
    'providerCandidates', 'poolAtStart', 'eligibleAtStart', 'hospitalTimersSkipped', 'estimateCacheHits',
    'unknownStrengthAtStart', 'outsideStatsAtStart', 'outsideFFAtStart', 'recentActivityAtStart', 'deferredAtStart', 'skippedStatusAtStart',
    'rejectedStatus', 'rejectedActivity', 'rejectedFaction', 'rejectedUnknown', 'rejectedStats', 'rejectedFF', 'missingProfiles',
    'rejectedHospital', 'rejectedJail', 'rejectedFederal', 'rejectedTravel', 'rejectedFallen', 'estimateRefreshes', 'storageWrites', 'storageMs', 'earlyBatches', 'contestedAtStart', 'tapLimitReached'];
  const STATUS_COUNTERS = { Hospital: 'rejectedHospital', Jail: 'rejectedJail', Federal: 'rejectedFederal', Traveling: 'rejectedTravel', Abroad: 'rejectedTravel', Fallen: 'rejectedFallen' };
  function countTrace(field, amount = 1, trace = activeTrace) {
    if (trace && !trace.ended && TRACE_COUNTS.includes(field)) trace.counts[field] = (trace.counts[field] || 0) + amount;
  }
  function finishTrace(trace, result) {
    if (!trace || trace.ended) return;
    trace.ended = true;
    logEvent('summary', { action: trace.action, result, ms: Math.max(0, Date.now() - trace.at), counts: trace.counts });
  }
  const CACHE_LIMIT = 1000;
  // At most 48 TF profile checks a minute, leaving 52 of Torn's shared 100 for other tools.
  const TORN_GAP = 1250, ESTIMATE_TTL = 7 * DAY, VERSION = '0.5.3', MISS_REFRESH = 3, TAP_CHECKS = 20, DEFER_SECONDS = 3600;
  const DEFAULTS = { minStats: '', maxStats: '', days: '365', faction: 'any', minFF: '2', maxFF: '3', ffPriority: 'strict', discovery: 'auto', minID: '1', maxID: '', sort: 'available',
    skipFederal: '1', skipTravel: '1', skipFallen: '1' };
  const SKIP_KEYS = ['skipFederal', 'skipTravel', 'skipFallen'];
  const LEGACY_REASONS = { 'HF pause after Torn backend errors': 'TF pause after Torn backend errors', 'HF target-list budget': 'TF target-list budget' };
  let state = emptyState(), apiKey = '', busy = false, generation = 0, cancelRequest = null;
  let keySaved = false, keyStatus;
  let keyError = '', ffKeyRejects = 0;
  const KEY_HOLDS = { 10: 'Torn will not accept this key while its owner is in federal jail', 13: 'Torn disabled this key because its owner has been inactive',
    16: 'This key\u2019s access level is too low; use a custom key with the listed selections', 18: 'This key is paused in Torn; unpause it under Settings, API Keys' };
  let searchReasons = {}, backendErrors = 0;
  let buttonBadge = '', progressLabel = '...';
  let root, host, dock, panel, notice, summary, limits, list, savedList, savedSummary, keyInput, remember, consent, findButton, searchButton, targetButton, settingsHost, fields = {};
  const active = () => !document.hidden && document.hasFocus();
  const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const positiveID = value => Number.isSafeInteger(value) && value > 0;
  const now = () => Math.floor(Date.now() / 1000);
  function emptyState() {
    return { version: 1, ffOrderVersion: 1, availableOrderVersion: 1, poolVersion: 1, pool: [], poolMaxFF: null, poolExhausted: false, poolFetched: 0, config: { ...DEFAULTS }, owner: null, ownerName: '', rows: [], pending: [], used: [], saved: [], savedCursor: 0, lastMessage: '', deferred: [], deferredUntil: {}, scan: null, band: 0, scanned: 0, checked: 0, cooldown: 0, cooldownReason: '', nextTorn: 0 };
  }
  function statInput(value, fallback) {
    const text = String(value).trim().replace(/,/g, '');
    if (!text) return fallback;
    const match = /^(\d+(?:\.\d+)?)([kmbt]?)$/i.exec(text);
    if (!match) throw Error('Use a number or k/m/b/t for battle stats, for example 50m.');
    const result = Number(match[1]) * ({ k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[match[2].toLowerCase()] || 1);
    if (!Number.isFinite(result) || result > Number.MAX_SAFE_INTEGER) throw Error('Battle stat limit is too large.');
    return result;
  }
  function filters(config) {
    const min = statInput(config.minStats, 0), max = statInput(config.maxStats, Infinity);
    const days = Number(config.days), minFF = Number(config.minFF), maxFF = Number(config.maxFF);
    if (min > max) throw Error('Minimum battle stats must not exceed the maximum.');
    if (!String(config.days).trim() || !Number.isInteger(days) || days < 0 || days > 20000) throw Error('Inactive days must be a whole number from 0 to 20,000.');
    if (!Number.isFinite(minFF) || !Number.isFinite(maxFF) || minFF < 1 || maxFF < minFF || maxFF > 1000) throw Error('Use a fair-fight range from 1 upward, with maximum at least minimum (up to 1,000).');
    if (!['any', 'none', 'yes'].includes(config.faction) || !['available', 'ff-desc', 'ff-asc', 'inactive', 'stats'].includes(config.sort)) throw Error('Invalid filter choice.');
    if (!['auto', 'torn', 'ff'].includes(config.discovery)) throw Error('Invalid source choice.');
    if (!['available', 'strict'].includes(config.ffPriority)) throw Error('Invalid target priority.');
    if (!SKIP_KEYS.every(k => ['0', '1'].includes(String(config[k])))) throw Error('Invalid skip choice.');
    const minID = Number(config.minID), maxID = config.maxID.trim() ? Number(config.maxID) : null;
    if (!positiveID(minID) || minID > 100000000 || maxID !== null && (!positiveID(maxID) || maxID > 100000000 || maxID < minID)) throw Error('Use whole player IDs from 1 to 100,000,000, maximum at least minimum.');
    // Below-minimum FF is an explicit override, never the default. Maximum
    // difficulty, stat bounds and known-evidence requirements remain mandatory.
    return { min, max, days, minFF: config.ffPriority === 'available' ? 1 : minFF, maxFF, faction: config.faction, sort: config.sort, minID, maxID,
      skipFederal: config.skipFederal === '1', skipTravel: config.skipTravel === '1', skipFallen: config.skipFallen === '1' };
  }
  // Long-lived statuses chosen in settings are not rechecked until this time.
  // Computed from the last check, so unticking a box takes effect immediately.
  // A skip only delays a check; it never makes anyone a match.
  function skippedUntil(row, f) {
    if (numeric(row.checkedAt) === null || row.checkedAt <= 0 || row.checkedAt > now()) return 0;
    if (row.status === 'Federal' && f.skipFederal) return numeric(row.statusUntil) !== null && row.statusUntil > row.checkedAt ? row.statusUntil : row.checkedAt + 7 * DAY;
    if (row.status === 'Fallen' && f.skipFallen) return Infinity;
    if (['Traveling', 'Abroad'].includes(row.status) && f.skipTravel) return row.checkedAt + 900;
    return 0;
  }
  function candidate(raw) {
    if (!raw || !positiveID(raw.player_id)) return null;
    const stats = numeric(raw.bs_estimate), ff = numeric(raw.fair_fight);
    if (stats === null || stats < 0 || ff === null || ff < 1) return null;
    return { id: raw.player_id, name: String(raw.name || raw.player_id).slice(0, 80), stats, ff,
      estimatedAt: numeric(raw.bss_public_timestamp), fetchedAt: now(), lastAction: null,
      faction: null, factionName: '', status: 'Unverified', checkedAt: null };
  }
  function profile(row, data) {
    if (!data || data.player_id !== row.id) throw Error('Torn returned a different or missing player ID.');
    const lastAction = numeric(data.last_action?.timestamp), faction = numeric(data.faction?.faction_id);
    const status = String(data.status?.state || 'Unknown').slice(0, 40);
    // Recent check history: how often this player was already hospitalised when
    // checked. Halved past 20 checks so it follows current competition.
    let checks = count(row.checks) + 1, hospitalHits = count(row.hospitalHits) + (status === 'Hospital' ? 1 : 0);
    if (checks > 20) { checks = Math.ceil(checks / 2); hospitalHits = Math.min(checks, Math.ceil(hospitalHits / 2)); }
    return { ...row, name: String(data.name || row.name).slice(0, 80),
      lastAction: lastAction !== null && lastAction > 0 && lastAction <= now() ? lastAction : null,
      faction: Number.isSafeInteger(faction) && faction >= 0 ? faction : null,
      factionName: String(data.faction?.faction_name || '').slice(0, 80),
      status, checkedAt: now(), checks, hospitalHits, okayAt: status === 'Okay' ? now() : numeric(row.okayAt),
      statusUntil: numeric(data.status?.until) !== null && data.status.until > now() ? data.status.until : null };
  }
  const count = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
  // Unchecked players are neutral; players usually found hospitalised rank lower.
  const contestRate = row => count(row.checks) ? Math.min(1, count(row.hospitalHits) / count(row.checks)) : 0.5;
  const contested = row => count(row.checks) >= 3 && contestRate(row) >= 0.75;
  // Opened by TF after its last Okay sighting with no check since: probably just
  // attacked by this player, so it is checked only after everyone else. A later
  // check (for example a hospital stay with a timer) restores normal ranking.
  const openedSinceOkay = row => numeric(row.lastOpened) !== null && row.lastOpened >= (numeric(row.okayAt) ?? 0) &&
    !(numeric(row.checkedAt) !== null && row.checkedAt > row.lastOpened);
  // Most likely available: seen Okay in the last 10 minutes, then candidates
  // never checked here, then everyone else, then targets TF recently opened.
  const demoted = row => contested(row) || openedSinceOkay(row);
  function availabilityTier(row) {
    if (openedSinceOkay(row)) return 3;
    if (numeric(row.okayAt) !== null && row.okayAt <= now() && now() - row.okayAt <= 600) return 0;
    return count(row.checks) ? 2 : 1;
  }
  function selectedStats(row) { return numeric(row.stats); }
  function statMatch(row, f) { const stats = selectedStats(row, f); return stats !== null && stats >= f.min && stats <= f.max && numeric(row.ff) !== null && row.ff >= f.minFF && row.ff <= f.maxFF; }
  function profileMatch(row, f, at = now()) {
    return row.lastAction !== null && row.lastAction <= at && at - row.lastAction >= f.days * DAY &&
      row.faction !== null && (f.faction === 'any' || (f.faction === 'none' ? row.faction === 0 : row.faction > 0)) && row.status === 'Okay';
  }
  function matches(row, f, at = now()) { return statMatch(row, f) && profileMatch(row, f, at); }
  function searchOutcome(row, f, profileOnly = false) {
    let reason = '';
    if (!row) reason = 'ID unavailable';
    else if (row.status !== 'Okay') reason = 'not Okay';
    else if (row.lastAction === null) reason = 'inactivity unknown';
    else if (now() - row.lastAction < f.days * DAY) reason = 'under ' + f.days + ' inactive days';
    else if (row.faction === null) reason = 'faction unknown';
    else if (f.faction === 'none' && row.faction !== 0 || f.faction === 'yes' && row.faction === 0) reason = 'faction filter';
    else if (!profileOnly) {
      const stats = selectedStats(row, f);
      if (numeric(row.ff) === null) reason = 'FF estimate missing';
      else if (stats === null) reason = 'stat estimate missing';
      else if (stats < f.min || stats > f.max) reason = 'outside stat range';
      else if (row.ff < f.minFF || row.ff > f.maxFF) reason = 'outside FF range';
    }
    if (reason) {
      searchReasons[reason] = (searchReasons[reason] || 0) + 1;
      const counter = reason === 'ID unavailable' ? 'missingProfiles' : reason === 'not Okay' ? STATUS_COUNTERS[row.status] || 'rejectedStatus'
        : reason.startsWith('under ') ? 'rejectedActivity' : reason === 'faction filter' ? 'rejectedFaction'
        : reason === 'outside stat range' ? 'rejectedStats' : reason === 'outside FF range' ? 'rejectedFF' : 'rejectedUnknown';
      countTrace(counter);
    }
  }
  function searchDetails() {
    const reasons = Object.entries(searchReasons).map(([reason, count]) => count + ' ' + reason);
    return reasons.length ? 'This search: ' + reasons.join('; ') + '. ' : '';
  }
  function sorted(rows, f) {
    return [...rows].sort((a, b) => {
      if (f.sort === 'available') {
        const delta = availabilityTier(a) - availabilityTier(b) || Math.round(contestRate(a) * 4) - Math.round(contestRate(b) * 4) ||
          (numeric(b.okayAt) ?? 0) - (numeric(a.okayAt) ?? 0) || b.ff - a.ff;
        return delta || a.id - b.id;
      }
      // Other orders keep their key but list contested or just-opened players last.
      const delta = f.sort === 'ff-asc' ? a.ff - b.ff : f.sort === 'inactive' ? a.lastAction - b.lastAction : f.sort === 'stats' ? selectedStats(a, f) - selectedStats(b, f) : b.ff - a.ff;
      return demoted(a) - demoted(b) || delta || a.lastAction - b.lastAction || a.id - b.id;
    });
  }
  function ready() {
    const f = filters(state.config), used = new Set(state.used);
    return sorted(state.rows.filter(row => !used.has(row.id) && matches(row, f)), f);
  }
  function rememberTarget(row) {
    const index = state.saved.findIndex(item => item.id === row.id);
    if (index >= 0) state.saved[index] = { ...state.saved[index], ...row };
    else if (state.saved.length < CACHE_LIMIT && matches(row, filters(state.config))) state.saved.push({ ...row });
  }
  // A Torn backend error (code 17) sets a player aside for an hour, then they
  // return to normal checks. Retry failed IDs still rechecks them sooner.
  function isDeferred(id) { return state.deferred.includes(id) && (state.deferredUntil[id] ?? 0) > now(); }
  function deferID(id) {
    pruneDeferred();
    if (!state.deferred.includes(id)) {
      if (state.deferred.length >= 100) { delete state.deferredUntil[state.deferred[0]]; state.deferred.shift(); }
      state.deferred.push(id);
    }
    state.deferredUntil[id] = now() + DEFER_SECONDS;
  }
  function undefer(id) { state.deferred = state.deferred.filter(item => item !== id); delete state.deferredUntil[id]; }
  function pruneDeferred() {
    for (const id of state.deferred.filter(item => !isDeferred(item))) undefer(id);
  }
  function cachedRelease(row) {
    return ['Hospital', 'Jail'].includes(row.status) && numeric(row.checkedAt) !== null &&
      row.checkedAt > 0 && row.checkedAt <= now() && numeric(row.statusUntil) !== null &&
      row.statusUntil > row.checkedAt ? row.statusUntil : null;
  }
  function quickSavedCandidate(row, f) {
    if ((cachedRelease(row) ?? 0) > now() || skippedUntil(row, f) > now()) return false;
    if (state.used.includes(row.id) || isDeferred(row.id) || !statMatch(row, f)) return false;
    // Recently rejected snapshots can save a request, never authorize an attack.
    // Manual rechecks bypass this brief negative cache.
    return profileMatch(row, f) || numeric(row.checkedAt) === null || now() - row.checkedAt >= 60;
  }
  async function recheckSaved(run, quick = false) {
    requireKey(); searchReasons = {}; backendErrors = 0;
    if (!state.saved.length) { tell('No saved targets yet. Matching profiles are saved automatically when found.'); return; }
    const f = filters(state.config);
    const candidates = quick ? sorted(state.saved.filter(row => quickSavedCandidate(row, f)), f).slice(0, 10)
      : Array.from({ length: Math.min(10, state.saved.length) }, (_, i) => state.saved[(state.savedCursor + i) % state.saved.length]);
    const count = candidates.length;
    let restored = 0;
    for (let i = 0; i < count; i++) {
      ensure(run);
      const row = { ...candidates[i] }, index = state.saved.findIndex(item => item.id === row.id);
      countTrace('cachedChecks');
      if (state.rows.length >= CACHE_LIMIT && !state.rows.some(item => item.id === row.id)) throw Error('Clear shortlist first; saved targets are kept.');
      tell('Rechecking saved target ' + row.name + ' (' + (i + 1) + '/' + count + ')...');
      progressLabel = 'S' + (i + 1); paintButton();
      // A failed/paused recheck must not leave an old Okay snapshot in the queue.
      const unverified = { ...row, status: 'Unverified', checkedAt: null };
      rememberTarget(unverified);
      state.rows = state.rows.map(item => item.id === row.id ? unverified : item);
      await save(); ensure(run);
      const updated = await scoutProfile(row, run, true); ensure(run);
      const result = updated || { ...unverified, status: updated === null ? 'Unavailable' : 'Unverified' };
      rememberTarget(result);
      state.rows = state.rows.filter(item => item.id !== row.id);
      if (updated && matches(updated, f)) {
        state.rows.push(updated);
        state.used = state.used.filter(id => id !== row.id);
        restored++;
      } else if (updated !== undefined) searchOutcome(updated, f);
      if (!quick) state.savedCursor = (index + 1) % state.saved.length;
      if (updated !== undefined) state.checked++;
      await save(); render(); await checkBackendErrors();
      if (quick && updated && matches(updated, f)) return updated;
    }
    tell(restored + ' saved targets available and returned to the TF queue. ' + searchDetails() + 'Checked ' + count + '/' + state.saved.length + ' saved profiles; tap Recheck saved targets for the next batch. Estimates retain their displayed dates.');
  }
  function searchURL(key, config, band) {
    const f = filters(config), low = 91 - band * 10;
    if (!Number.isInteger(band) || band < 0 || band > 9) throw Error('Search pass finished. Reset the search to start another.');
    const url = new URL('https://ffscouter.com/api/v1/get-targets');
    url.search = new URLSearchParams({ key, limit: '50', minlevel: String(low), maxlevel: String(low + 9),
      inactiveonly: f.days >= 14 ? '1' : '0', minff: String(f.minFF), maxff: String(f.maxFF), factionless: f.faction === 'none' ? '1' : '0' }).toString();
    return url.href;
  }
  function profileURL(key, id = '', fresh = false) {
    const url = new URL('https://api.torn.com/user/' + id);
    url.search = new URLSearchParams({ selections: 'profile', key, comment: 'SRTargetFinder' }).toString();
    if (fresh) url.searchParams.set('timestamp', String(Date.now()));
    return url.href;
  }
  const hasPdaStorage = () => typeof PDA_storage !== 'undefined' && typeof PDA_storage.get === 'function' && typeof PDA_storage.set === 'function';
  const hasPrivateStorage = () => hasPdaStorage() || typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  async function readStorage(name) {
    if (hasPdaStorage()) return PDA_storage.get(name, '');
    if (typeof GM_getValue === 'function') return GM_getValue(name, '');
    if (name === KEY || name === LEGACY_BSP_KEY) return '';
    return localStorage.getItem(name) || '';
  }
  async function writeStorage(name, value) {
    if (hasPdaStorage()) return PDA_storage.set(name, value);
    if (typeof GM_setValue === 'function') return GM_setValue(name, value);
    if (name === KEY || name === LEGACY_BSP_KEY) { if (value) throw Error('This manager cannot remember keys securely. Leave Remember key unchecked.'); return; }
    localStorage.setItem(name, value);
  }
  async function save() {
    // Timed so logs show how much of a slow tap is spent writing to the device.
    const started = Date.now(), trace = activeTrace;
    try { await writeStorage(STORE, JSON.stringify(state)); }
    finally { countTrace('storageWrites', 1, trace); countTrace('storageMs', Date.now() - started, trace); }
  }
  // Diagnostics deliberately contain no free-form provider text, URLs, keys,
  // target IDs/names or profile data. Apply the same allowlist on storage reload.
  function cleanLog(entry) {
    if (!entry || !Number.isSafeInteger(entry.at) || entry.at < 0 || entry.at > 8640000000000000 ||
        !['request', 'wait', 'start', 'done', 'error', 'stop', 'open', 'summary'].includes(entry.kind)) return null;
    const clean = { at: entry.at, kind: entry.kind };
    if (LEGACY_REASONS[entry.reason]) entry = { ...entry, reason: LEGACY_REASONS[entry.reason] };
    for (const [field, values] of Object.entries({
      service: ['Torn', 'FFScouter'], operation: ['profile', 'get-targets', 'get-stats', 'check-key', 'register', 'other'],
      reason: ['Torn throttle/block', 'FFScouter throttle/block', 'TF pause after Torn backend errors', 'TF target-list budget', 'Saved pause (reason unavailable)'],
      outcome: ['pending', 'received', 'failed', 'cancelled', 'timeout', 'unreadable'],
      action: ['search', 'batch search', 'saved recheck', 'retry failed', 'settings', 'key connection', 'maintenance',
        'clear shortlist', 'restart ID search', 'clear opened history', 'clear saved targets', 'clear all local data', 'forget key'],
      result: ['opened', 'no match', 'completed', 'wait', 'error', 'cancelled'],
      category: ['credentials/consent', 'storage', 'response format', 'timeout', 'validation', 'operation'],
      detail: ERROR_DETAILS.map(([, detail]) => detail)
    })) if (values.includes(entry[field])) clean[field] = entry[field];
    for (const field of ['status', 'code', 'ms', 'until']) {
      if (Number.isSafeInteger(entry[field]) && entry[field] >= 0 && entry[field] <= 8640000000000000) clean[field] = entry[field];
    }
    if (entry.kind === 'summary') {
      clean.counts = {};
      for (const field of TRACE_COUNTS) if (Number.isSafeInteger(entry.counts?.[field]) && entry.counts[field] >= 0) clean.counts[field] = entry.counts[field];
    }
    return clean;
  }
  // Fixed labels for every thrown message, so a copied log says what failed
  // without recording free-form text. Order matters: first match wins.
  const ERROR_DETAILS = [
    [/^Paused/, 'paused'], [/100 failed IDs/, 'failed-ID list full'], [/Opened-target history is full/, 'opened history full'],
    [/ID range changed/, 'ID range changed'], [/ID range ends below/, 'ID range invalid'], [/Clear shortlist|Shortlist storage is full/, 'shortlist full'],
    [/code 17 for three/, 'Torn backend errors (3 in a row)'], [/could not check this target \(code 17\)/, 'target check failed (code 17)'],
    [/rejected the key|identify this key owner/, 'key rejected'], [/rate limit/, 'rate limited'], [/target-search budget/, 'target-list budget'],
    [/wait \d+ seconds, then tap again/, 'API pause active'], [/remember keys|Remember key requires|script storage to save keys/, 'key storage unavailable'],
    [/Unexpected FFScouter/, 'unexpected FFScouter data'], [/different or missing player ID/, 'wrong player returned'],
    [/timed out/, 'request timed out'], [/connection failed/, 'connection failed'], [/unreadable|unexpected response/, 'unreadable response'],
    [/request failed/, 'request failed'], [/connect your registered|Connect the key|Enter your 16-character|enable FFScouter access/, 'key not connected'],
    [/policy|registration/i, 'FFScouter registration'], [/search budget could not be read/, 'budget storage unreadable'],
    [/storage|save/i, 'storage'], [/Search pass/, 'search pass complete'], [/fair-fight|battle stat|Inactive days|player IDs|choice|priority/i, 'invalid settings'],
    [/./, 'other']
  ];
  const errorDetail = error => ERROR_DETAILS.find(([pattern]) => pattern.test(String(error?.message || '')))[1];
  function trimLogs(entries) {
    let summaries = 0, events = 0;
    return [...entries].reverse().filter(entry => entry.kind === 'summary' ? ++summaries <= 20 : ++events <= LOG_LIMIT).reverse();
  }
  function logEvent(kind, detail = {}) {
    const entry = cleanLog({ ...detail, at: Date.now(), kind });
    logs.push(entry); logs = trimLogs(logs); renderLogs(); return entry;
  }
  async function flushLogs() {
    pendingLogSnapshot = JSON.stringify(logs.map(cleanLog).filter(Boolean));
    // One in-flight write plus the latest pending snapshot. Slow storage cannot
    // grow an unbounded queue, and search/navigation never await diagnostics.
    if (logWriting) return;
    logWriting = true;
    try {
      while (pendingLogSnapshot !== null) {
        const snapshot = pendingLogSnapshot; pendingLogSnapshot = null;
        try { await writeStorage(LOG_STORE, snapshot); logStorageError = false; }
        catch { logStorageError = true; }
      }
    } finally { logWriting = false; renderLogs(); }
  }
  function tornName(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(value) ? value : ''; }
  // Sends only the visible report, and only on a deliberate tap. The key is
  // never included; the Torn name/ID are added only when the box is ticked.
  async function sendLogs(event) {
    if (!event.isTrusted || !active() || logSending) return;
    const report = logReport(); logText.value = report;
    const body = { script: 'target-finder', log: report, note: 'Sent from Target Finder v' + VERSION };
    if (logIdentity.checked && positiveID(state.owner)) body.sender = { id: state.owner, ...(state.ownerName ? { name: state.ownerName } : {}) };
    logSending = true; logHint.textContent = 'Sending to Shadow Reapers leadership...';
    try {
      const response = await new Promise((resolve, reject) => {
        const headers = { Accept: 'application/json', 'Content-Type': 'application/json' }, data = JSON.stringify(body);
        const timer = setTimeout(() => reject(Error('timeout')), 20000);
        const done = value => { clearTimeout(timer); resolve(value); }, fail = () => { clearTimeout(timer); reject(Error('failed')); };
        if (typeof PDA_httpPost === 'function') Promise.resolve(PDA_httpPost(LOG_UPLOAD, headers, data)).then(done, fail);
        else if (typeof GM_xmlhttpRequest === 'function') GM_xmlhttpRequest({ method: 'POST', url: LOG_UPLOAD, headers, data, anonymous: true, redirect: 'error', timeout: 20000, onload: done, onerror: fail, ontimeout: fail });
        else fail();
      });
      let reply = {};
      try { reply = JSON.parse(response.responseText); } catch {}
      if (Number(response.status) !== 201 || !positiveID(reply.id)) throw Error(typeof reply.error === 'string' ? reply.error.slice(0, 160) : 'failed');
      logHint.textContent = 'Sent as log #' + reply.id + '. Tell leadership that number in Discord.';
    } catch (error) {
      logHint.textContent = error.message === 'failed' || error.message === 'timeout'
        ? 'Could not send the log. Try again, or use Copy logs and paste it in Discord.' : 'Not sent: ' + error.message;
    } finally { logSending = false; }
  }
  // Search settings for diagnostics. Values are the user's own filters, never player data.
  function settingsLine() {
    const c = state.config, text = v => String(v || '').trim().replace(/[^0-9A-Za-z.,]/g, '').slice(0, 20);
    const skips = [['skipFederal', 'federal'], ['skipTravel', 'travel'], ['skipFallen', 'fallen']].filter(([k]) => c[k] === '1').map(([, label]) => label);
    return 'Settings: FF ' + text(c.minFF) + '-' + text(c.maxFF) + (c.ffPriority === 'available' ? ' (below minimum allowed)' : '') +
      '; stats ' + (text(c.minStats) || '0') + '-' + (text(c.maxStats) || 'any') + '; inactive ' + text(c.days) + '+ days; faction ' + text(c.faction) +
      '; order ' + text(c.sort) + '; source ' + text(c.discovery) + '; IDs ' + (text(c.minID) || '1') + '-' + (text(c.maxID) || 'any') +
      '; skip ' + (skips.join('/') || 'none') + '.';
  }
  function logReport() {
    const latestWait = [...logs].reverse().find(entry => entry.kind === 'wait');
    const until = Math.max(state.cooldown, latestWait?.until || 0);
    const reason = state.cooldown > Date.now() ? state.cooldownReason || 'Saved pause (reason unavailable)' : latestWait?.reason;
    const recent = logs.filter(entry => entry.kind === 'request' && entry.at > Date.now() - 60000);
    const wait = until > Date.now() ? (reason || 'API pause') + ': ' + Math.ceil((until - Date.now()) / 1000) + ' seconds remaining at report time.'
      : latestWait ? 'Last WAIT has expired. Tap TF to try again.' : 'No active recorded WAIT.';
    return ['TF v' + VERSION + ' diagnostics - ' + new Date(Date.now()).toISOString(), wait,
      'Recorded TF requests in last 60s: Torn ' + recent.filter(e => e.service === 'Torn').length + ', FFScouter ' + recent.filter(e => e.service === 'FFScouter').length + '.',
      'Cache: ' + state.pool.length + ' candidates; ' + state.saved.length + ' saved; ' + state.pool.filter(e => (cachedRelease(e) || 0) > now()).length + ' waiting for known hospital/jail release.',
      settingsLine(),
      'Latest 100 events plus 20 action summaries, newest first. Counts are TF only. Decision time excludes final diagnostic storage; pool counts are snapshots. Rejections count evaluated outcomes, not unique players. No keys, player identities or response bodies.',
      ...[...logs].reverse().map(e => new Date(e.at).toISOString() + ' | ' + e.kind +
        (e.service ? ' ' + e.service : '') + (e.operation ? ' ' + e.operation : '') +
        (e.outcome ? ' ' + e.outcome : '') + (e.status !== undefined ? ' HTTP ' + e.status : '') +
        (e.code !== undefined ? ' code ' + e.code : '') + (e.ms !== undefined ? ' ' + e.ms + 'ms' : '') +
        (e.reason ? ' ' + e.reason : '') + (e.until ? ' until ' + new Date(e.until).toISOString() : '') +
        (e.action ? ' ' + e.action : '') + (e.result ? ' ' + e.result : '') + (e.category ? ' ' + e.category : '') + (e.detail ? ': ' + e.detail : '') +
        (e.counts ? '\n  ' + Object.entries(e.counts).map(([k, v]) => k + '=' + v).join(', ') : ''))
    ].join('\n');
  }
  function renderLogs() {
    if (!logPanel || logPanel.hidden) return;
    logText.value = logReport();
    logHint.textContent = logStorageError ? 'Logs are visible for this page, but saving failed. Copy them before leaving.' : 'Saved locally. Copy this report when TF shows WAIT. Opening logs sends no requests.';
  }
  function showLogs(event) {
    if (!event.isTrusted || !active()) return;
    logPanel.hidden = !logPanel.hidden; renderLogs();
  }
  async function persistKey(name, value) {
    await writeStorage(name, value);
    if ((await readStorage(name)) !== value) throw Error('Key storage could not be verified. Keep this page open and try Save key again.');
  }
  function connectionLabel(key, saved) {
    return !key ? 'Not connected. Enter a key and connect.' : saved
      ? 'Connected - saved on this device. The blank box is only for replacing your key.'
      : 'Connected for this page only. Save the key below to keep it after navigation.';
  }
  async function saveConnectedKey(run) {
    if (!apiKey) throw Error('Connect the key first, then save it.');
    if (!hasPrivateStorage()) throw Error('Update Torn PDA or use a manager with script storage to save keys.');
    await save(); ensure(run);
    await persistKey(KEY, apiKey); ensure(run);
    keySaved = true; remember.checked = true;
    tell('Scouting key saved on this device and read back successfully.');
  }
  function decodeState(text) {
    if (!text) return emptyState();
    const s = JSON.parse(text);
    if (s.version !== 1 || !s.config) throw Error('Saved data is invalid.');
    s.config = { ...DEFAULTS, ...s.config };
    delete s.config.statSource; // BSP integration retired; FFScouter is the only estimate source.
    // Existing installations get the requested single-button flow. Preserve ID
    // bounds for its independent fallback and every difficulty/profile filter.
    if (!s.poolVersion) s.config.discovery = 'auto';
    // Correct the old availability-first default once, preserving the user's
    // actual FF bounds, strength limits and all cached evidence/history.
    if (!s.ffOrderVersion) {
      s.config.ffPriority = 'strict'; s.config.sort = 'ff-desc';
      s.poolMaxFF = null; s.poolExhausted = false; s.poolFetched = 0; s.band = 0;
    }
    // v0.4.2 owner decision: most-likely-available order becomes the default once,
    // keeping every FF/stat limit. Later choices in settings are respected.
    if (!s.availableOrderVersion) s.config.sort = 'available';
    filters(s.config);
    if (!Array.isArray(s.rows) || !Array.isArray(s.pending) || !Array.isArray(s.used) || s.rows.length > CACHE_LIMIT || s.pending.length > 50 || s.used.length > 2000 ||
        !s.used.every(positiveID) || !Number.isInteger(s.band) || s.band < 0 || s.band > 10 || (s.owner !== null && !positiveID(s.owner))) throw Error('Saved data is invalid.');
    const cleanRow = r => {
      if (!positiveID(r.id) || r.stats !== null && (numeric(r.stats) === null || r.stats < 0) || r.ff !== null && (numeric(r.ff) === null || r.ff < 1)) throw Error('Saved target is invalid.');
      return { id: r.id, name: String(r.name || r.id).slice(0, 80), stats: r.stats, ff: r.ff,
        estimatedAt: numeric(r.estimatedAt), fetchedAt: numeric(r.fetchedAt), lastAction: numeric(r.lastAction),
        faction: Number.isSafeInteger(r.faction) && r.faction >= 0 ? r.faction : null, factionName: String(r.factionName || '').slice(0, 80),
        status: String(r.status || 'Unknown').slice(0, 40), checkedAt: numeric(r.checkedAt), lastOpened: numeric(r.lastOpened),
        statusUntil: numeric(r.statusUntil), retryAt: numeric(r.retryAt),
        okayAt: numeric(r.okayAt), checks: count(r.checks), hospitalHits: Math.min(count(r.hospitalHits), count(r.checks)) };
    };
    const result = emptyState();
    result.config = Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, String(s.config[k])]));
    result.ownerName = tornName(s.ownerName);
    result.owner = s.owner; result.rows = s.rows.map(cleanRow); result.pending = s.pending.map(cleanRow); result.used = s.used;
    if (s.pool !== undefined && (!Array.isArray(s.pool) || s.pool.length > CACHE_LIMIT)) throw Error('Saved candidate pool is invalid.');
    result.pool = (s.pool || []).map(cleanRow);
    if (new Set(result.pool.map(row => row.id)).size !== result.pool.length) throw Error('Saved candidate pool contains duplicates.');
    result.poolMaxFF = numeric(s.poolMaxFF) !== null && s.poolMaxFF >= 1 ? s.poolMaxFF : null;
    result.poolExhausted = s.poolExhausted === true;
    result.poolFetched = Math.max(0, numeric(s.poolFetched) || 0);
    if (s.saved !== undefined && (!Array.isArray(s.saved) || s.saved.length > CACHE_LIMIT)) throw Error('Saved target library is invalid.');
    // Upgrade existing shortlists without clearing keys or search progress.
    result.saved = (s.saved === undefined ? result.rows.filter(row => statMatch(row, filters(result.config))) : s.saved.map(cleanRow));
    if (new Set(result.saved.map(row => row.id)).size !== result.saved.length) throw Error('Saved target library contains duplicates.');
    result.savedCursor = Number.isInteger(s.savedCursor) && s.savedCursor >= 0 && s.savedCursor < result.saved.length ? s.savedCursor : 0;
    if (s.deferred !== undefined && (!Array.isArray(s.deferred) || s.deferred.length > 100 || !s.deferred.every(positiveID))) throw Error('Saved deferred IDs are invalid.');
    result.deferred = [...new Set(s.deferred || [])];
    // Older saves have no expiry; give their deferred IDs one more hour.
    const until = s.deferredUntil && typeof s.deferredUntil === 'object' ? s.deferredUntil : {};
    result.deferredUntil = Object.fromEntries(result.deferred.map(id => [id, numeric(until[id]) ?? now() + DEFER_SECONDS]));
    result.band = s.band;
    if (s.scan) {
      const { min, max, offset, cursor } = s.scan, size = max - min + 1;
      if (!positiveID(min) || !positiveID(max) || max > 100000000 || size < 1 || !Number.isInteger(offset) || offset < 0 || offset >= size || !Number.isInteger(cursor) || cursor < 0 || cursor > size) throw Error('Saved search is invalid.');
      result.scan = { min, max, offset, cursor };
    }
    for (const k of ['scanned', 'checked', 'cooldown', 'nextTorn']) result[k] = Math.max(0, numeric(s[k]) || 0);
    const cooldownReason = LEGACY_REASONS[s.cooldownReason] || s.cooldownReason;
    result.cooldownReason = ['Torn throttle/block', 'FFScouter throttle/block', 'BSP throttle/block', 'TF pause after Torn backend errors'].includes(cooldownReason) ? cooldownReason : '';
    if (s.cooldownReason === 'BSP throttle/block') { result.cooldown = 0; result.cooldownReason = ''; }
    result.lastMessage = typeof s.lastMessage === 'string' ? s.lastMessage.slice(0, 800) : '';
    return result;
  }
  function ensure(run) { if (run !== generation || !active()) throw Error('Paused. Return here and tap again to continue.'); }
  function stop() {
    generation++;
    if (cancelRequest) cancelRequest();
    finishTrace(activeTrace, 'cancelled');
    busy = false;
    buttonBadge = 'II';
    if (notice) { tell('Paused. Tap TF or Find / check more to continue.'); render(); }
    logEvent('stop'); void flushLogs();
  }
  async function targetSearchBudget(run, reserve = false) {
    ensure(run);
    // Keep this outside the target cache so clearing/changing filters or keys
    // cannot reset the rolling request budget. No keys or player data are stored.
    const stored = await readStorage(SEARCH_BUDGET); ensure(run);
    let history;
    try { history = stored ? JSON.parse(stored) : []; } catch { throw Error('TF search budget could not be read. No target-list request was sent.'); }
    if (!Array.isArray(history) || history.length > 20 || history.some(at => !Number.isSafeInteger(at) || at < 0)) throw Error('TF search budget could not be read. No target-list request was sent.');
    const recent = history.filter(at => at > Date.now() - 60000).sort((a, b) => a - b);
    const wait = recent.length >= 20 ? Math.max(1, Math.ceil((recent[0] + 60000 - Date.now()) / 1000)) : 0;
    if (reserve && wait) {
      logEvent('wait', { reason: 'TF target-list budget', until: Date.now() + wait * 1000 });
      const error = Error('TF target-search budget: wait ' + wait + ' seconds before requesting another FFScouter list. Cached targets can still be checked.');
      error.hfWait = true; throw error;
    }
    if (reserve) { recent.push(Date.now()); await writeStorage(SEARCH_BUDGET, JSON.stringify(recent)); ensure(run); }
    return wait;
  }
  async function request(url, run, service, options = {}) {
    ensure(run);
    const trace = activeTrace?.run === run ? activeTrace : null;
    if (Date.now() < state.cooldown) {
      logEvent('wait', { reason: state.cooldownReason || 'Saved pause (reason unavailable)', until: state.cooldown });
      throw Error((state.cooldownReason || 'Saved API pause (reason unavailable)') + ': wait ' + Math.ceil((state.cooldown - Date.now()) / 1000) + ' seconds, then tap again.');
    }
    if (service === 'FFScouter' && new URL(url).pathname === '/api/v1/get-targets') await targetSearchBudget(run, true);
    if (service === 'Torn') {
      const timerKey = 'nextTorn';
      const delay = Math.max(0, state[timerKey] - Date.now());
      if (delay) { const started = Date.now(); await new Promise(resolve => setTimeout(resolve, Math.min(delay, TORN_GAP))); countTrace('pacingMs', Date.now() - started, trace); }
      ensure(run);
      // Kept in memory; every caller saves after its check, and opening a target
      // saves before navigating, so the next page still sees the spacing.
      state[timerKey] = Date.now() + TORN_GAP;
    }
    const operation = service === 'Torn' ? 'profile' : new URL(url).pathname.split('/').pop();
    const requestLog = logEvent('request', { service, operation, outcome: 'pending' });
    countTrace(service === 'Torn' ? 'tornRequests' : 'ffRequests', 1, trace);
    const response = await new Promise((resolve, reject) => {
      let finished = false, handle;
      const finish = (error, value) => {
        if (finished) return;
        finished = true; clearTimeout(timer); cancelRequest = null;
        requestLog.ms = Math.max(0, Date.now() - requestLog.at);
        countTrace('networkMs', requestLog.ms, trace);
        if (requestLog.outcome === 'pending') requestLog.outcome = error ? 'failed' : 'received';
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => { requestLog.outcome = 'timeout'; finish(Error(service + ' request timed out. Tap again when ready.')); handle?.abort?.(); }, 20000);
      cancelRequest = () => { requestLog.outcome = 'cancelled'; finish(Error('Paused. Tap again to continue.')); handle?.abort?.(); };
      try {
        const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) };
        if (typeof PDA_httpGet === 'function') {
          if (options.body && typeof PDA_httpPost !== 'function') { finish(Error('Update Torn PDA to enable registration, or register at ffscouter.com first.')); return; }
          Promise.resolve(options.body ? PDA_httpPost(url, headers, JSON.stringify(options.body)) : PDA_httpGet(url, headers)).then(value => finish(null, value), () => finish(Error(service + ' connection failed.')));
        } else if (typeof GM_xmlhttpRequest === 'function') {
          handle = GM_xmlhttpRequest({ method: options.body ? 'POST' : 'GET', data: options.body ? JSON.stringify(options.body) : undefined, url, headers, anonymous: true, redirect: 'error', timeout: 20000,
            onload: value => finish(null, value), onerror: () => finish(Error(service + ' connection failed.')), ontimeout: () => finish(Error(service + ' request timed out.')) });
        } else finish(Error('Use Torn PDA or a userscript manager with cross-origin request support.'));
      } catch { finish(Error(service + ' connection failed.')); }
    });
    ensure(run);
    let data;
    requestLog.status = Number(response.status);
    try { data = JSON.parse(response.responseText); } catch { requestLog.outcome = 'unreadable'; throw Error(service + ' returned an unreadable response.'); }
    if (!data || typeof data !== 'object') throw Error(service + ' returned an unexpected response.');
    const status = Number(response.status), code = service === 'Torn' ? data.error?.code : data.code;
    if (Number.isSafeInteger(code) && code >= 0) requestLog.code = code;
    if (status === 429 || service === 'Torn' && [5, 8].includes(code) || service === 'FFScouter' && [20, 21].includes(code)) {
      state.cooldown = Date.now() + Math.max(60, Math.min(3600, numeric(data.retry_after_seconds) || 60)) * 1000;
      state.cooldownReason = service + ' throttle/block';
      logEvent('wait', { service, reason: state.cooldownReason, until: state.cooldown });
      await save(); throw Error(service + ' rate limit reached. Wait, then tap again; there is no automatic retry.');
    }
    if (service === 'FFScouter' && status >= 200 && status < 300 && !data.error) ffKeyRejects = 0;
    if (service === 'FFScouter' && code === 17 && status === 404) return { targets: [] };
    if (service === 'FFScouter' && options.body && status === 409 && code === 8) return { success: true };
    if (service === 'Torn' && code === 6 && options.allowMissing) return null;
    if (status < 200 || status >= 300 || !Number.isFinite(status) || data.error) {
      // Erase only a key that is wrong. A valid key Torn cannot use right now
      // (owner in federal jail, inactive, paused, access too low) stops this tap
      // and stays saved. FFScouter's code 6 is erased only when it repeats.
      const invalid = service === 'Torn' ? [1, 2].includes(code) : [1, 2].includes(code) || code === 6 && ffKeyRejects >= 1;
      if (invalid) {
        apiKey = ''; keySaved = false; ffKeyRejects = 0; await writeStorage(KEY, '');
        throw Error(service + ' rejected the key. It was removed; reconnect in settings.');
      }
      if (service === 'FFScouter' && code === 6) {
        ffKeyRejects++;
        throw Error('FFScouter rejected the key. It is kept for now; tap again to retry. If FFScouter rejects it again it will be removed.');
      }
      const unusable = service === 'Torn' ? KEY_HOLDS[code] : [4010, 4011].includes(code) ? 'FFScouter has banned this account or faction' : null;
      if (unusable) throw Error(unusable + ' (' + service + ' code ' + code + '). Your key is kept; fix this, then tap again.');
      const error = Error(service + ' request failed' + (Number.isInteger(code) ? ' (code ' + code + ')' : '') + '. Tap again later.');
      if (service === 'Torn' && code === 17) error.tornCode = 17;
      throw error;
    }
    return data;
  }
  function trusted(event) {
    if (!event.isTrusted || !active()) return false;
    if (busy) { tell('A check is already running.'); return false; }
    return true;
  }
  async function action(event, fn) {
    if (!trusted(event)) return;
    const clickedLabel = event.currentTarget?.textContent;
    busy = true; buttonBadge = ''; progressLabel = '...'; const run = ++generation; render();
    const maintenance = { 'Clear shortlist': 'clear shortlist', 'Restart ID search': 'restart ID search', 'Clear opened history': 'clear opened history',
      'Clear saved targets': 'clear saved targets', 'Clear all local data': 'clear all local data' };
    const label = fn === nextTarget || clickedLabel === 'Find target' ? 'search' : fn === find ? 'batch search'
      : fn === recheckSaved ? 'saved recheck' : fn === retryDeferred ? 'retry failed' : fn === applySettings ? 'settings'
      : ['Connect key', 'Save key on device'].includes(clickedLabel) ? 'key connection' : maintenance[clickedLabel] || 'maintenance';
    const trace = { run, at: Date.now(), action: label, counts: {}, ended: false }; activeTrace = trace;
    logEvent('start', { action: label });
    try { await fn(run); if (run === generation) logEvent('done'); } catch (error) {
      if (run === generation) {
        const category = /key|permission|consent/i.test(error.message) ? 'credentials/consent' : /storage|save/i.test(error.message) ? 'storage'
          : /unexpected|unreadable|different.*player/i.test(error.message) ? 'response format' : /timed out/i.test(error.message) ? 'timeout'
          : /range|whole|number|choice/i.test(error.message) ? 'validation' : 'operation';
        logEvent('error', { category, detail: errorDetail(error) }); finishTrace(trace, error.hfWait || Date.now() < state.cooldown ? 'wait' : 'error');
      }
      if (run === generation) { buttonBadge = error.hfWait || Date.now() < state.cooldown ? 'WAIT' : '!'; tell(error.message); }
    } finally {
      if (run === generation) {
        try { await save(); } catch { logEvent('error', { category: 'storage', detail: 'storage' }); finishTrace(trace, 'error'); buttonBadge = '!'; tell('Could not save this update on your device.'); }
        if (run === generation) { busy = false; render(); }
      }
      finishTrace(trace, run !== generation ? 'cancelled' : label === 'search' ? 'no match' : 'completed');
      if (activeTrace === trace) activeTrace = null;
      void flushLogs();
    }
  }
  function accountAction(event, fn) {
    return action(event, async run => {
      keyError = '';
      try { await fn(run); }
      catch (error) {
        if (run === generation) keyError = error.message;
        throw error;
      }
    });
  }
  function requireKey() { if (!apiKey) throw Error('Open settings and connect your registered FFScouter key first.'); }
  async function connect(run) {
    const entered = keyInput.value.trim();
    if (!/^[a-zA-Z0-9]{16}$/.test(entered)) throw Error('Enter your 16-character Torn / FFScouter key.');
    if (!consent.checked) throw Error('Read the data-use notice and enable FFScouter access first.');
    if (remember.checked && !hasPrivateStorage()) throw Error('Remember key requires PDA or private userscript storage.');
    const owner = await request(profileURL(entered), run, 'Torn');
    if (!positiveID(owner.player_id)) throw Error('Torn did not identify this key owner.');
    const registration = await request('https://ffscouter.com/api/v1/check-key?key=' + entered, run, 'FFScouter');
    if (registration.policy_update_required) throw Error('Review and accept FFScouter\u2019s updated policy at ffscouter.com, then reconnect.');
    if (registration.is_registered === false) {
      const registered = await request('https://ffscouter.com/api/v1/register', run, 'FFScouter', { body: { key: entered, agree_to_data_policy: true, signup_source: 'SRTargetFinder' } });
      if (registered.success !== true) throw Error('FFScouter did not confirm registration. Reconnect to check before trying again.');
    } else if (registration.is_registered !== true) throw Error('FFScouter did not confirm this key\u2019s registration state.');
    ensure(run);
    // FF is relative to the key owner. Reconnecting the same player preserves
    // their shortlist; changing player must discard the old player's scores.
    if (state.owner !== owner.player_id) {
      state = { ...emptyState(), config: state.config, owner: owner.player_id, nextTorn: state.nextTorn };
    }
    // Remembered only so the owner can choose to name themselves on a sent log.
    state.ownerName = tornName(owner.name);
    await save(); ensure(run);
    await persistKey(KEY, remember.checked ? entered : '');
    ensure(run); apiKey = entered; keySaved = remember.checked; keyInput.value = '';
    tell('Connected to Torn and FFScouter. Tap TF for the first available match from cached candidates or new searches.');
  }
  async function enrich(row, run) {
    // Cache FFScouter estimates for a week. FF is relative to the key owner, so
    // older values are refreshed once the profile check has already matched.
    const fresh = numeric(row.fetchedAt) !== null && row.fetchedAt > 0 && row.fetchedAt <= now() && now() - row.fetchedAt < ESTIMATE_TTL;
    if (fresh) countTrace('estimateCacheHits');
    else {
      const refresh = Boolean(row.fetchedAt);
      if (refresh) countTrace('estimateRefreshes');
      const data = await request('https://ffscouter.com/api/v1/get-stats?key=' + apiKey + '&targets=' + row.id, run, 'FFScouter');
      if (!Array.isArray(data) || data.length > 1 || data.some(item => item?.player_id !== row.id)) throw Error('Unexpected FFScouter stats response.');
      const estimate = data[0];
      const stats = numeric(estimate?.bs_estimate) !== null && estimate.bs_estimate >= 0 ? estimate.bs_estimate : null;
      const ff = numeric(estimate?.fair_fight) !== null && estimate.fair_fight >= 1 ? estimate.fair_fight : null;
      // A refresh without a new estimate keeps the dated older one.
      if (!refresh || stats !== null && ff !== null) { row.stats = stats; row.ff = ff; row.estimatedAt = numeric(estimate?.last_updated); }
      row.fetchedAt = now(); await save();
    }
  }
  function scanID(scan) { return scan.min + (scan.offset + scan.cursor) % (scan.max - scan.min + 1); }
  async function scoutProfile(row, run, fresh = false) {
    try {
      const data = await request(profileURL(apiKey, row.id, fresh), run, 'Torn', { allowMissing: true });
      ensure(run); backendErrors = 0;
      const updated = data ? profile(row, data) : null;
      undefer(row.id);
      return updated;
    } catch (error) {
      ensure(run);
      if (error.tornCode !== 17) throw error;
      // A backend error is not proof that this player is unsuitable. Save for
      // explicit retry, and let discovery examine other IDs without looping here.
      deferID(row.id);
      backendErrors++;
      searchReasons['Torn backend error (saved for retry)'] = (searchReasons['Torn backend error (saved for retry)'] || 0) + 1;
      return undefined;
    }
  }
  async function checkBackendErrors() {
    if (backendErrors < 3) return;
    state.cooldown = Date.now() + 60000; state.cooldownReason = 'TF pause after Torn backend errors'; await save();
    logEvent('wait', { reason: state.cooldownReason, until: state.cooldown });
    throw Error('Torn returned code 17 for three consecutive profiles. Search paused for 60 seconds. Failed IDs are saved for Retry failed IDs in TF Settings; your key is retained.');
  }
  async function retryDeferred(run) {
    requireKey(); searchReasons = {}; backendErrors = 0;
    const f = filters(state.config);
    for (const id of [...state.deferred].slice(0, 10)) {
      ensure(run);
      if (state.rows.length >= CACHE_LIMIT) throw Error('Clear shortlist before retrying failed IDs.');
      tell('Retrying failed Torn ID ' + id + '...');
      const row = await scoutProfile({ id, stats: null, ff: null, fetchedAt: null }, run);
      // Keep the retry entry until enrichment also succeeds.
      if (row && profileMatch(row, f)) {
        deferID(id);
        await save(); await enrich(row, run); ensure(run);
        state.rows = state.rows.filter(item => item.id !== id); state.rows.push(row); rememberTarget(row);
        undefer(id);
      }
      if (row !== undefined) { state.checked++; searchOutcome(row, f); }
      await save(); render(); await checkBackendErrors();
    }
    tell(ready().length + ' matching targets. ' + searchDetails() + state.deferred.length + ' failed IDs still saved. Tap TF to open a match.');
  }
  async function findIndependent(run, firstOnly = false, budget = 100) {
    const f = filters(state.config), max = f.maxID ?? state.owner;
    const fresh = firstOnly && state.config.discovery === 'auto';
    if (max < f.minID) throw Error('The ID range ends below its start. Set a maximum ID in settings.');
    if (!state.scan) state.scan = { min: f.minID, max, offset: Math.floor(Math.random() * (max - f.minID + 1)), cursor: 0 };
    if (state.scan.min !== f.minID || state.scan.max !== max) throw Error('ID range changed. Use Restart ID search to begin this range.');
    await save();
    // Ten profiles suffice when matches exist. Otherwise keep searching, with a
    // hard 100-profile limit per foreground tap and the same request pacing.
    for (let checked = 0; checked < budget && (firstOnly ? !ready().length : checked < 10 || !ready().length);) {
      ensure(run);
      if (state.rows.length >= CACHE_LIMIT) throw Error('Shortlist storage is full. Clear shortlist to continue from the saved ID position.');
      if (state.pending.length) {
        const row = state.pending[0]; await enrich(row, run); ensure(run);
        searchOutcome(row, f);
        state.pending.shift(); state.rows.push(row); rememberTarget(row); await save(); render();
        continue;
      }
      if (state.scan.cursor >= max - f.minID + 1) break;
      const id = scanID(state.scan);
      const awaitingRelease = [...state.pool, ...state.saved].some(row => row.id === id && ((cachedRelease(row) ?? 0) > now() || skippedUntil(row, f) > now()));
      // Automatic discovery already considered pool IDs with richer evidence.
      // Its independent fallback should spend requests only on genuinely new IDs.
      const knownPoolID = state.config.discovery === 'auto' && state.pool.some(row => row.id === id);
      if (id === state.owner || state.used.includes(id) || state.rows.some(row => row.id === id) || awaitingRelease || knownPoolID) { state.scan.cursor++; continue; }
      // Persist a run of local skips once before the next request, rather than
      // rewriting the entire 1,000-target cache for every skipped ID.
      await save(); ensure(run);
      tell('Checking new Torn ID ' + id + ' (' + (checked + 1) + '/100 max). ' + ready().length + ' matches. ' + searchDetails());
      progressLabel = String(checked + 1); paintButton();
      countTrace('newIDChecks');
      const row = await scoutProfile({ id, stats: null, ff: null, fetchedAt: null }, run, fresh);
      ensure(run);
      state.scan.cursor++; state.scanned++; checked++;
      if (row !== undefined) state.checked++;
      if (row && profileMatch(row, f)) state.pending.push(row);
      else if (row !== undefined) searchOutcome(row, f, true);
      await save(); await checkBackendErrors();
      // Finish this candidate before advancing, including the tenth profile.
      if (state.pending.length) {
        await enrich(state.pending[0], run); ensure(run);
        searchOutcome(state.pending[0], f);
        const completed = state.pending.shift(); state.rows.push(completed); rememberTarget(completed); await save(); render();
        // Only a fresh profile obtained in this invocation can take the fast
        // path. A pending/queued profile from another tap still needs a check.
        if (fresh && matches(completed, f)) return completed;
      }
    }
    await save(); ensure(run);
    tell(ready().length + ' matching targets. ' + searchDetails() + (state.deferred.length ? state.deferred.length + ' failed IDs saved for Retry failed IDs in TF Settings. ' : '') + (state.scan.cursor >= max - f.minID + 1 ? 'ID range complete. Change the range in TF Settings to search elsewhere.' : 'Tap TF or Find / check more to continue with new IDs.'));
  }
  async function find(run, firstOnly = false) {
    requireKey(); const f = filters(state.config);
    searchReasons = {}; if (!firstOnly) backendErrors = 0;
    if (state.config.discovery === 'auto') return findPool(run);
    if (state.config.discovery === 'torn') return findIndependent(run, firstOnly);
    if (state.rows.length >= CACHE_LIMIT) throw Error('Shortlist storage is full. Clear shortlist before continuing.');
    if (!state.pending.length) {
      if (state.band >= 10) throw Error('Search pass complete: ten level bands sampled. Reset search for another pass, or narrow your fair-fight range.');
      const band = state.band, data = await request(searchURL(apiKey, state.config, band), run, 'FFScouter');
      if (!Array.isArray(data.targets) || data.targets.length > 50) throw Error('Unexpected FFScouter target response.');
      const known = new Set([...state.rows, ...state.pending].map(row => row.id));
      state.scanned += data.targets.length;
      countTrace('providerCandidates', data.targets.length);
      state.pending = data.targets.map(candidate).filter(row => {
        if (!row || row.id === state.owner || known.has(row.id) || state.used.includes(row.id)) return false;
        known.add(row.id); return true;
      });
      state.band++; await save();
    }
    for (let i = 0; i < 10 && state.pending.length && (!firstOnly || !ready().length); i++) {
      ensure(run);
      if (state.rows.length >= CACHE_LIMIT) throw Error('Shortlist storage is full. Clear shortlist before continuing.');
      const row = state.pending[0];
      tell('Checking target ' + (i + 1) + ' of up to 10\u2026');
      progressLabel = String(i + 1); paintButton();
      const updated = await scoutProfile(row, run);
      ensure(run);
      if (!updated) {
        state.pending.shift();
        if (updated !== undefined) { state.checked++; searchOutcome(null, f); }
        await save(); await checkBackendErrors(); continue;
      }
      state.pending[0] = updated;
      if (profileMatch(updated, f)) await enrich(updated, run);
      ensure(run);
      searchOutcome(updated, f);
      state.pending.shift(); state.rows.push(updated); rememberTarget(updated); state.checked++;
      await save(); render();
    }
    tell(ready().length + ' matching targets. ' + searchDetails() + 'Tap TF to open a match or search the next batch. Find / check more also searches further.');
  }
  function keepPool(row) {
    const index = state.pool.findIndex(item => item.id === row.id);
    if (index >= 0) state.pool[index] = { ...state.pool[index], ...row };
    else { if (state.pool.length >= CACHE_LIMIT) state.pool.shift(); state.pool.push({ ...row }); }
  }
  function poolEligible(row, f, attempted) {
    if (attempted.has(row.id) || row.id === state.owner || isDeferred(row.id) || skippedUntil(row, f) > now()) return false;
    const waiting = ['Hospital', 'Jail'].includes(row.status);
    const checked = numeric(row.checkedAt) !== null && row.checkedAt > 0 && row.checkedAt <= now();
    const release = cachedRelease(row);
    // A stay observed after opening can end before the normal duplicate-open
    // hold. Its timer permits a new check only, never automatic navigation.
    const releasedAfterOpen = waiting && release !== null && release <= now() && row.lastOpened && row.checkedAt >= row.lastOpened;
    if (state.used.includes(row.id) && (!row.lastOpened || now() - row.lastOpened < 120) && !releasedAfterOpen) return false;
    let retryAt = numeric(row.retryAt) ?? 0;
    // A known release suppresses checks until that time, including old cache
    // entries with shorter retry deadlines. Missing timers get a bounded retry.
    // Expiry permits a fresh check only; the player may have been hit again.
    if (waiting && checked) retryAt = release ?? Math.min(retryAt || Infinity, row.checkedAt + 60);
    if (retryAt > now()) return false;
    // A previously observed recent action cannot become sufficiently old before
    // this threshold. It can only reject; fresh evidence still authorizes matches.
    if (numeric(row.lastAction) !== null && row.lastAction > 0 && row.lastAction <= now() && now() - row.lastAction < f.days * DAY) return false;
    // Exclude unknown or out-of-range strength before spending a Torn request.
    return statMatch(row, f);
  }
  function provenPoolCandidate(row, f) {
    return numeric(row.checkedAt) !== null && row.checkedAt > 0 && row.checkedAt <= now() &&
      ['Okay', 'Hospital', 'Jail'].includes(row.status) && statMatch(row, f) && profileMatch({ ...row, status: 'Okay' }, f);
  }
  async function findPool(run) {
    requireKey(); ensure(run);
    const f = filters(state.config), attempted = new Set();
    searchReasons = {}; backendErrors = 0;
    for (const row of [...state.rows, ...state.saved]) {
      if (!state.pool.some(item => item.id === row.id)) keepPool(row);
    }
    countTrace('poolAtStart', state.pool.length);
    countTrace('eligibleAtStart', state.pool.filter(row => poolEligible(row, f, attempted)).length);
    countTrace('hospitalTimersSkipped', state.pool.filter(row => (cachedRelease(row) || 0) > now()).length);
    countTrace('unknownStrengthAtStart', state.pool.filter(row => numeric(row.stats) === null || numeric(row.ff) === null).length);
    countTrace('outsideStatsAtStart', state.pool.filter(row => numeric(row.stats) !== null && (row.stats < f.min || row.stats > f.max)).length);
    countTrace('outsideFFAtStart', state.pool.filter(row => numeric(row.ff) !== null && (row.ff < f.minFF || row.ff > f.maxFF)).length);
    countTrace('recentActivityAtStart', state.pool.filter(row => numeric(row.lastAction) !== null && now() - row.lastAction < f.days * DAY).length);
    countTrace('deferredAtStart', state.pool.filter(row => isDeferred(row.id)).length);
    countTrace('skippedStatusAtStart', state.pool.filter(row => skippedUntil(row, f) > now()).length);
    countTrace('contestedAtStart', state.pool.filter(contested).length);
    const cachedIDs = new Set(state.pool.map(row => row.id));
    // A completed sample can be renewed on a later tap. This is bounded sampling,
    // not exhaustive pagination: equal-FF ties can be omitted by the provider.
    if (state.poolExhausted && now() - state.poolFetched >= 900) { state.poolExhausted = false; state.poolMaxFF = null; }
    let checked = 0, batches = 0, searchBudgetReached = false, misses = 0, earlyBatches = 0;
    const fresh = new Set(); // Candidates first added by a list requested during this tap.
    // Requests one FFScouter list below the last sampled FF. Returns how many new
    // candidates it added, or why no list may be requested now.
    const loadBatch = async () => {
      if (state.poolExhausted || batches >= 20) return 'exhausted';
      if (await targetSearchBudget(run)) return 'budget';
      const upper = Math.min(f.maxFF, state.poolMaxFF ?? f.maxFF);
      if (upper < f.minFF) { state.poolExhausted = true; return 'exhausted'; }
      if (batches) { const started = Date.now(); await new Promise(resolve => setTimeout(resolve, 1000)); countTrace('pacingMs', Date.now() - started); ensure(run); }
      progressLabel = '...'; tell('Loading candidates within your limits. Tap TF again to stop.');
      const url = new URL('https://ffscouter.com/api/v1/get-targets');
      url.search = new URLSearchParams({ key: apiKey, limit: '50', minff: String(f.minFF), maxff: String(upper),
        inactiveonly: f.days >= 14 ? '1' : '0', factionless: f.faction === 'none' ? '1' : '0' }).toString();
      const data = await request(url.href, run, 'FFScouter'); ensure(run);
      if (!Array.isArray(data.targets) || data.targets.length > 50) throw Error('Unexpected FFScouter target response.');
      countTrace('providerCandidates', data.targets.length);
      const candidates = data.targets.map(candidate).filter(item => item && item.ff >= f.minFF && item.ff <= upper);
      let added = 0;
      for (const item of candidates) {
        if (item.id === state.owner) continue;
        const existing = state.pool.find(row => row.id === item.id);
        if (!existing) { keepPool(item); fresh.add(item.id); added++; }
        // Take newer provider estimates without discarding profile evidence or timers.
        else if ((item.estimatedAt ?? 0) >= (existing.estimatedAt ?? 0)) {
          Object.assign(existing, { stats: item.stats, ff: item.ff, estimatedAt: item.estimatedAt, fetchedAt: item.fetchedAt });
          countTrace('estimateRefreshes');
        }
      }
      const lowest = candidates.length ? Math.min(...candidates.map(item => item.ff)) : null;
      state.poolMaxFF = lowest === null ? null : Math.round((lowest - 0.01) * 100) / 100;
      state.poolExhausted = lowest === null || state.poolMaxFF < f.minFF;
      state.poolFetched = now(); state.scanned += data.targets.length; batches++;
      await save(); return added;
    };
    // A bounded tap: about 25 seconds at 1.25s spacing. Another tap continues.
    while (checked < TAP_CHECKS) {
      ensure(run);
      const eligible = state.pool.filter(item => poolEligible(item, f, attempted));
      const proven = eligible.filter(item => provenPoolCandidate(item, f));
      // Prefer matches last seen available or past their reported release over
      // stays with unknown timers. Fresh Okay evidence is always mandatory.
      const likelyAvailable = proven.filter(item => !openedSinceOkay(item)).filter(item => item.status === 'Okay' ||
        numeric(item.statusUntil) !== null && item.statusUntil > item.checkedAt && item.statusUntil <= now());
      // Players from a list fetched during this tap are checked before older cache
      // entries, which otherwise outrank them (higher FF from earlier lists).
      const freshEligible = eligible.filter(item => fresh.has(item.id));
      // The availability order ranks every eligible candidate itself (see sorted).
      const row = sorted(freshEligible.length ? freshEligible : f.sort === 'available' ? eligible : likelyAvailable.length ? likelyAvailable : proven.length ? proven : eligible, f)[0];
      // Repeatedly finding targets already hospitalised means these candidates are
      // contested, including a fresh list that proved no better: sample another
      // list, at most three per tap. Only the newest list is preferred.
      const wantFresh = Boolean(row) && misses >= MISS_REFRESH && earlyBatches < 3;
      if (!row || wantFresh) {
        if (wantFresh) { earlyBatches++; fresh.clear(); }
        const loaded = await loadBatch();
        if (typeof loaded === 'number') {
          if (wantFresh) countTrace('earlyBatches');
          // Count misses afresh once the new list has added someone to check.
          if (loaded) misses = 0;
          continue;
        }
        if (!row) { if (loaded === 'budget') searchBudgetReached = true; break; }
        earlyBatches = 3; // No list available now; keep checking cached candidates.
      }
      attempted.add(row.id); checked++;
      countTrace(cachedIDs.has(row.id) ? 'cachedChecks' : 'newCandidateChecks');
      progressLabel = String(checked); tell('Checking candidate ' + checked + '. Tap TF again to stop.');
      // Invalidate before the request so failure/cancellation cannot leave a
      // cached Okay result that another path might treat as ready.
      const pending = { ...row, status: 'Unverified', checkedAt: null, retryAt: now() + 60 };
      keepPool(pending); rememberTarget(pending);
      state.rows = state.rows.filter(item => item.id !== row.id);
      await save(); ensure(run);
      const updated = await scoutProfile(pending, run, true); ensure(run);
      if (!updated) {
        if (updated === null) keepPool({ ...pending, status: 'Unavailable', retryAt: now() + 300 });
        await save(); await checkBackendErrors(); continue;
      }
      state.checked++;
      if (profileMatch(updated, f)) await enrich(updated, run);
      ensure(run);
      const okay = matches(updated, f);
      updated.retryAt = okay ? 0 : ['Hospital', 'Jail'].includes(updated.status) && updated.statusUntil
        ? updated.statusUntil : now() + 60;
      keepPool(updated); rememberTarget(updated); searchOutcome(updated, f);
      if (updated.status === 'Hospital') misses++;
      if (okay) {
        state.used = state.used.filter(id => id !== updated.id);
        if (state.rows.length >= CACHE_LIMIT) state.rows.shift();
        state.rows.push(updated);
      }
      await save(); ensure(run);
      if (okay) return updated;
    }
    if (checked >= TAP_CHECKS) {
      countTrace('tapLimitReached');
      tell('Checked ' + TAP_CHECKS + ' candidates; none were available. Tap TF to keep looking. ' + searchDetails() + 'Your difficulty limits were kept.');
      return;
    }
    // Supplement provider samples with genuinely new Torn IDs. Keep the same
    // persisted ID cursor and reserve the total per-tap profile budget.
    if (state.rows.length > CACHE_LIMIT - 10) state.rows = state.rows.slice(-(CACHE_LIMIT - 10));
    const discovered = await findIndependent(run, true, 9); ensure(run);
    const fallback = discovered || ready()[0];
    if (fallback) {
      const updated = discovered && now() - discovered.checkedAt <= 5 ? discovered : await scoutProfile(fallback, run, true); ensure(run);
      const result = updated || { ...fallback, status: 'Unverified', checkedAt: null };
      keepPool(result); rememberTarget(result);
      state.rows = state.rows.filter(item => item.id !== fallback.id);
      if (updated && matches(updated, f)) { state.rows.push(updated); await save(); ensure(run); return updated; }
      await save(); await checkBackendErrors();
    }
    if (searchBudgetReached) {
      const wait = await targetSearchBudget(run); ensure(run);
      if (wait) {
        logEvent('wait', { reason: 'TF target-list budget', until: Date.now() + wait * 1000 });
        const error = Error('TF target-search budget: wait ' + wait + ' seconds for another FFScouter list. Cached targets and new ID fallback found no available match this pass. Your limits were kept.');
        error.hfWait = true; throw error;
      }
    }
    tell('No available match in this pass. Candidates are cached for the next TF tap. ' + searchDetails() + 'Your difficulty limits were kept.');
  }
  async function nextTarget(run) {
    requireKey();
    backendErrors = 0;
    if (state.used.length >= 2000) throw Error('Opened-target history is full. Clear opened history in settings before continuing.');
    const pooled = state.config.discovery === 'auto';
    let row = pooled ? await findPool(run) : ready()[0], freshlyRechecked = pooled && Boolean(row);
    ensure(run);
    if (!pooled && !row && state.saved.length) {
      row = await recheckSaved(run, true); ensure(run);
      freshlyRechecked = Boolean(row);
    }
    if (!row && !pooled) {
      tell('Searching for the first matching target. Keep this page active; tap TF again to stop.');
      await find(run, true); ensure(run);
      row = ready()[0];
      if (!row) { buttonBadge = '0'; return; }
    }
    if (!row) { buttonBadge = '0'; return; }
    // A stale queue entry should not consume the tap. Check up to ten distinct
    // queued candidates, keeping API errors terminal and navigation limited to one.
    for (let checked = 0; row && checked < 10; checked++) {
      tell('Checking ' + row.name + ' before opening\u2026');
      progressLabel = String(checked + 1); paintButton();
      backendErrors = 0;
      const updated = freshlyRechecked && now() - row.checkedAt <= 5 ? row : await scoutProfile(row, run, true);
      ensure(run); freshlyRechecked = false;
      if (!updated) {
        rememberTarget({ ...row, status: updated === undefined ? 'Unverified' : 'Unavailable', checkedAt: null });
        state.rows = state.rows.filter(item => item.id !== row.id); await save(); ensure(run);
        if (updated === undefined) throw Error('Torn could not check this target (code 17). Saved for manual retry. Tap TF for another target.');
      } else {
        state.rows = state.rows.map(item => item.id === row.id ? updated : item);
        rememberTarget(updated);
        if (pooled) keepPool(updated);
        if (matches(updated, filters(state.config))) {
          if (state.used.length >= 2000) throw Error('Opened-target history is full. Clear opened history in settings before continuing.');
          updated.lastOpened = now(); rememberTarget(updated);
          if (pooled) keepPool({ ...updated, retryAt: now() + 120 });
          state.used.push(row.id); await save(); ensure(run);
          logEvent('open'); finishTrace(activeTrace, 'opened'); void flushLogs(); ensure(run);
          // This is the only Torn page navigation. A new TF tap is required for each target.
          window.location.assign('https://www.torn.com/page.php?sid=attack&user2ID=' + row.id);
          return;
        }
        await save(); ensure(run);
      }
      row = ready()[0];
    }
    buttonBadge = '0';
    tell('Checked queued targets, but they no longer match or are unavailable. Tap TF to continue. Your difficulty limits were kept.');
  }
  function profilePage() {
    if (window.location.pathname !== '/profiles.php') return false;
    const id = new URLSearchParams(window.location.search).get('XID');
    // During first-time setup the key owner is not yet known. Once connected,
    // keep settings on the owner's profile; never infer an ID from another player.
    return !state.owner || !id || String(state.owner) === id;
  }
  function showPanel(open) { panel.hidden = !open; dock.hidden = open; if (open) render(); }
  function mountProfileSettings() {
    if (!active() || !profilePage()) return;
    const title = document.querySelector('.content-title');
    const links = document.querySelector('#top-page-links-list') || title;
    if (!title || !links || settingsHost?.isConnected) return;
    settingsHost = element('span', undefined, links);
    settingsHost.id = 'sr-target-finder-settings-button';
    const settingsRoot = settingsHost.attachShadow({ mode: 'closed' });
    element('style', ':host{display:inline-flex;flex:0 0 auto;vertical-align:middle;margin:2px 0 2px 5px}button{box-sizing:border-box;font:600 12px/1 system-ui;white-space:nowrap;min-height:34px;padding:8px 10px;border:1px solid #9e7049;border-radius:5px;background:#343434;color:#f2e9df;box-shadow:inset 0 1px #ffffff12;cursor:pointer;touch-action:manipulation}button:hover{background:#42372e}button:focus-visible{outline:2px solid #ffc28e;outline-offset:2px}button:active{background:#4b3020}', settingsRoot);
    const settingsButton = button('TF Settings', settingsRoot, event => {
      if (!event.isTrusted || !active()) return;
      showPanel(panel.hidden);
    });
    settingsButton.setAttribute('aria-label', 'Target Finder Settings');
    settingsButton.title = 'target finder settings';
    title.after(host);
    panel.classList.add('profile-panel');
  }
  function tell(message) {
    let text = String(message);
    if (apiKey) text = text.replaceAll(apiKey, '[key]');
    state.lastMessage = text.slice(0, 800); notice.textContent = state.lastMessage;
    paintButton();
  }
  function paintButton() {
    if (!targetButton) return;
    const badge = busy ? progressLabel : buttonBadge;
    targetButton.disabled = false;
    targetButton.textContent = badge ? 'TF\n' + badge : 'TF';
    targetButton.setAttribute('data-working', String(busy));
    targetButton.setAttribute('data-badge', String(Boolean(badge)));
    targetButton.setAttribute('aria-busy', String(busy));
    targetButton.title = busy ? 'Working: ' + progressLabel + '. Tap TF to stop.' : buttonBadge ? state.lastMessage + ' Details in TF Settings on your profile.' : 'Open next matching target';
    targetButton.setAttribute('aria-label', busy ? 'Stop target search (' + progressLabel + ')' : 'Open next target (' + ready().length + ' ready)' + (buttonBadge ? '. ' + targetButton.title : ''));
    if (searchButton) { searchButton.textContent = busy ? 'Stop search' : 'Find target'; searchButton.setAttribute('aria-busy', String(busy)); }
  }
  function element(tag, text, parent) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  }
  function button(text, parent, handler) {
    const node = element('button', text, parent); node.type = 'button'; node.addEventListener('click', handler); return node;
  }
  function link(text, url, parent) {
    const node = element('a', text, parent); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
  }
  function control(label, name, options, parent = fields.grid) {
    const wrap = element('label', label, parent), node = element(options ? 'select' : 'input', undefined, wrap);
    node.setAttribute('aria-label', label);
    if (options) for (const [value, text] of options) { const option = element('option', text, node); option.value = value; }
    else { node.type = 'text'; node.inputMode = name.includes('Stats') ? 'text' : 'decimal'; }
    node.value = state.config[name]; fields[name] = node;
    return node;
  }
  function checkbox(label, name, parent) {
    const wrap = element('label', undefined, parent), node = element('input', undefined, wrap);
    node.type = 'checkbox'; node.checked = state.config[name] === '1'; node.setAttribute('aria-label', label);
    wrap.append(document.createTextNode(label)); fields[name] = node;
    return node;
  }
  const fieldValue = k => fields[k].type === 'checkbox' ? (fields[k].checked ? '1' : '0') : fields[k].value;
  function smallStats(value) { return value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 }); }
  async function applySettings(run, quiet = false) {
    const config = Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, fieldValue(k)])); filters(config);
    const changed = Object.keys(DEFAULTS).some(k => config[k] !== state.config[k]);
    // Order and skip choices are reapplied on the next tap; neither needs a fresh search.
    const onlySort = Object.keys(DEFAULTS).filter(k => k !== 'sort' && !SKIP_KEYS.includes(k)).every(k => config[k] === state.config[k]);
    state.config = config;
    // Reevaluate the retained pool under the new filters on the next tap. In
    // particular, do not discard known hospital timers or paid-for estimates.
    if (!onlySort) { state.rows = []; state.pending = []; state.poolMaxFF = null; state.poolExhausted = false; state.poolFetched = 0; state.band = 0; state.scanned = 0; state.checked = 0; }
    if (changed) { await save(); ensure(run); }
    if (!quiet) tell('Settings saved. Tap TF or Find target when ready.');
  }
  function render() {
    if (!targetButton) return;
    if (keyStatus) keyStatus.textContent = connectionLabel(apiKey, keySaved) + (keyError ? ' ' + keyError : '');
    const available = ready();
    findButton.disabled = busy; paintButton();
    const f = filters(state.config);
    summary.textContent = available.length + ' ready \u00b7 ' + state.saved.length + ' saved';
    limits.textContent = 'Limits: FFScouter stats ' + smallStats(f.min) + ' to ' + (Number.isFinite(f.max) ? smallStats(f.max) : 'no maximum set') + '; FF ' + f.minFF + ' to ' + f.maxFF + '. Unknown strength is excluded.' +
      (f.skipFederal || f.skipTravel || f.skipFallen ? ' Skipping: ' + [f.skipFederal && 'federal', f.skipTravel && 'travel', f.skipFallen && 'fallen'].filter(Boolean).join(', ') + '.' : '');
    if (panel.hidden) return; // Do not rebuild offscreen cards during TF scouting.
    list.replaceChildren();
    for (const row of available.slice(0, 25)) {
      const item = element('div', undefined, list); item.className = 'target';
      element('strong', row.name + ' [' + row.id + ']', item);
      element('div', 'FF ' + row.ff.toFixed(2) + ' \u00b7 estimated ' + smallStats(selectedStats(row, filters(state.config))) + ' stats \u00b7 ' + Math.floor((now() - row.lastAction) / DAY) + ' days inactive', item);
      element('div', (row.faction === 0 ? 'No faction' : row.factionName || 'Faction ' + row.faction) + ' \u00b7 ' + row.status + ' at ' + new Date(row.checkedAt * 1000).toLocaleTimeString(), item);
      element('div', 'FFScouter stats: ' + (numeric(row.stats) === null ? 'unknown' : smallStats(row.stats)) + ' \u00b7 ' + (row.estimatedAt > 0 ? new Date(row.estimatedAt * 1000).toLocaleDateString() : 'date unknown'), item);
    }
    if (available.length > 25) element('p', 'Showing the first 25; TF uses the full sorted list.', list);
    savedSummary.textContent = 'Saved targets (' + state.saved.length + '/' + CACHE_LIMIT + ')';
    savedList.replaceChildren();
    element('p', 'Saved on this device. Recheck refreshes up to 10 profiles per tap and returns available matches to TF, including previously opened targets. TF skips recently rejected profiles for one minute; this manual recheck can check them sooner. Failed IDs wait for manual retry. Estimates stay cached; status is only as recent as its check.', savedList);
    for (const row of state.saved.slice(0, 25)) {
      const item = element('div', undefined, savedList); item.className = 'saved-target';
      element('strong', row.name + ' [' + row.id + ']', item);
      element('div', row.status + (row.checkedAt ? ' - checked ' + new Date(row.checkedAt * 1000).toLocaleString() : ' - needs recheck'), item);
      element('small', 'FF ' + (numeric(row.ff) === null ? 'unknown' : row.ff.toFixed(2)) + (row.lastOpened ? ' | Last opened ' + new Date(row.lastOpened * 1000).toLocaleString() : ''), item);
    }
    if (state.saved.length > 25) element('p', 'Showing the first 25; rechecks cycle through the entire saved list.', savedList);
  }
  function makeUI() {
    host = element('div', undefined, document.body); host.id = 'sr-target-finder';
    root = host.attachShadow({ mode: 'closed' });
    element('style', `
      :host{all:initial;font:14px/1.4 system-ui,sans-serif;color:#f3f3f3;position:relative;z-index:2147483000}
      *{box-sizing:border-box} [hidden]{display:none!important}
      button,input,select{font:inherit}button,a,input,select{touch-action:manipulation}
      button{min-height:42px;border:1px solid #796351;border-radius:7px;background:#34302c;color:#fff;padding:8px 10px;cursor:pointer}
      button:disabled{opacity:.55}a{color:#ffbd80}input,select{display:block;width:100%;min-height:40px;margin:4px 0 0;border:1px solid #777;border-radius:5px;background:#202020;color:#fff;padding:7px;font-size:16px}
      input[type=checkbox]{display:inline;width:20px;min-height:20px;vertical-align:middle;margin:0 8px 0 0}
      .dock{position:fixed;right:max(0px,env(safe-area-inset-right));bottom:calc(68% + 8px);display:flex;flex-direction:column;gap:3px}
      .dock button{width:30px;padding:3px;min-height:30px;border-radius:6px 0 0 6px;background:#a74c12;border-color:#d57e3b;font-size:12px;font-weight:700}
      .dock button[data-badge=true]{font-size:9px;line-height:11px;white-space:pre;padding:2px}
      .dock button[data-working=true]{background:#75521b;border-color:#ffd08a}
      .dock button.logs-button{min-height:24px;font-size:9px;line-height:16px;background:#34302c}
      .diagnostics{position:fixed;z-index:2;right:max(6px,env(safe-area-inset-right));top:max(12px,env(safe-area-inset-top));width:min(440px,calc(100vw - 12px));max-height:calc(100dvh - 130px - env(safe-area-inset-bottom));overflow:auto;background:#191919;border:1px solid #98633b;border-radius:10px;padding:12px;box-shadow:0 8px 40px #000b}
      .diagnostics .send-identity{display:flex;align-items:center;gap:8px;min-height:40px}.diagnostics .send-note{font-size:12px;color:#c7beb7}
      .diagnostics textarea{display:block;box-sizing:border-box;width:100%;height:min(300px,40dvh);background:#202020;color:#f3f3f3;border:1px solid #777;border-radius:5px;padding:8px;font:12px/1.5 monospace;white-space:pre-wrap;overflow-wrap:anywhere;resize:vertical}
      .panel{position:fixed;right:max(6px,env(safe-area-inset-right));top:max(8px,env(safe-area-inset-top));width:min(440px,calc(100vw - 12px));max-height:calc(100dvh - 120px - env(safe-area-inset-bottom));overflow:auto;overscroll-behavior:contain;background:#191919;border:1px solid #98633b;border-radius:10px;padding:12px;box-shadow:0 8px 40px #000b}
      .profile-panel{position:static;width:100%;max-width:750px;max-height:none;margin:8px 0;box-shadow:none}
      header{display:flex;justify-content:space-between;align-items:center;gap:10px}h2{font-size:18px;margin:0}p{margin:8px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.grid label:last-child{grid-column:1/-1}label{display:block}.primary{background:#a74c12;border-color:#d57e3b}.settings-actions button{flex:1}.skips{border:1px solid #49413b;border-radius:7px;margin:0 0 10px;padding:6px 10px}.skips legend{padding:0 4px}.skips label{display:inline-flex;align-items:center;min-height:36px;margin:0 14px 0 0}
      .actions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.notice{color:#ffca95;white-space:pre-wrap}.target{padding:10px 0;border-top:1px solid #49413b}small{color:#c7beb7}h3{font-size:14px;margin:10px 0 6px}details{margin:12px 0}summary{cursor:pointer;min-height:36px;padding:8px 0}table{border-collapse:collapse;width:100%;font-size:12px}td,th{text-align:left;vertical-align:top;padding:5px;border:1px solid #555}th{width:28%}
    `, root);
    dock = element('div', undefined, root); dock.className = 'dock';
    targetButton = button('TF', dock, event => {
      if (!event.isTrusted || !active()) return;
      return busy ? stop() : action(event, nextTarget);
    });
    const logsButton = button('Logs', dock, showLogs); logsButton.className = 'logs-button'; logsButton.setAttribute('aria-label', 'TF logs');
    logPanel = element('section', undefined, root); logPanel.className = 'diagnostics'; logPanel.hidden = true;
    logPanel.setAttribute('role', 'dialog'); logPanel.setAttribute('aria-label', 'TF diagnostics');
    const logHeader = element('header', undefined, logPanel); element('h2', 'TF logs', logHeader);
    button('Close logs', logHeader, event => { if (event.isTrusted) logPanel.hidden = true; });
    logHint = element('p', '', logPanel); logHint.setAttribute('role', 'status');
    logText = element('textarea', undefined, logPanel); logText.readOnly = true; logText.setAttribute('aria-label', 'TF diagnostic report');
    const logActions = element('div', undefined, logPanel); logActions.className = 'actions';
    button('Copy logs', logActions, async event => {
      if (!event.isTrusted || !active()) return;
      renderLogs();
      try {
        if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
        await navigator.clipboard.writeText(logText.value); logHint.textContent = 'Copied. Paste the report into this chat.';
      } catch {
        logText.focus(); logText.select(); logText.setSelectionRange(0, logText.value.length);
        logHint.textContent = 'Automatic copy unavailable. The report is selected; use your device\u2019s Copy command.';
      }
    });
    button('Send to leadership', logActions, sendLogs);
    button('Refresh logs', logActions, event => { if (event.isTrusted && active()) renderLogs(); });
    button('Clear logs', logActions, async event => {
      if (!event.isTrusted || !active()) return;
      logEpoch++; logs = []; void flushLogs(); renderLogs();
    });
    const identityWrap = element('label', undefined, logPanel); identityWrap.className = 'send-identity';
    logIdentity = element('input', undefined, identityWrap); logIdentity.type = 'checkbox';
    identityWrap.append(document.createTextNode('Include my Torn name and ID'));
    element('p', 'Send to leadership uploads only this report to shadowreapersfaction.com, where only the Shadow Reapers owner can read it. It is deleted after 30 days. Your key is never sent; your name and ID only if ticked.', logPanel).className = 'send-note';
    panel = element('section', undefined, root); panel.className = 'panel'; panel.hidden = true; panel.setAttribute('aria-label', 'target finder');
    const header = element('header', undefined, panel); element('h2', 'Target finder', header);
    button('Close', header, () => { showPanel(false); });
    element('p', 'Tap TF to open the next target\u2019s attack page. Only available targets within your limits qualify.', panel);
    notice = element('p', state.lastMessage || (apiKey ? 'Saved key loaded. No requests run until you tap.' : 'Connect your FFScouter key below, set filters, then find targets.'), panel); notice.className = 'notice'; notice.setAttribute('role', 'status');
    fields.grid = element('div', undefined, panel); fields.grid.className = 'grid';
    control('Maximum estimated stats', 'maxStats').placeholder = 'Any (e.g. 100m)';
    control('Inactive at least (days)', 'days');
    control('Faction', 'faction', [['any', 'Either'], ['none', 'No faction'], ['yes', 'Has a faction']]);
    const skips = element('fieldset', undefined, panel); skips.className = 'skips';
    element('legend', 'Skip players in', skips);
    checkbox('Federal jail', 'skipFederal', skips);
    checkbox('Traveling / abroad', 'skipTravel', skips);
    checkbox('Fallen', 'skipFallen', skips);
    element('small', 'Skipped players are not rechecked until their release time (federal; 7 days if Torn gives none), 15 minutes (travel) or Clear shortlist (fallen). Unticking a box allows rechecks on the next tap.', skips);
    limits = element('small', '', panel);
    const actions = element('div', undefined, panel); actions.className = 'actions settings-actions';
    button('Save settings', actions, event => action(event, applySettings));
    searchButton = button('Find target', actions, event => {
      if (!event.isTrusted || !active()) return;
      return busy ? stop() : action(event, async run => { await applySettings(run, true); await nextTarget(run); });
    }); searchButton.className = 'primary';
    summary = element('p', '', panel);
    const account = element('details', undefined, panel); account.open = !apiKey; element('summary', 'Torn / FFScouter connection', account);
    // Torn requires this table to be clearly visible where the key is entered,
    // so it is never collapsed inside the key form.
    element('h3', 'Data use and permissions', account);
    const table = element('table', undefined, account);
    for (const [label, value] of [
      ['Data Storage', 'This script: filters, estimates, profile checks, up to 1,000 saved targets and opened IDs stay only on your device until cleared. The latest 100 diagnostic events and 20 action summaries are also stored locally, without keys or player identities; Logs lets you copy or clear them. Saved targets survive search resets and filter changes; Clear saved targets removes that library. FFScouter separately stores your registered key and data under its linked policy.'],
      ['Data Sharing', 'No shortlist is shared with our servers or faction. FFScouter receives requested target IDs and uses your key for its own collection; its public estimate pool is shared with other users. Only if you tap Send to leadership in Logs, that report (plus your Torn name and ID if ticked) goes to the Shadow Reapers owner and is deleted after 30 days.'],
      ['Purpose of Use', 'Competitive advantage: find and compare targets. Read-only API scouting, no gameplay actions or page scraping. FFScouter also uses permitted data for estimation and model training under its policy.'],
      ['Key Storage & Sharing', 'Sent to Torn and FFScouter only. Memory-only here unless Remember saves it in PDA/private userscript storage. FFScouter retains registered keys separately. Forget removes only this script\u2019s copy; revoke/pause the key in Torn or use FFScouter\u2019s removal controls to stop provider access.'],
      ['Key Access Level', 'Prefer a custom key: user basic, battlestats, attacks, hof, profile (personalstats optional for FFScouter). Limited/Full also work but grant more access. Connect checks registration and registers only after consent.']
    ]) { const tr = element('tr', undefined, table); element('th', label, tr); element('td', value, tr); }
    link('FFScouter registration, terms and data policy', 'https://ffscouter.com/', account);
    keyStatus = element('p', '', account); keyStatus.setAttribute('role', 'status');
    const keyLabel = element('label', 'Torn / FFScouter key', account); keyInput = element('input', undefined, keyLabel); keyInput.type = 'password'; keyInput.autocomplete = 'off'; keyInput.spellcheck = false;
    keyInput.placeholder = 'Enter or replace key';
    const agreeLabel = element('label', undefined, account); consent = element('input', undefined, agreeLabel); consent.type = 'checkbox'; agreeLabel.append(document.createTextNode('I agree to FFScouter\u2019s terms and data policy linked above; connect and register this key if needed.'));
    const rememberLabel = element('label', undefined, account); remember = element('input', undefined, rememberLabel); remember.type = 'checkbox'; remember.disabled = !hasPrivateStorage(); remember.checked = keySaved; rememberLabel.append(document.createTextNode('Remember key on this device'));
    const accountActions = element('div', undefined, account); accountActions.className = 'actions';
    button('Connect key', accountActions, event => accountAction(event, connect));
    button('Save key on device', accountActions, event => accountAction(event, run => saveConnectedKey(run)));
    button('Forget key', accountActions, async event => {
      if (!event.isTrusted) return; stop(); apiKey = ''; keySaved = false; keyError = ''; keyInput.value = ''; remember.checked = false; consent.checked = false; render();
      try { await persistKey(KEY, ''); logEvent('done', { action: 'forget key' }); tell('Key forgotten. Saved target list remains on this device.'); }
      catch { logEvent('error', { action: 'forget key', category: 'storage' }); tell('Could not erase the saved key. Clear this script\u2019s storage in your manager.'); }
      void flushLogs();
    });
    const more = element('details', undefined, panel); element('summary', 'Advanced / troubleshooting', more);
    element('small', 'Your existing settings are preserved. Usually you can leave these alone. Estimates cannot guarantee a win.', more);
    const advancedGrid = element('div', undefined, more); advancedGrid.className = 'grid';
    control('Minimum estimated stats', 'minStats', undefined, advancedGrid).placeholder = 'Any (e.g. 1m)';
    control('Minimum fair fight', 'minFF', undefined, advancedGrid); control('Maximum fair fight', 'maxFF', undefined, advancedGrid);
    control('Target priority', 'ffPriority', [['strict', 'Use my FF range'], ['available', 'Allow below minimum FF']], advancedGrid);
    control('Discovery', 'discovery', [['auto', 'Automatic cached pool'], ['torn', 'Torn ID search'], ['ff', 'FF samples']], advancedGrid);
    control('First player ID', 'minID', undefined, advancedGrid);
    control('Last player ID', 'maxID', undefined, advancedGrid).placeholder = 'Your ID (older accounts)';
    control('Target order', 'sort', [['available', 'Most likely available first'], ['ff-desc', 'Fair fight: highest first'], ['ff-asc', 'Fair fight: lowest first'], ['inactive', 'Longest inactive first'], ['stats', 'Lowest stats first']], advancedGrid);
    button('Save settings', more, event => action(event, applySettings));
    findButton = button('Find / check more', more, event => action(event, find));
    button('Stop', more, stop);
    element('small', 'Keep this page active while searching. Tap the working TF or Find target button to stop. Progress and errors appear on TF; details appear here. New searches check at most 100 profiles per tap. Changing player ID bounds requires Restart ID search.', more);
    button('Retry failed IDs', more, event => action(event, retryDeferred));
    button('Clear shortlist', more, event => action(event, async () => {
      state.rows = []; state.pending = []; state.pool = []; state.poolMaxFF = null; state.poolExhausted = false; state.poolFetched = 0; state.band = 0; state.scanned = 0; state.checked = 0; await save(); tell('Shortlist and FF samples reset. Independent ID progress and opened targets retained.');
    }));
    button('Restart ID search', more, event => action(event, async () => {
      state.scan = null; state.rows = []; state.pending = []; state.deferred = []; state.deferredUntil = {}; state.checked = 0; state.scanned = 0; await save(); tell('ID progress reset. Previously checked IDs may return; opened targets remain excluded.');
    }));
    button('Clear opened history', more, event => action(event, async () => { state.used = []; await save(); tell('Opened history cleared; previously opened targets may appear again.'); }));
    button('Clear saved targets', more, event => action(event, async () => { state.saved = []; state.savedCursor = 0; await save(); tell('Saved target library cleared. The current shortlist and search progress remain.'); }));
    button('Clear all local data', more, event => action(event, async () => {
      apiKey = ''; keySaved = false; remember.checked = false; keyInput.value = ''; await persistKey(KEY, ''); state = emptyState(); await save();
      logEpoch++; logs = []; void flushLogs();
      for (const k of Object.keys(DEFAULTS)) if (fields[k].type === 'checkbox') fields[k].checked = DEFAULTS[k] === '1'; else fields[k].value = DEFAULTS[k];
      tell('Scouting key, filters and target history cleared.');
    }));
    element('p', 'Fair fight comes from FFScouter and is relative to its key owner. Maximum FF and both stat limits always apply; unknown FF/stats never qualify. Status may change after a check. TF checks up to ten queued profiles and opens at most one attack page per tap. Opened means visited, not attacked.', more);
    const results = element('details', undefined, panel); element('summary', 'Ready targets', results);
    list = element('div', undefined, results);
    const savedSection = element('details', undefined, panel);
    savedSummary = element('summary', 'Saved targets', savedSection);
    button('Recheck saved targets', savedSection, event => action(event, recheckSaved));
    savedList = element('div', undefined, savedSection);
    mountProfileSettings();
    if (window.location.pathname === '/profiles.php') {
      const observer = new MutationObserver(mountProfileSettings);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden && busy) stop(); else if (!document.hidden) mountProfileSettings(); });
    window.addEventListener('blur', () => { if (busy) stop(); });
    window.addEventListener('focus', mountProfileSettings);
    render();
  }
  async function start() {
    let storageError = false;
    try {
      state = decodeState(await readStorage(STORE));
      const stored = await readStorage(KEY);
      if (typeof stored === 'string' && /^[a-zA-Z0-9]{16}$/.test(stored) && state.owner) { apiKey = stored; keySaved = true; }
    } catch { state = emptyState(); apiKey = ''; keySaved = false; storageError = true; }
    // Delete only this helper's obsolete key copy, leaving the BSP script and
    // provider registration alone. Cleanup failure preserves TF data.
    let retiredKeyError = false;
    try { if (await readStorage(LEGACY_BSP_KEY)) await persistKey(LEGACY_BSP_KEY, ''); }
    catch { retiredKeyError = true; }
    makeUI();
    // Diagnostics are secondary: neither startup nor navigation waits for them.
    // Merge with any new events; a deliberate clear prevents old history returning.
    const epoch = logEpoch;
    void readStorage(LOG_STORE).then(storedLogs => {
      if (epoch !== logEpoch) return;
      if (typeof storedLogs !== 'string' || storedLogs.length > 250000) throw Error('Invalid diagnostic history');
      const decoded = storedLogs ? JSON.parse(storedLogs) : [];
      const older = Array.isArray(decoded) ? decoded.slice(-120).map(cleanLog).filter(Boolean) : [];
      logs = trimLogs([...older, ...logs]); renderLogs();
    }).catch(() => { logStorageError = true; renderLogs(); });
    if (retiredKeyError) tell('BSP requests are disabled, but its old key copy could not be erased. Clear the obsolete sr_halloween_bsp_key_v1 entry in this script storage.');
    if (storageError) tell('Saved data could not be read. Reconnect your key and start a fresh search.');
  }
  start();
})();
