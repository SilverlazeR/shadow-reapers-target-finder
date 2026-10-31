import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../shadow-reapers-target-finder.user.js', import.meta.url), 'utf8');
const STORE = 'sr_halloween_targets_v1', KEY = 'sr_halloween_key_v1';
const NOW = 1792972800, DAY = 86400, TEST_KEY = 'A123456789012345';
const raw = (id = 123, extra = {}) => ({ player_id: id, name: 'Player ' + id, bs_estimate: 10e6, fair_fight: 2.5, bss_public_timestamp: NOW - DAY, ...extra });
const torn = (id = 123, extra = {}) => ({ player_id: id, name: 'Player ' + id, last_action: { timestamp: NOW - 400 * DAY }, faction: { faction_id: 0, faction_name: 'None' }, status: { state: 'Okay' }, ...extra });
const settle = () => new Promise(resolve => setImmediate(resolve));
function node(tag = 'div') {
  const events = {};
  return { tagName: tag.toUpperCase(), children: [], attrs: {}, textContent: '', value: '', hidden: false, checked: false,
    classList: { add() {} }, focus() {}, select() { this.selected = true; }, setSelectionRange() {},
    append(...nodes) { this.children.push(...nodes); for (const n of nodes) { n.parentElement = this; n.isConnected = true; } },
    after(n) { if (n.parentElement) n.parentElement.children = n.parentElement.children.filter(x => x !== n); const p = this.parentElement; p.children.splice(p.children.indexOf(this) + 1, 0, n); n.parentElement = p; n.isConnected = true; },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, addEventListener(k, fn) { events[k] = fn; },
    attachShadow() { this.shadow = node('shadow'); return this.shadow; },
    dispatch(type, e = {}) { return events[type]?.({ isTrusted: true, currentTarget: this, ...e }); } };
}
async function fixture({ kind = 'pda', store = {}, respond, page = '/index.php', discovery = 'ff', sort = 'ff-desc', registration = true, sourceEncoding = 'utf8', dropKeyWrites = false, logRead } = {}) {
  const body = node('body'), windowEvents = {}, docEvents = {}, requests = [], posts = [], navigations = [], writes = [], timers = new Map();
  let focused = true, clock = NOW * 1000, serial = 0, aborts = 0;
  const pageURL = new URL(page, 'https://www.torn.com'), title = node('header'), topLinks = node('div');
  if (pageURL.pathname === '/profiles.php') { title.append(topLinks); body.append(title); }
  const response = (url, body) => url.pathname.endsWith('/check-key') && registration !== null ? { is_registered: registration } : respond ? respond(url, body) : url.hostname === 'ffscouter.com' ? { targets: [raw()] } : torn(Number(url.pathname.split('/').pop()) || 999);
  const transport = async (urlText, headers, body) => {
    const url = new URL(urlText); requests.push(url);
    if (body) posts.push({ url, body: JSON.parse(body), headers });
    const data = await response(url, body ? JSON.parse(body) : undefined);
    return data?.responseText !== undefined ? data : { status: 200, responseText: JSON.stringify(data) };
  };
  const get = async k => k === 'sr_halloween_logs_v1' && logRead ? logRead() : store[k] || '', set = async (k, v) => { if (!(dropKeyWrites && k.endsWith('_key_v1'))) store[k] = v; writes.push({ k, v }); };
  const context = { URL, URLSearchParams, console, Number, Date: class extends Date { static now() { return clock; } },
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); if (ms <= 1500) setImmediate(() => { if (timers.delete(id)) { clock += ms; fn(); } }); return id; },
    clearTimeout(id) { timers.delete(id); },
    MutationObserver: class { observe() {} },
    document: { body, hidden: false, hasFocus: () => focused, querySelector: s => pageURL.pathname !== '/profiles.php' ? null : s === '.content-title' ? title : s === '#top-page-links-list' ? topLinks : null, createElement: node, createTextNode: text => ({ textContent: text }), addEventListener: (k, fn) => { docEvents[k] = fn; } },
    window: { location: { pathname: pageURL.pathname, search: pageURL.search, assign: url => {
      const target = new URL(url);
      assert.equal(target.origin, 'https://www.torn.com'); assert.equal(target.pathname, '/page.php', 'Use the current attack route, not retired loader.php');
      assert.equal(target.searchParams.get('sid'), 'attack');
      navigations.push(url);
    } }, addEventListener: (k, fn) => { windowEvents[k] = fn; } },
    localStorage: { getItem: k => store[k] || '', setItem: (k, v) => { store[k] = v; writes.push({ k, v }); } } };
  context.window.self = context.window.top = context.window;
  if (kind === 'pda') { context.PDA_storage = { get, set }; context.PDA_httpGet = transport; context.PDA_httpPost = transport; }
  if (kind === 'gm') {
    context.GM_getValue = get; context.GM_setValue = set;
    context.GM_xmlhttpRequest = options => { assert.ok(['GET', 'POST'].includes(options.method)); assert.equal(options.anonymous, true); transport(options.url, options.headers, options.data).then(options.onload, options.onerror); return { abort() { aborts++; } }; };
  }
  const imported = Buffer.from(source, 'utf8').toString(sourceEncoding);
  const instrumented = imported.replace(/  start\(\);\s*\}\)\(\);\s*$/, `
    globalThis.helper = { filters, candidate, profile, matches, sorted, searchURL, decodeState, getState: () => state,
      getKey: () => apiKey, getFields: () => fields, getPanel: () => panel, getNotice: () => notice.textContent,
      getTargetButton: () => targetButton, getPopup: () => root.children.find(n => n.className === 'toast'), getKeyStatus: () => keyStatus.textContent,
      getKeyInput: () => keyInput, getConsent: () => consent, getRemember: () => remember,
      scanID, selectedStats, ready, stop, keepPool, rememberTarget, logReport, logEvent, flushLogs, isDeferred,
      getLogPanel: () => logPanel, getLogHint: () => logHint.textContent, getLogText: () => logText, getLogIdentity: () => logIdentity };
    globalThis.started = start();
  })();`);
  assert.notEqual(instrumented, source); vm.runInNewContext(instrumented, context); await context.started; await settle();
  if (!store[STORE]) { context.helper.getState().config.discovery = discovery; context.helper.getFields().discovery.value = discovery; }
  // Older tests pin the fair-fight order they were written for; pass sort: null for the v0.4.2 default.
  if (!store[STORE] && sort) { context.helper.getState().config.sort = sort; context.helper.getFields().sort.value = sort; }
  const all = parent => [parent, ...(parent.children || []).flatMap(all), ...(parent.shadow ? all(parent.shadow) : [])];
  const button = text => all(body).find(n => n.tagName === 'BUTTON' && (n.textContent === text || text === 'TF' && n.textContent.startsWith('TF\n')));
  const click = async text => { const b = button(text); assert.ok(b, 'button ' + text); await b.dispatch('click'); await settle(); };
  return { h: context.helper, context, store, requests, posts, navigations, writes, timers, button, click, body, title, topLinks, aborts: () => aborts,
    async connect(remember = false) { context.helper.getKeyInput().value = TEST_KEY; context.helper.getConsent().checked = true; context.helper.getRemember().checked = remember; await click('Connect key'); },
    async config(changes) { for (const [k, v] of Object.entries(changes)) context.helper.getFields()[k].value = String(v); await click('Save settings'); },
    blur() { focused = false; windowEvents.blur?.(); }, focus() { focused = true; }, advance(ms) { clock += ms; },
    expire() { for (const [id, timer] of timers) if (timer.ms === 20000) { timers.delete(id); timer.fn(); } } };
}

test('defaults, numeric range suffixes and unknown evidence fail closed', async () => {
  const f = await fixture({ discovery: 'torn' }), h = f.h, config = h.getState().config;
  assert.equal(config.discovery, 'torn');
  assert.equal(config.days, '365'); assert.equal(f.requests.length, 0);
  const filters = h.filters({ ...config, minStats: '1m', maxStats: '20M', faction: 'none' });
  const row = h.profile(h.candidate(raw()), torn());
  assert.equal(h.matches(row, filters, NOW), true);
  assert.equal(h.matches({ ...row, lastAction: NOW - 365 * DAY + 1 }, filters, NOW), false);
  assert.equal(h.matches({ ...row, lastAction: NOW - 365 * DAY }, filters, NOW), true);
  for (const lastAction of [null, NOW + 1]) assert.equal(h.matches({ ...row, lastAction }, filters, NOW), false);
  for (const rawValue of [null, '', false, '10000000']) assert.equal(h.candidate(raw(123, { bs_estimate: rawValue })), null);
  assert.equal(h.candidate(raw(123, { fair_fight: null })), null);
  assert.equal(h.matches({ ...row, faction: null }, filters, NOW), false);
  assert.equal(h.matches({ ...row, faction: 24884 }, filters, NOW), false);
  assert.equal(h.matches({ ...row, status: 'Hospital' }, filters, NOW), false);
  assert.throws(() => h.profile(row, torn(456)), /different/);
  assert.throws(() => h.filters({ ...config, minStats: '20m', maxStats: '1m' }), /Minimum/);
  assert.throws(() => h.filters({ ...config, days: '' }), /Inactive/);
});

test('faction choices and FF sorting work independently of inactivity sorting', async () => {
  const { h } = await fixture(), base = h.profile(h.candidate(raw()), torn()), config = h.getState().config;
  assert.equal(h.matches({ ...base, faction: 999 }, h.filters({ ...config, faction: 'yes' }), NOW), true);
  assert.equal(h.matches(base, h.filters({ ...config, faction: 'yes' }), NOW), false);
  const rows = [base, { ...base, id: 456, ff: 1.5, lastAction: NOW - 800 * DAY }];
  assert.equal(h.sorted(rows, h.filters(config))[0].id, 123);
  assert.equal(h.sorted(rows, h.filters({ ...config, sort: 'ff-asc' }))[0].id, 456);
  assert.equal(h.sorted(rows, h.filters({ ...config, sort: 'inactive' }))[0].id, 456);
});

test('search uses only documented filters with bounded level bands, no invented pagination', async () => {
  const { h } = await fixture();
  const u = new URL(h.searchURL(TEST_KEY, { ...h.getState().config, faction: 'none' }, 0));
  assert.equal(u.searchParams.get('limit'), '50'); assert.equal(u.searchParams.get('minlevel'), '91');
  assert.equal(u.searchParams.get('maxlevel'), '100'); assert.equal(u.searchParams.get('factionless'), '1');
  assert.equal(u.searchParams.get('inactiveonly'), '1'); assert.equal(u.searchParams.has('offset'), false);
  assert.equal(new URL(h.searchURL(TEST_KEY, { ...h.getState().config, days: '7' }, 9)).searchParams.get('inactiveonly'), '0');
  assert.throws(() => h.searchURL(TEST_KEY, h.getState().config, 10), /finished/);
});

for (const kind of ['pda', 'gm']) test(kind + ': searches only on trusted input; TF opens exactly one verified target and persists exclusion', async () => {
  const f = await fixture({ kind });
  await f.connect(true);
  assert.equal(f.store[KEY], TEST_KEY);
  await f.button('Find / check more').dispatch('click', { isTrusted: false }); assert.equal(f.requests.length, 2);
  await f.click('Find / check more'); assert.equal(f.h.ready().length, 1);
  assert.equal(f.requests.length, 4); assert.equal(f.navigations.length, 0);
  assert.equal(f.store[STORE].includes(TEST_KEY), false);
  await f.click('TF');
  assert.deepEqual(f.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=123']);
  assert.deepEqual(JSON.parse(f.store[STORE]).used, [123]);
  const reload = await fixture({ kind, store: f.store });
  assert.equal(reload.requests.length, 0); assert.equal(reload.h.ready().length, 0);
  assert.equal(reload.h.getKey(), TEST_KEY);
  await reload.click('TF'); assert.equal(reload.navigations.length, 0);
});

test('key stays in memory by default and reconnecting the same owner preserves shortlist', async () => {
  const f = await fixture(); await f.connect(); await f.click('Find / check more');
  assert.equal(f.store[KEY], ''); assert.equal(f.store[STORE].includes(TEST_KEY), false);
  const reload = await fixture({ store: f.store }); assert.equal(reload.h.getKey(), '');
  await reload.connect(); assert.equal(reload.h.ready().length, 1);
  await reload.click('Forget key'); assert.equal(reload.h.getKey(), ''); assert.equal(reload.store[KEY], '');
});

test('fresh profile checks skip changed faction/status and open only the next verified queued target', async () => {
  let checks = 0;
  const f = await fixture({ respond: url => {
    if (url.hostname === 'ffscouter.com') return { targets: [raw(123), raw(456, { fair_fight: 2 })] };
    const id = Number(url.pathname.split('/').pop()) || 999;
    if (id === 123 && ++checks > 1) return torn(123, { faction: { faction_id: 99 }, status: { state: 'Hospital' } });
    return torn(id);
  } });
  await f.connect(); await f.config({ faction: 'none' }); await f.click('Find / check more');
  await f.click('TF'); assert.equal(f.navigations.length, 1); assert.match(f.navigations[0], /user2ID=456$/);
  assert.deepEqual([...f.h.getState().used], [456]);
  assert.equal(f.requests.filter(u => u.pathname === '/user/456').length, 2);
});

test('a batch checks at most ten profiles; duplicate, self and missing-stat candidates are discarded', async () => {
  const f = await fixture({ respond: url => url.hostname === 'ffscouter.com'
    ? { targets: [...Array.from({ length: 15 }, (_, i) => raw(i + 1)), raw(1), raw(999), raw(50, { bs_estimate: null })] }
    : torn(Number(url.pathname.split('/').pop()) || 999) });
  await f.connect(); await f.click('Find / check more');
  assert.equal(f.h.getState().checked, 10); assert.equal(f.h.getState().pending.length, 5);
  assert.equal(f.requests.filter(u => u.pathname.endsWith('/get-targets')).length, 1);
  await f.click('Find / check more'); assert.equal(f.h.getState().checked, 15);
  assert.equal(f.requests.filter(u => u.pathname.endsWith('/get-targets')).length, 1);
});

test('rate limits pause without retry; invalid keys are erased and raw error text is not displayed', async () => {
  let fail = true;
  const f = await fixture({ respond: url => url.hostname === 'ffscouter.com'
    ? { status: fail ? 429 : 401, responseText: JSON.stringify({ code: fail ? 21 : 6, error: TEST_KEY, retry_after_seconds: 120 }) }
    : torn(999) });
  await f.connect(true); await f.click('Find / check more');
  assert.match(f.h.getNotice(), /rate limit/); assert.equal(f.h.getNotice().includes(TEST_KEY), false);
  const count = f.requests.length; await f.click('Find / check more'); assert.equal(f.requests.length, count);
  // FFScouter code 6 is kept once (it can be transient) and erased when it repeats.
  fail = false; f.h.getState().cooldown = 0; await f.click('Find / check more');
  assert.equal(f.h.getKey(), TEST_KEY); assert.equal(f.store[KEY], TEST_KEY); assert.match(f.h.getNotice(), /kept for now/);
  await f.click('Find / check more');
  assert.equal(f.h.getKey(), ''); assert.equal(f.store[KEY], ''); assert.equal(f.h.getNotice().includes(TEST_KEY), false);
});

test('only wrong keys are erased; usable-later Torn keys stay saved with a specific reason', async () => {
  for (const [code, reason] of [[10, /federal jail/], [13, /inactive/], [16, /access level/], [18, /paused/]]) {
    let block = false;
    const f = await fixture({ respond: url => url.hostname === 'ffscouter.com' ? { targets: [raw()] }
      : block ? { error: { code, error: 'raw text ' + TEST_KEY } } : torn(999) });
    await f.connect(true); block = true; await f.click('Find / check more');
    assert.equal(f.h.getKey(), TEST_KEY, 'code ' + code); assert.equal(f.store[KEY], TEST_KEY);
    assert.match(f.h.getNotice(), reason); assert.match(f.h.getNotice(), /key is kept/); assert.equal(f.h.getNotice().includes(TEST_KEY), false);
  }
  let wrong = false;
  const f = await fixture({ respond: url => url.hostname === 'ffscouter.com' ? { targets: [raw()] } : wrong ? { error: { code: 2, error: 'Incorrect key' } } : torn(999) });
  await f.connect(true); wrong = true; await f.click('Find / check more');
  assert.equal(f.h.getKey(), ''); assert.equal(f.store[KEY], ''); assert.match(f.h.getNotice(), /removed/);
});

test('blur cancels pending discovery and stale responses never populate targets or navigate', async () => {
  let resolve;
  const f = await fixture({ kind: 'gm', respond: url => url.hostname === 'ffscouter.com'
    ? new Promise(r => { resolve = r; }) : torn(999) });
  await f.connect(); const searching = f.click('Find / check more'); await settle();
  f.blur(); await searching; assert.equal(f.aborts(), 1);
  resolve({ targets: [raw()] }); await settle();
  assert.equal(f.h.getState().rows.length, 0); assert.equal(f.h.getState().band, 0); assert.equal(f.navigations.length, 0);
});

test('PDA requests time out and allow a deliberate retry without accepting late responses', async () => {
  let resolve;
  const f = await fixture({ respond: url => url.hostname === 'ffscouter.com'
    ? new Promise(r => { resolve = r; }) : torn(999) });
  await f.connect(); const searching = f.click('Find / check more'); await settle(); f.expire(); await searching;
  assert.match(f.h.getNotice(), /timed out/); assert.equal(f.button('Find / check more').disabled, false);
  resolve({ targets: [raw()] }); await settle(); assert.equal(f.h.getState().band, 0);
});

test('filter changes reset candidates without clearing opened history; sort-only changes retain pool', async () => {
  const f = await fixture(); await f.connect(); await f.click('Find / check more');
  await f.config({ sort: 'inactive' }); assert.equal(f.h.ready().length, 1);
  await f.click('TF'); await f.config({ days: '180', maxStats: '20m' });
  assert.equal(f.h.getState().rows.length, 0); assert.equal(f.h.getState().band, 0);
  assert.deepEqual(JSON.parse(f.store[STORE]).used, [123]);
});

test('missing profile evidence stays unknown; wrong identity and corrupt persistence fail closed', async () => {
  const f = await fixture({ respond: url => url.hostname === 'ffscouter.com' ? { targets: [raw()] }
    : torn(Number(url.pathname.split('/').pop()) || 999, { last_action: {}, faction: {} }) });
  await f.connect(); await f.click('Find / check more'); assert.equal(f.h.ready().length, 0);
  const saved = JSON.parse(f.store[STORE]); saved.rows[0].id = '123&foo=1';
  assert.throws(() => f.h.decodeState(JSON.stringify(saved)), /invalid/);
  const corrupt = await fixture({ store: { [STORE]: 'broken' } });
  assert.equal(corrupt.h.ready().length, 0); assert.match(corrupt.h.getNotice(), /could not be read/);
});

test('settings mount in own profile header and open inline; other pages have only the target dock', async () => {
  const f = await fixture({ page: '/profiles.php?XID=999' });
  const settings = f.button('TF Settings'); assert.ok(settings);
  assert.equal(f.topLinks.children[0].id, 'sr-target-finder-settings-button');
  assert.equal(f.body.children[1].id, 'sr-target-finder');
  assert.equal(f.h.getPanel().hidden, true); await f.click('TF Settings'); assert.equal(f.h.getPanel().hidden, false);
  await f.connect(true);
  const own = await fixture({ page: '/profiles.php?XID=999', store: f.store }); assert.ok(own.button('TF Settings'));
  const other = await fixture({ page: '/profiles.php?XID=123', store: f.store }); assert.equal(other.button('TF Settings'), undefined);
  const home = await fixture({ store: f.store }); assert.equal(home.button('TF Settings'), undefined);
  await home.click('TF'); assert.equal(home.h.getPanel().hidden, true); assert.equal(home.navigations.length, 1);
});


test('rebrand keeps the original storage names and single-run guard', () => {
  for (const name of ['sr_halloween_targets_v1', 'sr_halloween_key_v1', 'sr_halloween_search_budget_v1', 'sr_halloween_logs_v1', '__srHalloweenTargets'])
    assert.ok(source.includes(name), name);
  assert.doesNotMatch(source.split('// ==/UserScript==')[0], /Halloween/);
});

test('update metadata points to the main-branch script in this repository with a stable identity', () => {
  const header = source.split('// ==/UserScript==')[0];
  const metadata = Object.fromEntries([...header.matchAll(/^\/\/\s+@(\S+)\s+(.+)$/gm)].map(match => [match[1].toLowerCase(), match[2].trim()]));
  const download = new URL(metadata.downloadurl);
  assert.equal(metadata.name, 'Shadow Reapers Target Finder');
  assert.equal(metadata.namespace, 'https://shadowreapersfaction.com');
  assert.equal(metadata.version, '0.5.3');
  assert.equal(download.href, 'https://raw.githubusercontent.com/SilverlazeR/shadow-reapers-target-finder/main/shadow-reapers-target-finder.user.js');
  assert.equal(metadata.updateurl, download.href);
  assert.equal(download.search, '');
  assert.ok(download.pathname.endsWith('/main/shadow-reapers-target-finder.user.js'), 'Installs follow the main branch copy');
});

test('PDA Latin-1 import preserves the compact settings button, punctuation and disclosures', async () => {
  assert.equal(Buffer.from(source, 'utf8').toString('latin1'), source, 'Download must stay ASCII-only');
  const f = await fixture({ sourceEncoding: 'latin1', page: '/profiles.php?XID=999' });
  assert.ok(f.button('TF Settings'));
  const text = node => [node.textContent, ...(node.children || []).flatMap(text), ...(node.shadow ? text(node.shadow) : [])];
  const displayed = text(f.body).join('\n');
  assert.ok(displayed.includes('next target\u2019s attack page'));
  assert.ok(displayed.includes('Forget removes only this script\u2019s copy'));
  assert.ok(displayed.includes('I agree to FFScouter\u2019s terms'));
  await f.connect(); await f.click('Find / check more');
  assert.ok(text(f.body).join('\n').includes(' ready \u00b7 '));
});

test('data-use table is always visible above the key field, with provider policy links', async () => {
  const f = await fixture();
  const all = n => [n, ...(n.children || []).flatMap(all), ...(n.shadow ? all(n.shadow) : [])];
  for (const input of [f.h.getKeyInput()]) {
    const section = input.parentElement.parentElement, nodes = all(section);
    const table = nodes.find(n => n.tagName === 'TABLE'); assert.ok(table);
    assert.deepEqual(all(table).filter(n => n.tagName === 'TH').map(n => n.textContent),
      ['Data Storage', 'Data Sharing', 'Purpose of Use', 'Key Storage & Sharing', 'Key Access Level']);
    assert.ok(nodes.some(n => n.tagName === 'A' && /ffscouter.com|t=16290324/.test(n.href)));
    assert.ok(all(table).some(n => /Forget.*only this script/.test(n.textContent)));
    // Torn: the table must be clearly visible where the key is entered, never collapsed.
    assert.equal(table.parentElement, section); assert.equal(section.tagName, 'DETAILS'); assert.ok(section.open);
    assert.ok(section.children.indexOf(table) < section.children.indexOf(input.parentElement));
    assert.ok(all(table).some(n => /Send to leadership/.test(n.textContent)));
  }
});

test('main settings expose only three filters; advanced controls and target lists start collapsed', async () => {
  const f = await fixture({ page: '/profiles.php?XID=999' }), fields = f.h.getFields(), panel = f.h.getPanel();
  await f.click('TF Settings');
  assert.deepEqual(fields.grid.children.map(label => label.children[0].attrs['aria-label']),
    ['Maximum estimated stats', 'Inactive at least (days)', 'Faction']);
  for (const name of ['minStats', 'minFF', 'maxFF', 'ffPriority', 'discovery', 'minID', 'maxID', 'sort']) {
    const section = fields[name].parentElement.parentElement.parentElement;
    assert.equal(section.tagName, 'DETAILS'); assert.ok(!section.open);
    assert.equal(section.children[0].textContent, 'Advanced / troubleshooting');
  }
  for (const title of ['Advanced / troubleshooting', 'Ready targets', 'Saved targets (0/1000)']) {
    assert.ok(panel.children.some(n => n.tagName === 'DETAILS' && !n.open && n.children[0].textContent === title));
  }
  assert.ok(f.button('Find target')); assert.ok(f.button('Save settings'));
  assert.ok(panel.children.some(n => n.textContent.includes('FF 2 to 3')));
});

test('simple settings preserve existing hidden limits, saved keys and target history on reload', async () => {
  const f = await independentFixture(); await f.config({ minStats: '2m', maxStats: '50m', minFF: '2', maxFF: '2.8', ffPriority: 'strict', sort: 'ff-asc' });
  await f.click('Find / check more'); const savedCount = f.h.getState().saved.length;
  const reload = await fixture({ store: f.store, respond: independentResponse });
  reload.h.getFields().days.value = '370'; await reload.click('Save settings');
  for (const key of ['minStats', 'minFF', 'maxFF', 'ffPriority', 'sort', 'minID', 'maxID']) {
    assert.equal(reload.h.getState().config[key], f.h.getState().config[key], key);
  }
  assert.equal(reload.h.getState().saved.length, savedCount); assert.equal(reload.h.getKey(), TEST_KEY);
  assert.equal(reload.requests.length, 0);
});

test('Find target saves a tighter visible stat cap before considering cached targets', async () => {
  const f = await independentFixture(); await f.config({ maxID: '100', maxStats: '50m' }); await f.click('Restart ID search');
  await f.click('Find / check more'); assert.equal(f.h.ready().length, 1);
  f.h.getFields().maxStats.value = '5m'; await f.click('Find target');
  assert.equal(f.h.getState().config.maxStats, '5m'); assert.equal(f.navigations.length, 0);
  assert.equal(f.h.ready().length, 0); assert.equal(f.h.getState().saved.length, 1);
  f.h.getFields().maxStats.value = '15m'; await f.click('Find target');
  assert.deepEqual(f.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=100']);
});

test('Find target rejects invalid edits without requests and its working button cancels safely', async () => {
  let resolve;
  const f = await independentFixture({ respond: url => url.pathname === '/user/100'
    ? new Promise(r => { resolve = r; }) : independentResponse(url) });
  f.h.getFields().maxStats.value = 'bad'; const before = f.requests.length; await f.click('Find target');
  assert.equal(f.requests.length, before); assert.equal(f.navigations.length, 0);
  f.h.getFields().maxStats.value = '15m';
  await f.button('Find target').dispatch('click', { isTrusted: false }); assert.equal(f.requests.length, before);
  const pending = f.click('Find target');
  for (let i = 0; i < 100 && !resolve; i++) await settle();
  assert.ok(resolve); await f.click('Stop search'); await pending;
  resolve(torn(100)); await settle(); assert.equal(f.navigations.length, 0);
  assert.ok(f.button('Find target')); assert.equal(f.h.getState().scan.cursor, 0);
});

const BSP_KEY = 'sr_halloween_bsp_key_v1', BSP_TEST_KEY = 'B123456789012345';
const prediction = (extra = {}) => ({ Result: 1, TBS: 20e6, PredictionDate: '2026-10-24T00:00:00Z', ...extra });
function independentResponse(url) {
  if (url.hostname === 'ffscouter.com') return [raw(Number(url.searchParams.get('targets')), { last_updated: NOW - DAY })];
  if (url.hostname === 'www.lol-manager.com') return url.pathname.includes('/user/')
    ? { SubscriptionActive: true, SubscriptionEnd: '2027-01-01T00:00:00Z' } : prediction();
  return torn(Number(url.pathname.split('/').pop()) || 999);
}
async function independentFixture(options = {}) {
  const f = await fixture({ discovery: 'torn', respond: independentResponse, ...options });
  await f.connect(true); await f.config({ minID: '100', maxID: '124' });
  f.h.getState().scan = { min: 100, max: 124, offset: 0, cursor: 0 };
  return f;
}

test('independent discovery resumes across reloads and filter changes without repeating IDs or using FF target lists', async () => {
  const f = await independentFixture();
  await f.click('Find / check more'); assert.equal(f.h.getState().checked, 10);
  assert.equal(f.h.ready().length, 10); assert.equal(f.h.getState().scan.cursor, 10);
  assert.equal(f.requests.some(u => u.pathname.endsWith('/get-targets')), false);
  const reloaded = await fixture({ store: f.store, respond: independentResponse });
  await reloaded.config({ days: '380' }); assert.equal(reloaded.h.getState().scan.cursor, 10);
  await reloaded.click('Find / check more'); assert.equal(reloaded.h.getState().scan.cursor, 20);
  const ids = [f, reloaded].flatMap(x => x.requests.filter(u => /\/user\/\d+$/.test(u.pathname)).map(u => u.pathname));
  assert.equal(new Set(ids).size, 20);
  await reloaded.click('Clear shortlist'); assert.equal(reloaded.h.getState().scan.cursor, 20);
  await reloaded.click('Find / check more'); assert.equal(reloaded.h.getState().scan.cursor, 25);
  assert.match(reloaded.h.getNotice(), /range complete/);
  const count = reloaded.requests.length; await reloaded.click('Find / check more'); assert.equal(reloaded.requests.length, count);
});

test('only available inactive faction matches receive estimate lookups; invalid IDs advance and missing evidence excludes', async () => {
  const f = await independentFixture({ respond: url => {
    if (url.hostname !== 'api.torn.com') return independentResponse(url);
    const id = Number(url.pathname.split('/').pop()) || 999;
    if (id === 100) return { error: { code: 6, error: 'Incorrect ID' } };
    if (id <= 104) return torn(id, { status: { state: ['Hospital', 'Jail', 'Traveling', 'Abroad'][id - 101] } });
    if (id === 105) return torn(id, { last_action: { timestamp: NOW - DAY } });
    if (id === 106) return torn(id, { faction: { faction_id: 55 } });
    if (id === 107) return torn(id, { faction: {} });
    return torn(id);
  } });
  await f.config({ faction: 'none' }); await f.click('Find / check more');
  assert.equal(f.h.getState().scan.cursor, 10);
  assert.deepEqual(f.requests.filter(u => u.pathname.endsWith('/get-stats')).map(u => u.searchParams.get('targets')), ['108', '109']);
  assert.equal(f.h.ready().length, 2);
});

test('a failed profile does not consume its ID; cancelled profile cannot advance cursor', async () => {
  let fail = true;
  const f = await independentFixture({ respond: url => /\/user\/100$/.test(url.pathname) && fail
    ? { status: 503, responseText: JSON.stringify({ error: { code: 0 } }) } : independentResponse(url) });
  await f.click('Find / check more'); assert.equal(f.h.getState().scan.cursor, 0);
  fail = false; await f.click('Find / check more'); assert.equal(f.h.getState().scan.cursor, 10);
  let resolve;
  const stopped = await independentFixture({ respond: url => /\/user\/100$/.test(url.pathname) ? new Promise(r => { resolve = r; }) : independentResponse(url) });
  const searching = stopped.click('Find / check more'); await settle(); await settle(); stopped.blur(); await searching;
  resolve(torn(100)); await settle(); assert.equal(stopped.h.getState().scan.cursor, 0);
});

for (const kind of ['pda', 'gm']) test(kind + ': registration is consented, inline and check-first; registered keys are never reposted', async () => {
  let registered = false;
  const f = await fixture({ kind, registration: null, respond: (url, body) => {
    if (url.pathname.endsWith('/check-key')) return { is_registered: registered, policy_update_required: false };
    if (url.pathname.endsWith('/register')) { assert.deepEqual(body, { key: TEST_KEY, agree_to_data_policy: true, signup_source: 'SRTargetFinder' }); registered = true; return { success: true }; }
    return torn(999);
  } });
  f.h.getKeyInput().value = TEST_KEY;
  await f.click('Connect key'); assert.equal(f.requests.length, 0);
  await f.connect(true); assert.equal(f.posts.length, 1); assert.equal(f.h.getKey(), TEST_KEY);
  await f.connect(true); assert.equal(f.posts.length, 1);
  assert.equal(f.store[STORE].includes(TEST_KEY), false);
});

test('policy updates and provider bans stop connection without registration or leaking provider error text', async () => {
  for (const response of [{ is_registered: true, policy_update_required: true }, { status: 403, responseText: JSON.stringify({ code: 4010, error: TEST_KEY }) }]) {
    const f = await fixture({ registration: null, respond: url => url.hostname === 'ffscouter.com' ? response : torn(999) });
    await f.connect(); assert.equal(f.h.getKey(), ''); assert.equal(f.posts.length, 0); assert.equal(f.h.getNotice().includes(TEST_KEY), false);
  }
});

test('range changes still require explicit restart', async () => {
  const f = await independentFixture(); await f.click('Find / check more'); await f.config({ maxID: '200' });
  const count = f.requests.length; await f.click('Find / check more'); assert.equal(f.requests.length, count); assert.match(f.h.getNotice(), /Restart ID search/);
  await f.click('Restart ID search'); assert.equal(f.h.getState().scan, null);
});

for (const kind of ['pda', 'gm']) test(kind + ': TF discovers from an empty shortlist on own profile, rechecks and opens exactly one target without opening settings', async () => {
  const f = await independentFixture({ kind, page: '/profiles.php?XID=999' });
  assert.equal(f.h.ready().length, 0); assert.equal(f.h.getPanel().hidden, true);
  const before = f.requests.length;
  await f.button('TF').dispatch('click', { isTrusted: false }); assert.equal(f.requests.length, before);
  await f.click('TF');
  assert.equal(f.h.getState().checked, 1); assert.equal(f.h.getState().scan.cursor, 1);
  assert.deepEqual(f.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=100']);
  assert.equal(f.requests.filter(u => u.pathname === '/user/100').length, 2);
  assert.ok(f.requests.filter(u => u.pathname === '/user/100').at(-1).searchParams.has('timestamp'));
  assert.equal(f.h.getPanel().hidden, true);
});

test('TF missing key and API failure show only a button badge; details stay in settings', async () => {
  const f = await fixture({ page: '/profiles.php?XID=999' });
  await f.click('TF'); assert.equal(f.requests.length, 0); assert.equal(f.h.getPanel().hidden, true);
  assert.equal(f.h.getPopup(), undefined); assert.match(f.h.getNotice(), /connect/); assert.equal(f.button('TF').textContent, 'TF\n!');
  const failed = await independentFixture({ page: '/profiles.php?XID=999', respond: url => /\/user\/100$/.test(url.pathname)
    ? { status: 503, responseText: '{}' } : independentResponse(url) });
  await failed.click('TF'); assert.equal(failed.h.getPanel().hidden, true); assert.equal(failed.h.getPopup(), undefined);
  assert.match(failed.h.getNotice(), /request failed/); assert.equal(failed.navigations.length, 0);
  await failed.click('TF Settings'); assert.equal(failed.h.getPanel().hidden, false);
});

test('TF continues beyond ten rejects, explains exclusions and preserves filters', async () => {
  const f = await independentFixture({ page: '/profiles.php?XID=999', respond: url => {
    if (url.pathname.endsWith('/get-stats')) return [{ player_id: Number(url.searchParams.get('targets')), bs_estimate: null, fair_fight: null }];
    const id = Number(url.pathname.split('/').pop());
    if (url.hostname === 'api.torn.com' && id >= 100 && id <= 108) return torn(id, id === 108
      ? { status: { state: 'Hospital' } } : { last_action: { timestamp: NOW - DAY } });
    return independentResponse(url);
  } });
  const config = JSON.stringify(f.h.getState().config);
  await f.click('TF'); assert.equal(f.h.getState().checked, 25); assert.equal(f.h.getState().scan.cursor, 25);
  assert.match(f.h.getNotice(), /8 under 365 inactive days/); assert.match(f.h.getNotice(), /1 not Okay/); assert.match(f.h.getNotice(), /16 FF estimate missing/);
  assert.equal(f.h.getPanel().hidden, true); assert.equal(f.navigations.length, 0);
  const requests = f.requests.length; await settle(); assert.equal(f.requests.length, requests);
  assert.equal(JSON.stringify(f.h.getState().config), config);
  await f.click('TF'); assert.equal(f.h.getState().scan.cursor, 25); assert.equal(f.requests.length, requests);
});

for (const kind of ['pda', 'gm']) test(kind + ': TF reaches a valid target beyond the original ten-profile batch', async () => {
  const f = await independentFixture({ kind, respond: url => {
    const id = Number(url.pathname.split('/').pop());
    return url.hostname === 'api.torn.com' && id >= 100 && id < 115
      ? torn(id, { last_action: { timestamp: NOW - DAY } }) : independentResponse(url);
  } });
  await f.click('TF');
  assert.equal(f.h.getState().scan.cursor, 16);
  assert.deepEqual(f.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=115']);
  assert.equal(f.requests.filter(u => u.pathname.endsWith('/get-stats')).length, 1);
});

test('independent no-match search stops at 100 profiles and resumes only on another tap', async () => {
  const f = await independentFixture({ respond: url => url.hostname === 'api.torn.com'
    ? torn(Number(url.pathname.split('/').pop()) || 999, { status: { state: 'Hospital' } }) : independentResponse(url) });
  await f.config({ maxID: '399' });
  f.h.getState().scan = { min: 100, max: 399, offset: 0, cursor: 0 };
  await f.click('TF'); assert.equal(f.h.getState().scan.cursor, 100);
  assert.match(f.h.getNotice(), /100 not Okay/);
  const requests = f.requests.length; await settle(); assert.equal(f.requests.length, requests);
  assert.equal(f.requests.filter(u => u.pathname.endsWith('/get-stats')).length, 0);
  await f.click('TF'); assert.equal(f.h.getState().scan.cursor, 200);
  assert.equal(f.navigations.length, 0);
});

test('one backend-error ID is deferred without qualifying or blocking other profiles; manual retry survives reload', async () => {
  const f = await independentFixture({ respond: url => url.pathname === '/user/100'
    ? { error: { code: 17, error: TEST_KEY } } : independentResponse(url) });
  await f.click('TF');
  assert.deepEqual([...f.h.getState().deferred], [100]);
  assert.equal(f.h.getState().scan.cursor, 2);
  assert.deepEqual(f.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=101']);
  assert.equal(f.requests.filter(u => u.pathname === '/user/100').length, 1);
  assert.equal(f.h.getNotice().includes(TEST_KEY), false);
  const reloaded = await fixture({ store: f.store, respond: independentResponse });
  assert.deepEqual([...reloaded.h.getState().deferred], [100]);
  assert.equal(reloaded.requests.length, 0);
  await reloaded.click('Retry failed IDs');
  assert.deepEqual([...reloaded.h.getState().deferred], []);
  assert.ok(reloaded.h.ready().some(row => row.id === 100));
  assert.equal(reloaded.navigations.length, 0);
});

test('three consecutive backend errors stop with a cooldown; no key loss, retry loop or false checked profiles', async () => {
  const f = await independentFixture({ respond: url => /\/user\/\d+$/.test(url.pathname)
    ? { error: { code: 17 } } : independentResponse(url) });
  await f.click('TF');
  assert.equal(f.h.getState().scan.cursor, 3); assert.equal(f.h.getState().checked, 0);
  assert.deepEqual([...f.h.getState().deferred], [100, 101, 102]);
  assert.match(f.h.getNotice(), /three consecutive profiles/);
  assert.equal(f.h.getKey(), TEST_KEY); assert.equal(f.store[KEY], TEST_KEY);
  const requests = f.requests.length;
  await f.click('TF'); assert.equal(f.requests.length, requests); assert.match(f.h.getNotice(), /TF pause after Torn backend errors/);
  assert.equal(f.navigations.length, 0);
});

test('deferred retries retain IDs when estimates fail and continue to enforce hospital and stat filters', async () => {
  const f = await independentFixture({ respond: url => url.pathname.endsWith('/get-stats')
    ? { status: 503, responseText: '{}' } : independentResponse(url) });
  f.h.getState().deferred = [100];
  await f.click('Retry failed IDs'); assert.deepEqual([...f.h.getState().deferred], [100]);
  const reloaded = await fixture({ store: f.store, respond: url => url.pathname === '/user/100'
    ? torn(100, { status: { state: 'Hospital' } }) : independentResponse(url) });
  await reloaded.click('Retry failed IDs'); assert.equal(reloaded.h.ready().length, 0);
  assert.deepEqual([...reloaded.h.getState().deferred], []);
  assert.equal(reloaded.requests.filter(u => u.pathname.endsWith('/get-stats')).length, 0);
});

test('a code 17 during the final TF check defers that target and a new tap can open another', async () => {
  let checks = 0;
  const f = await independentFixture({ respond: url => url.pathname === '/user/100' && ++checks > 1
    ? { error: { code: 17 } } : independentResponse(url) });
  await f.click('Find / check more'); await f.click('TF'); assert.equal(f.navigations.length, 0);
  assert.deepEqual([...f.h.getState().deferred], [100]);
  assert.match(f.h.getNotice(), /Saved for manual retry/);
  assert.equal(f.h.getState().used.includes(100), false);
  await f.click('TF'); assert.deepEqual(f.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=101']);
  assert.equal(f.requests.filter(u => u.pathname === '/user/100').length, 2);
});

test('FF samples also move past code 17 and invalid IDs without treating them as targets', async () => {
  const f = await fixture({ respond: url => {
    if (url.pathname.endsWith('/get-targets')) return { targets: [raw(100), raw(101), raw(102)] };
    if (url.pathname === '/user/100') return { error: { code: 17 } };
    if (url.pathname === '/user/101') return { error: { code: 6 } };
    return independentResponse(url);
  } });
  await f.connect(true); await f.click('TF');
  assert.deepEqual([...f.h.getState().deferred], [100]);
  assert.deepEqual(f.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=102']);
});

test('extended search still stops immediately on blur after the tenth profile', async () => {
  let resolve;
  const f = await independentFixture({ respond: url => {
    if (url.pathname === '/user/110') return new Promise(r => { resolve = r; });
    if (url.hostname === 'api.torn.com') return torn(Number(url.pathname.split('/').pop()) || 999, { status: { state: 'Hospital' } });
    return independentResponse(url);
  } });
  const search = f.click('TF');
  for (let i = 0; i < 200 && !resolve; i++) await settle();
  assert.ok(resolve); f.blur(); await search; resolve(torn(110)); await settle();
  assert.equal(f.h.getState().scan.cursor, 10); assert.equal(f.navigations.length, 0);
  assert.equal(f.h.getState().pending.length, 0);
});

test('tapping the working TF button stops discovery without navigation and preserves the current ID', async () => {
  let resolve;
  const f = await independentFixture({ respond: url => url.pathname === '/user/100' ? new Promise(r => { resolve = r; }) : independentResponse(url) });
  const searching = f.click('TF'); await settle(); await settle();
  assert.equal(f.button('TF').disabled, false); assert.equal(f.button('TF').attrs['aria-busy'], 'true');
  assert.equal(f.h.getPopup(), undefined); assert.match(f.button('TF').textContent, /TF\n1/);
  await f.click('TF'); await searching;
  resolve(torn(100)); await settle();
  assert.equal(f.h.getState().scan.cursor, 0); assert.equal(f.navigations.length, 0); assert.match(f.h.getNotice(), /Paused/);
});

test('a hospitalized queue with no replacement never opens a target', async () => {
  let firstChecks = 0;
  const f = await independentFixture({ respond: url => url.pathname === '/user/100' && ++firstChecks > 1
    ? torn(100, { status: { state: 'Hospital' } }) : independentResponse(url) });
  await f.config({ maxID: '100' }); await f.click('Restart ID search');
  await f.click('Find / check more'); await f.click('TF'); assert.equal(f.navigations.length, 0); assert.match(f.h.getNotice(), /no longer match/);
  assert.equal(f.h.ready().length, 0); assert.equal(f.h.getPanel().hidden, true);
});

test('FF range is the default; an explicit lower-FF override retains all upper/stat/profile limits', async () => {
  const f = await fixture(), h = f.h;
  assert.equal(h.getState().config.ffPriority, 'strict');
  assert.equal(h.getState().config.minFF, '2');
  const config = { ...h.getState().config, ffPriority: 'available', minStats: '5m', maxStats: '15m', minFF: '2', maxFF: '3', faction: 'none' };
  const filters = h.filters(config), easy = h.profile(h.candidate(raw(123, { fair_fight: 1.1 })), torn());
  assert.equal(h.matches(easy, filters), true);
  assert.equal(h.matches(easy, h.filters({ ...config, ffPriority: 'strict' })), false);
  for (const change of [{ ff: 3.1 }, { ff: null }, { stats: null }, { stats: 16e6 }, { stats: 4e6 },
    { status: 'Hospital' }, { status: 'Unknown' }, { lastAction: null }, { lastAction: NOW - DAY }, { faction: 99 }]) {
    assert.equal(h.matches({ ...easy, ...change }, filters), false, JSON.stringify(change));
  }
  const url = new URL(h.searchURL(TEST_KEY, config, 0));
  assert.equal(url.searchParams.get('minff'), '1'); assert.equal(url.searchParams.get('maxff'), '3');
  assert.equal(new URL(h.searchURL(TEST_KEY, { ...config, ffPriority: 'strict' }, 0)).searchParams.get('minff'), '2');
  const old = h.getState(); delete old.config.ffPriority;
  assert.equal(h.decodeState(JSON.stringify(old)).config.ffPriority, 'strict');
});

for (const kind of ['pda', 'gm']) test(kind + ': explicit lower-FF override accepts an easy target but skips excessive or unknown difficulty', async () => {
  const estimates = { 100: { fair_fight: 3.1 }, 101: { bs_estimate: 30e6, fair_fight: 1.1 },
    102: { fair_fight: null }, 103: { bs_estimate: null }, 104: { fair_fight: 1.1 } };
  const f = await independentFixture({ kind, respond: url => url.pathname.endsWith('/get-stats')
    ? [raw(Number(url.searchParams.get('targets')), estimates[Number(url.searchParams.get('targets'))])] : independentResponse(url) });
  await f.config({ ffPriority: 'available', minStats: '5m', maxStats: '15m', minFF: '2', maxFF: '3' });
  await f.click('TF');
  assert.deepEqual(f.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=104']);
  assert.deepEqual([...f.h.getState().used], [104]);
  assert.equal(f.h.getState().config.maxStats, '15m'); assert.equal(f.h.getState().config.maxFF, '3');
});

test('queued availability fallback is bounded to ten checks per tap and resumes with the next target', async () => {
  let hospital = false;
  const f = await independentFixture({ respond: url => hospital && /^\/user\/10\d$/.test(url.pathname)
    ? torn(Number(url.pathname.split('/').pop()), { status: { state: 'Hospital' } }) : independentResponse(url) });
  await f.click('Find / check more'); await f.click('Find / check more'); hospital = true;
  const before = f.requests.length; await f.click('TF');
  assert.equal(f.requests.length - before, 10); assert.equal(f.navigations.length, 0);
  assert.equal(f.h.ready()[0].id, 110);
  await f.click('TF'); assert.deepEqual(f.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=110']);
});

test('blur during a queued replacement check prevents navigation and further requests', async () => {
  let hospital = false, resolve;
  const f = await independentFixture({ respond: url => hospital && url.pathname === '/user/100'
    ? torn(100, { status: { state: 'Hospital' } }) : hospital && url.pathname === '/user/101'
      ? new Promise(r => { resolve = r; }) : independentResponse(url) });
  await f.click('Find / check more'); hospital = true;
  const pending = f.click('TF');
  for (let i = 0; i < 100 && !resolve; i++) await settle();
  assert.ok(resolve); f.blur(); await pending;
  const before = f.requests.length; resolve(torn(101)); await settle();
  assert.equal(f.navigations.length, 0); assert.equal(f.requests.length, before);
  assert.equal(f.h.getState().used.length, 0);
});

for (const kind of ['pda', 'gm']) test(kind + ': saved key indicators and checkboxes survive reload; session keys can be explicitly saved without re-entry', async () => {
  const f = await fixture({ kind, respond: independentResponse });
  await f.connect();
  assert.equal(f.h.getKeyInput().value, '');
  assert.match(f.h.getKeyStatus(), /this page only/);
  const requests = f.requests.length;
  await f.click('Save key on device');
  assert.equal(f.requests.length, requests); assert.match(f.h.getKeyStatus(), /saved on this device/);
  const reload = await fixture({ kind, store: f.store });
  assert.equal(reload.h.getRemember().checked, true);
  assert.equal(reload.h.getKey(), TEST_KEY);
  assert.match(reload.h.getKeyStatus(), /saved on this device/);
  assert.equal(reload.requests.length, 0); assert.equal(reload.h.getKeyInput().value, '');
  await reload.click('Forget key'); assert.match(reload.h.getKeyStatus(), /Not connected/);
});

test('silent key-storage failures do not claim a key was saved and show the error beside its input', async () => {
  const f = await fixture({ dropKeyWrites: true }); await f.connect();
  await f.click('Save key on device');
  assert.match(f.h.getKeyStatus(), /this page only/); assert.match(f.h.getKeyStatus(), /could not be verified/);
  assert.equal(f.h.getRemember().checked, false); assert.ok(!f.store[KEY]);
  const fresh = await fixture({ dropKeyWrites: true }); await fresh.connect(true);
  assert.equal(fresh.h.getKey(), ''); assert.match(fresh.h.getKeyStatus(), /could not be verified/);
});

for (const kind of ['pda', 'gm']) test(kind + ': found targets persist after opening and can return from hospital through a manual availability recheck', async () => {
  let status = 'Okay';
  const respond = url => url.pathname === '/user/100' ? torn(100, { status: { state: status } }) : independentResponse(url);
  const f = await independentFixture({ kind, respond });
  await f.config({ maxID: '100' }); await f.click('Restart ID search'); await f.click('TF');
  assert.equal(f.h.getState().saved.length, 1); assert.ok(f.h.getState().saved[0].lastOpened);
  assert.equal(f.h.ready().length, 0);
  const reload = await fixture({ kind, store: f.store, respond });
  assert.equal(reload.requests.length, 0); assert.equal(reload.h.getState().saved[0].id, 100);
  status = 'Hospital'; await reload.click('Recheck saved targets');
  assert.equal(reload.h.ready().length, 0); assert.equal(reload.h.getState().saved[0].status, 'Hospital');
  assert.ok(reload.h.getState().used.includes(100));
  status = 'Okay'; await reload.click('Recheck saved targets');
  assert.equal(reload.h.ready()[0].id, 100); assert.equal(reload.h.getState().used.includes(100), false);
  assert.equal(reload.navigations.length, 0);
  assert.ok(reload.requests.every(url => url.hostname === 'api.torn.com' && url.searchParams.has('timestamp')));
  await reload.click('TF'); assert.deepEqual(reload.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=100']);
  assert.equal(reload.h.getState().saved.length, 1);
});

test('saved targets survive filter changes, shortlist clearing and scan restart but obey the current filters', async () => {
  const f = await independentFixture(); await f.click('Find / check more');
  assert.equal(f.h.getState().saved.length, 10);
  await f.config({ minStats: '50m' }); await f.click('Clear shortlist'); await f.click('Restart ID search');
  assert.equal(f.h.getState().saved.length, 10); assert.equal(f.h.ready().length, 0);
  await f.click('Recheck saved targets'); assert.equal(f.h.ready().length, 0);
  assert.match(f.h.getNotice(), /10 outside stat range/);
  await f.config({ minStats: '', faction: 'yes' }); await f.click('Recheck saved targets');
  assert.equal(f.h.ready().length, 0); assert.match(f.h.getNotice(), /10 faction filter/);
  await f.config({ faction: 'none' }); await f.click('Recheck saved targets'); assert.equal(f.h.ready().length, 10);
  assert.equal(f.navigations.length, 0);
  await f.click('Clear saved targets'); assert.equal(f.h.getState().saved.length, 0); assert.equal(f.h.ready().length, 10);
  const reload = await fixture({ store: f.store }); assert.equal(reload.h.getState().saved.length, 0);
});

test('saved rechecks cycle in bounded batches with persisted progress and no discovery or estimate requests', async () => {
  const f = await independentFixture();
  for (let i = 0; i < 3; i++) await f.click('Find / check more');
  assert.equal(f.h.getState().saved.length, 25); await f.click('Clear shortlist');
  const before = f.requests.length;
  await f.click('Recheck saved targets'); assert.equal(f.requests.length - before, 10);
  assert.equal(f.h.getState().savedCursor, 10);
  const reload = await fixture({ store: f.store, respond: independentResponse });
  await reload.click('Recheck saved targets');
  assert.deepEqual(reload.requests.map(u => Number(u.pathname.split('/').pop())), Array.from({ length: 10 }, (_, i) => 110 + i));
  assert.equal(reload.h.getState().savedCursor, 20); assert.equal(reload.navigations.length, 0);
});

test('upgrade imports known shortlist estimates, keeps exclusions, and validates library bounds and duplicates', async () => {
  const f = await independentFixture(); await f.click('Find / check more'); await f.click('TF');
  const old = JSON.parse(f.store[STORE]); delete old.saved; delete old.savedCursor;
  f.store[STORE] = JSON.stringify(old);
  const reload = await fixture({ store: f.store });
  assert.equal(reload.h.getState().saved.length, 10); assert.ok(reload.h.getState().used.includes(100));
  assert.equal(reload.h.ready().some(row => row.id === 100), false);
  const oversized = { ...old, saved: Array(1001).fill(old.rows[0]) };
  assert.throws(() => f.h.decodeState(JSON.stringify(oversized)), /library/);
  assert.throws(() => f.h.decodeState(JSON.stringify({ ...old, saved: [old.rows[0], old.rows[0]] })), /duplicates/);
});

test('saved rechecks require trusted input and cancellation never restores a stale target to ready', async () => {
  let checking = false, resolve;
  const f = await independentFixture({ respond: url => checking && url.pathname === '/user/100'
    ? new Promise(r => { resolve = r; }) : independentResponse(url) });
  await f.click('Find / check more'); const count = f.requests.length;
  await f.button('Recheck saved targets').dispatch('click', { isTrusted: false }); assert.equal(f.requests.length, count);
  checking = true; const recheck = f.click('Recheck saved targets');
  for (let i = 0; i < 100 && !resolve; i++) await settle();
  assert.ok(resolve); f.blur(); await recheck; resolve(torn(100)); await settle();
  assert.equal(f.h.getState().savedCursor, 0); assert.equal(f.h.getState().saved[0].status, 'Unverified');
  assert.equal(f.h.ready().some(row => row.id === 100), false); assert.equal(f.navigations.length, 0);
});

test('failed saved rechecks preserve profiles but do not rearm them, and the pause reason survives reload', async () => {
  let fail = false;
  const respond = url => fail && /\/user\/\d+$/.test(url.pathname) ? { error: { code: 17 } } : independentResponse(url);
  const f = await independentFixture({ respond }); await f.click('Find / check more');
  fail = true; await f.click('Recheck saved targets');
  assert.equal(f.h.getState().saved.length, 10); assert.equal(f.h.getState().savedCursor, 3);
  assert.ok(f.h.getState().saved.slice(0, 3).every(row => row.status === 'Unverified'));
  const reload = await fixture({ store: f.store, respond }); await reload.click('Recheck saved targets');
  assert.equal(reload.requests.length, 0); assert.match(reload.h.getNotice(), /TF pause after Torn backend errors/);
  assert.equal(reload.navigations.length, 0);
});

test('provider throttles and older unknown cooldowns are distinguished from TF backend-error pauses', async () => {
  const f = await fixture({ respond: url => url.hostname === 'ffscouter.com'
    ? { status: 429, responseText: JSON.stringify({ code: 21 }) } : torn(999) });
  await f.connect(true); await f.click('Find / check more');
  const reload = await fixture({ store: f.store }); await reload.click('TF');
  assert.match(reload.h.getNotice(), /FFScouter throttle\/block/); assert.equal(reload.requests.length, 0);
  const old = JSON.parse(f.store[STORE]); delete old.cooldownReason; f.store[STORE] = JSON.stringify(old);
  const unknown = await fixture({ store: f.store }); await unknown.click('TF');
  assert.match(unknown.h.getNotice(), /reason unavailable/); assert.equal(unknown.requests.length, 0);
});

test('TF uses an unopened saved match with one fresh Torn check and no new discovery or estimate requests', async () => {
  const f = await independentFixture(); await f.click('Find / check more'); await f.click('Clear shortlist');
  const start = f.requests.length;
  await f.click('TF');
  const requests = f.requests.slice(start);
  assert.equal(requests.length, 1); assert.equal(requests[0].pathname, '/user/100');
  assert.ok(requests[0].searchParams.has('timestamp'));
  assert.deepEqual(f.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=100']);
  assert.equal(f.h.getPopup(), undefined);
});

test('TF saved fast path skips hospital and opened targets and rechecks the next suitable saved profile', async () => {
  let hospital = false;
  const f = await independentFixture({ respond: url => hospital && url.pathname === '/user/101'
    ? torn(101, { status: { state: 'Hospital' } }) : independentResponse(url) });
  await f.click('Find / check more'); await f.click('TF'); await f.click('Clear shortlist');
  const start = f.requests.length; hospital = true; await f.click('TF');
  assert.deepEqual(f.requests.slice(start).map(u => u.pathname), ['/user/101', '/user/102']);
  assert.equal(f.navigations.length, 2); assert.match(f.navigations[1], /user2ID=102$/);
  assert.equal(f.h.getState().saved.find(row => row.id === 101).status, 'Hospital');
});

test('TF skips a recently hospitalized saved target across reloads, then checks it after one minute', async () => {
  let hospital = false;
  const respond = url => hospital && url.pathname === '/user/100'
    ? torn(100, { status: { state: 'Hospital' } }) : independentResponse(url);
  const f = await independentFixture({ respond }); await f.click('Find / check more'); await f.click('Clear shortlist');
  hospital = true; await f.click('TF');
  assert.match(f.navigations[0], /user2ID=101$/);
  const reload = await fixture({ store: f.store, respond });
  hospital = false; await reload.click('TF');
  assert.deepEqual(reload.requests.map(u => u.pathname), ['/user/102']);
  assert.match(reload.navigations[0], /user2ID=102$/);
  reload.advance(120000); const before = reload.requests.length;
  await reload.click('TF');
  assert.deepEqual(reload.requests.slice(before).map(u => u.pathname), ['/user/100']);
  assert.match(reload.navigations[1], /user2ID=100$/);
});

test('manual saved rechecks bypass the recent rejection cache and current filters reevaluate saved evidence', async () => {
  let hospital = false;
  const f = await independentFixture({ respond: url => hospital && url.pathname === '/user/100'
    ? torn(100, { status: { state: 'Hospital' } }) : independentResponse(url) });
  await f.click('Find / check more'); await f.click('Clear shortlist');
  hospital = true; await f.click('TF'); hospital = false;
  const before = f.requests.length; await f.click('Recheck saved targets');
  assert.equal(f.requests[before].pathname, '/user/100'); assert.equal(f.h.ready()[0].id, 100);
  assert.equal(f.navigations.length, 1);

  const changed = await independentFixture(); await changed.click('Find / check more');
  await changed.config({ faction: 'yes' }); await changed.click('Recheck saved targets');
  assert.equal(changed.h.ready().length, 0);
  await changed.config({ faction: 'none' }); const start = changed.requests.length;
  await changed.click('TF');
  assert.deepEqual(changed.requests.slice(start).map(u => u.pathname), ['/user/100']);
  assert.match(changed.navigations[0], /user2ID=100$/);
});

test('TF skips deferred saved IDs until a manual recheck retries them', async () => {
  let failed = false;
  const f = await independentFixture({ respond: url => failed && url.pathname === '/user/100'
    ? { error: { code: 17 } } : independentResponse(url) });
  await f.click('Find / check more'); await f.click('Clear shortlist');
  failed = true; await f.click('TF');
  assert.ok(f.h.getState().deferred.includes(100)); assert.match(f.navigations[0], /user2ID=101$/);
  failed = false; f.advance(120000); const before = f.requests.length;
  await f.click('TF');
  assert.deepEqual(f.requests.slice(before).map(u => u.pathname), ['/user/102']);
  const start = f.requests.length; await f.click('Recheck saved targets');
  assert.equal(f.requests[start].pathname, '/user/100');
  assert.equal(f.h.getState().deferred.includes(100), false); assert.equal(f.h.ready()[0].id, 100);
});

test('TF stops at its first discovered FF sample while Find continues building a sorted batch', async () => {
  const f = await fixture({ respond: url => url.pathname.endsWith('/get-targets')
    ? { targets: [raw(100, { fair_fight: 2 }), raw(101, { fair_fight: 3 }), raw(102)] } : independentResponse(url) });
  await f.connect(true); await f.click('TF');
  assert.equal(f.h.getState().checked, 1); assert.equal(f.h.getState().pending.length, 2);
  assert.match(f.navigations[0], /user2ID=100$/);
  await f.click('Find / check more'); assert.equal(f.h.getState().checked, 3);
  assert.equal(f.h.ready()[0].id, 101);
});

test('error details survive navigation into settings without a popup, and waits use a button badge', async () => {
  const f = await independentFixture({ respond: url => /\/user\/\d+$/.test(url.pathname)
    ? { error: { code: 17 } } : independentResponse(url) });
  await f.click('TF'); assert.equal(f.button('TF').textContent, 'TF\nWAIT'); assert.equal(f.h.getPopup(), undefined);
  const reload = await fixture({ store: f.store, page: '/profiles.php?XID=999' });
  await reload.click('TF Settings'); assert.match(reload.h.getNotice(), /three consecutive profiles/);
  assert.equal(reload.requests.length, 0); assert.equal(reload.h.getPopup(), undefined);
});

test('no-match badge stays compact and reports zero without opening settings', async () => {
  const f = await independentFixture({ respond: url => url.hostname === 'api.torn.com'
    ? torn(Number(url.pathname.split('/').pop()) || 999, { status: { state: 'Hospital' } }) : independentResponse(url) });
  await f.click('TF'); assert.equal(f.button('TF').textContent, 'TF\n0');
  assert.equal(f.button('TF').attrs['aria-busy'], 'false');
  assert.equal(f.h.getPopup(), undefined); assert.equal(f.h.getPanel().hidden, true);
});

function poolResponse(url) {
  if (url.pathname.endsWith('/get-targets')) return { targets: [raw(101, { fair_fight: 2.1 }), raw(102, { fair_fight: 2.8 }), raw(103, { fair_fight: 2.6 })] };
  return independentResponse(url);
}

for (const kind of ['pda', 'gm']) test(kind + ': automatic TF ranks a batch, skips hospital, and opens the first available candidate without a second profile request', async () => {
  const respond = url => url.pathname === '/user/102' ? torn(102, { status: { state: 'Hospital', until: NOW + 180 } }) : poolResponse(url);
  const f = await fixture({ kind, discovery: 'auto', respond }); await f.connect(true);
  await f.click('TF');
  assert.deepEqual(f.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=103']);
  assert.deepEqual(f.requests.filter(u => /^\/user\/10/.test(u.pathname)).map(u => u.pathname), ['/user/102', '/user/103']);
  assert.equal(f.h.getPanel().hidden, true); assert.equal(f.h.getPopup(), undefined);
  const query = f.requests.find(u => u.pathname.endsWith('/get-targets'));
  assert.equal(query.searchParams.get('maxff'), '3'); assert.equal(query.searchParams.has('minlevel'), false);
  const reload = await fixture({ kind, store: f.store, respond });
  assert.equal(reload.requests.length, 0, 'No unattended search on load');
  await reload.click('TF');
  assert.deepEqual(reload.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=101']);
  assert.equal(reload.requests.length, 1, 'Reuse batch and skip hospital/recently opened profiles');
  assert.equal(reload.store[STORE].includes(TEST_KEY), false);
});

test('automatic TF retries cached hospital release and previously opened targets only with fresh available evidence', async () => {
  let released = false;
  const f = await fixture({ discovery: 'auto', respond: url => url.pathname === '/user/102' && !released
    ? torn(102, { status: { state: 'Hospital', until: NOW + 180 } }) : poolResponse(url) });
  await f.connect(true); await f.click('TF'); await f.click('TF');
  released = true; f.advance(181000);
  const start = f.requests.length; await f.click('TF');
  assert.match(f.navigations.at(-1), /user2ID=102$/);
  assert.equal(f.requests.length - start, 1, 'Release is checked, not assumed');
  await f.click('TF'); assert.match(f.navigations.at(-1), /user2ID=103$/);
  assert.equal(f.h.getState().used.filter(id => id === 103).length, 1);
  assert.equal(f.requests.filter(u => u.pathname.endsWith('/get-targets')).length, 1);
});

test('automatic TF honors stat/FF limits, unknown estimates, inactivity and faction before opening', async () => {
  const f = await fixture({ discovery: 'auto', respond: url => {
    if (url.pathname.endsWith('/get-targets')) return { targets: [raw(101, { fair_fight: 4 }), raw(102, { bs_estimate: 50e6 }), raw(103, { bs_estimate: null }),
      raw(104, { fair_fight: 2.9 }), raw(105, { fair_fight: 2.8 }), raw(106, { fair_fight: 2.7 }), raw(107, { fair_fight: 2.6 })] };
    if (url.pathname === '/user/104') return torn(104, { last_action: { timestamp: NOW - DAY } });
    if (url.pathname === '/user/105') return torn(105, { faction: { faction_id: 88 } });
    if (url.pathname === '/user/106') return torn(106, { faction: {} });
    return independentResponse(url);
  } });
  await f.connect(); await f.config({ maxStats: '20m', faction: 'none' }); await f.click('TF');
  assert.deepEqual(f.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=107']);
  assert.equal(f.requests.some(u => ['/user/101', '/user/102', '/user/103'].includes(u.pathname)), false);
});

test('automatic TF moves its FF window, deduplicates, and keeps one navigation per tap', async () => {
  const f = await fixture({ discovery: 'auto', respond: url => {
    if (url.pathname.endsWith('/get-targets')) return { targets: Number(url.searchParams.get('maxff')) > 2.8
      ? [raw(102, { fair_fight: 2.8 }), raw(102, { fair_fight: 2.8 })]
      : [raw(103, { fair_fight: 2.6 })] };
    if (url.pathname === '/user/102') return torn(102, { status: { state: 'Hospital', until: NOW + 600 } });
    return independentResponse(url);
  } });
  await f.connect(); await f.click('TF');
  assert.deepEqual(f.requests.filter(u => u.pathname.endsWith('/get-targets')).map(u => u.searchParams.get('maxff')), ['3', '2.79']);
  assert.equal(f.requests.filter(u => u.pathname === '/user/102').length, 1);
  assert.equal(f.h.getState().pool.length, 2); assert.equal(f.navigations.length, 1);
});

test('automatic TF supplements an empty provider pool with independent discovery', async () => {
  const f = await fixture({ discovery: 'auto', respond: url => url.pathname.endsWith('/get-targets') ? { targets: [] } : independentResponse(url) });
  await f.connect(); await f.config({ minID: '100', maxID: '124' });
  f.h.getState().scan = { min: 100, max: 124, offset: 0, cursor: 0 };
  await f.click('TF'); assert.match(f.navigations[0], /user2ID=100$/);
  assert.equal(f.h.getState().scan.cursor, 1);
  assert.equal(f.requests.filter(u => u.pathname.endsWith('/get-targets')).length, 1);
});

for (const kind of ['pda', 'gm']) test(kind + ': automatic TF cancellation ignores a late profile and keeps it out of ready', async () => {
  let resolve;
  const f = await fixture({ kind, discovery: 'auto', respond: url => url.pathname === '/user/102'
    ? new Promise(r => { resolve = r; }) : poolResponse(url) });
  await f.connect(); const searching = f.click('TF');
  for (let i = 0; i < 10 && !resolve; i++) await settle();
  assert.ok(resolve); await f.click('TF'); await searching;
  const count = f.requests.length; resolve(torn(102)); await settle();
  assert.equal(f.navigations.length, 0); assert.equal(f.requests.length, count); assert.equal(f.h.ready().length, 0);
  assert.equal(f.h.getState().pool.find(row => row.id === 102).status, 'Unverified');
});

test('automatic TF stops on provider throttles and three backend errors without opening stale candidates', async () => {
  for (const throttled of [true, false]) {
    const f = await fixture({ discovery: 'auto', respond: url => url.pathname.endsWith('/get-targets') && throttled
      ? { status: 429, responseText: JSON.stringify({ code: 21 }) }
      : /^\/user\/10/.test(url.pathname) ? { error: { code: 17 } } : poolResponse(url) });
    await f.connect(); await f.click('TF');
    assert.equal(f.navigations.length, 0); assert.equal(f.button('TF').textContent, 'TF\nWAIT');
    const count = f.requests.length; await f.click('TF'); assert.equal(f.requests.length, count);
  }
});

test('pool migration selects the new flow while preserving filters and ID bounds; malformed pools fail closed', async () => {
  const f = await fixture({ discovery: 'torn' }); await f.connect(true);
  const old = JSON.parse(f.store[STORE]); delete old.poolVersion; delete old.pool;
  const migrated = f.h.decodeState(JSON.stringify(old));
  assert.equal(migrated.config.discovery, 'auto'); assert.equal(migrated.config.maxFF, old.config.maxFF);
  old.config.maxID = '500'; assert.equal(f.h.decodeState(JSON.stringify(old)).config.maxID, '500');
  old.config.discovery = 'ff'; assert.equal(f.h.decodeState(JSON.stringify(old)).config.discovery, 'auto');
  old.poolVersion = 1; assert.equal(f.h.decodeState(JSON.stringify(old)).config.discovery, 'ff');
  old.pool = Array.from({ length: 1001 }, (_, i) => f.h.candidate(raw(i + 1)));
  assert.throws(() => f.h.decodeState(JSON.stringify(old)), /pool is invalid/);
  old.pool = [f.h.candidate(raw()), f.h.candidate(raw())];
  assert.throws(() => f.h.decodeState(JSON.stringify(old)), /duplicates/);
});

test('automatic TF stops a fruitless tap after 20 checks, honors pacing, and never polls after completion', async () => {
  let batch = 0;
  const f = await fixture({ discovery: 'auto', respond: url => {
    if (url.pathname.endsWith('/get-targets')) {
      batch++;
      return { targets: Array.from({ length: 50 }, (_, i) => raw(batch * 1000 + i, { fair_fight: 3 - batch / 10 })) };
    }
    const id = Number(url.pathname.split('/').pop());
    return id ? torn(id, { status: { state: 'Hospital', until: NOW + 600 } }) : torn(999);
  } });
  await f.connect(); const before = f.requests.length; await f.click('TF');
  const checks = f.requests.slice(before).filter(u => u.hostname === 'api.torn.com');
  assert.equal(checks.length, 20, 'A tap stops after 20 checks, with no ID-search fallback'); assert.equal(f.navigations.length, 0);
  assert.equal(f.button('TF').textContent, 'TF\n0'); assert.match(f.h.getNotice(), /Checked 20 candidates; none were available/);
  assert.equal(batch, 4, 'One list to start, then a new list after each three hospital misses, at most three');
  assert.equal(f.h.getState().pool.length, 200);
  const summary = JSON.parse(f.store[LOG_STORE]).findLast(e => e.kind === 'summary');
  assert.equal(summary.counts.tapLimitReached, 1); assert.equal(summary.counts.earlyBatches, 3); assert.equal(summary.counts.rejectedHospital, 20);
  assert.ok(f.h.getState().nextTorn >= NOW * 1000 + 19 * 1250, '1.25-second Torn request spacing is retained');
  const count = f.requests.length; f.advance(600000); await settle(); assert.equal(f.requests.length, count);
});

for (const kind of ['pda', 'gm']) test(kind + ': upgrade fixes the screenshot settings and ignores a cached 1.01 FF target', async () => {
  const f = await fixture({ kind, discovery: 'auto' }); await f.connect(true);
  const old = JSON.parse(f.store[STORE]); delete old.ffOrderVersion;
  Object.assign(old.config, { minFF: '2', maxFF: '3', ffPriority: 'available', sort: 'inactive', maxStats: '20m', statSource: 'ff' });
  const easy = f.h.profile(f.h.candidate(raw(101, { fair_fight: 1.01 })), torn(101, { last_action: { timestamp: NOW - 7000 * DAY } }));
  old.pool = [easy]; old.rows = [easy]; old.saved = [easy]; old.poolMaxFF = 1.01; old.poolExhausted = true; old.poolFetched = NOW;
  old.used = [88]; f.store[STORE] = JSON.stringify(old);
  const reload = await fixture({ kind, store: f.store, respond: url => {
    if (url.pathname.endsWith('/get-targets')) return { targets: [raw(101, { fair_fight: 1.01 }), raw(102, { fair_fight: 2.9 }), raw(103, { fair_fight: 2.7 }), raw(104, { fair_fight: 3.2 })] };
    if (url.pathname === '/user/102') return torn(102, { status: { state: 'Hospital', until: NOW + 300 } });
    return independentResponse(url);
  } });
  assert.equal(reload.requests.length, 0); assert.equal(reload.h.getKey(), TEST_KEY);
  assert.equal(reload.h.getState().config.ffPriority, 'strict'); assert.equal(reload.h.getState().config.sort, 'ff-desc');
  assert.equal(reload.h.getState().config.maxStats, '20m'); assert.equal(reload.h.getState().config.statSource, undefined);
  await reload.click('TF');
  assert.deepEqual(reload.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=103']);
  const search = reload.requests.find(u => u.pathname.endsWith('/get-targets'));
  assert.equal(search.searchParams.get('minff'), '2'); assert.equal(search.searchParams.get('maxff'), '3');
  assert.equal(reload.requests.some(u => ['/user/101', '/user/104'].includes(u.pathname)), false);
  assert.ok(reload.h.getState().saved.some(row => row.id === 101), 'Keep cached evidence without treating it as eligible');
  assert.deepEqual([...reload.h.getState().used], [88, 103]);
});

test('upgrade ranks qualifying cached targets by FF instead of longest inactivity', async () => {
  const f = await fixture({ discovery: 'auto' }); await f.connect(true);
  const old = JSON.parse(f.store[STORE]); delete old.ffOrderVersion;
  old.config.sort = 'inactive'; old.config.ffPriority = 'available';
  old.pool = [f.h.profile(f.h.candidate(raw(101, { fair_fight: 2.1 })), torn(101, { last_action: { timestamp: NOW - 7000 * DAY } })),
    f.h.profile(f.h.candidate(raw(102, { fair_fight: 2.8 })), torn(102))];
  f.store[STORE] = JSON.stringify(old);
  const reload = await fixture({ store: f.store, respond: independentResponse }); await reload.click('TF');
  assert.deepEqual(reload.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=102']);
  assert.equal(reload.requests.length, 1);
});

test('no qualifying FF match never silently falls back to easy cached or independently discovered targets', async () => {
  const f = await fixture({ discovery: 'auto', respond: url => {
    if (url.pathname.endsWith('/get-targets')) return { targets: [] };
    if (url.pathname.endsWith('/get-stats')) return [raw(Number(url.searchParams.get('targets')), { fair_fight: 1.01 })];
    return independentResponse(url);
  } });
  await f.connect(); await f.config({ minID: '100', maxID: '108' });
  f.h.getState().scan = { min: 100, max: 108, offset: 0, cursor: 0 };
  const easy = f.h.profile(f.h.candidate(raw(123, { fair_fight: 1.01 })), torn());
  f.h.getState().pool = [easy]; f.h.getState().rows = [easy]; f.h.getState().saved = [easy];
  await f.click('TF');
  assert.equal(f.navigations.length, 0); assert.equal(f.h.ready().length, 0);
  assert.equal(f.requests.some(u => u.pathname === '/user/123'), false);
  assert.equal(f.h.getState().config.minFF, '2'); assert.equal(f.h.getState().config.maxFF, '3');
  assert.equal(f.button('TF').textContent, 'TF\n0');
});

test('FF migration runs once and preserves numerical limits and later deliberate preference changes', async () => {
  const f = await fixture(); await f.connect(true);
  const old = JSON.parse(f.store[STORE]); delete old.ffOrderVersion;
  Object.assign(old.config, { minFF: '1.5', maxFF: '1.8', ffPriority: 'available', sort: 'stats' });
  const migrated = f.h.decodeState(JSON.stringify(old));
  assert.equal(migrated.config.minFF, '1.5'); assert.equal(migrated.config.maxFF, '1.8');
  assert.equal(migrated.config.ffPriority, 'strict'); assert.equal(migrated.ffOrderVersion, 1);
  Object.assign(migrated.config, { ffPriority: 'available', sort: 'inactive' });
  const again = f.h.decodeState(JSON.stringify(migrated));
  assert.equal(again.config.ffPriority, 'available'); assert.equal(again.config.sort, 'inactive');
});

for (const kind of ['pda', 'gm']) test(kind + ': an TF tap on a retired loader error page opens the current attack route', async () => {
  const f = await fixture({ kind, page: '/loader.php?sid=attack&user2ID=88', discovery: 'auto', respond: poolResponse });
  assert.equal(f.requests.length, 0); assert.equal(f.navigations.length, 0, 'Never automatically redirect or retry');
  await f.connect(true); await f.click('TF');
  assert.deepEqual(f.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=102']);
  assert.equal(f.h.getPanel().hidden, true); assert.equal(f.h.getPopup(), undefined);
});

for (const kind of ['pda', 'gm']) test(kind + ': proven cached good-FF matches precede unverified profiles, keeping highest FF within the cache', async () => {
  const f = await fixture({ kind, discovery: 'auto', respond: independentResponse }); await f.connect(true);
  f.h.getState().pool = [f.h.candidate(raw(101, { fair_fight: 2.99 })),
    f.h.profile(f.h.candidate(raw(102, { fair_fight: 2.2 })), torn(102)),
    f.h.profile(f.h.candidate(raw(103, { fair_fight: 2.8 })), torn(103))];
  const start = f.requests.length; await f.click('TF');
  assert.deepEqual(f.navigations, ['https://www.torn.com/page.php?sid=attack&user2ID=103']);
  assert.equal(f.requests.length - start, 1, 'Only the fresh cached-profile check; no discovery/estimate requests');
  assert.equal(f.requests.at(-1).pathname, '/user/103');
});

for (const kind of ['pda', 'gm']) test(kind + ': persisted hospital timers suppress checks until release despite old shorter retry deadlines', async () => {
  const f = await fixture({ kind, discovery: 'auto' }); await f.connect(true);
  const stored = JSON.parse(f.store[STORE]);
  const hospital = f.h.profile(f.h.candidate(raw(102, { fair_fight: 2.9 })), torn(102, { status: { state: 'Hospital', until: NOW + 600 } }));
  hospital.retryAt = NOW + 300;
  stored.pool = [hospital, f.h.profile(f.h.candidate(raw(103, { fair_fight: 2.5 })), torn(103))];
  f.store[STORE] = JSON.stringify(stored);
  const reload = await fixture({ kind, store: f.store, respond: independentResponse });
  await reload.click('TF'); assert.match(reload.navigations[0], /user2ID=103$/);
  assert.equal(reload.requests.some(u => u.pathname === '/user/102'), false);
  reload.h.getState().pool.push(reload.h.profile(reload.h.candidate(raw(104)), torn(104)));
  reload.advance(61000); await reload.click('TF');
  assert.match(reload.navigations[1], /user2ID=104$/);
  assert.equal(reload.requests.some(u => u.pathname === '/user/102'), false, 'No one-minute hospital recheck');
  const start = reload.requests.length; reload.advance(540000); await settle();
  assert.equal(reload.requests.length, start, 'No unattended polling');
  await reload.click('TF'); assert.match(reload.navigations[2], /user2ID=102$/);
  assert.equal(reload.requests.length - start, 1); assert.ok(reload.requests.at(-1).searchParams.has('timestamp'));
});

test('an observed short hospital stay can end before the opened-target hold, but fresh evidence is still required', async () => {
  const f = await fixture({ discovery: 'auto', respond: independentResponse }); await f.connect();
  const hospital = f.h.profile(f.h.candidate(raw(102, { fair_fight: 2.9 })), torn(102, { status: { state: 'Hospital', until: NOW + 20 } }));
  hospital.lastOpened = NOW - 10; hospital.retryAt = NOW + 120;
  f.h.getState().used = [102];
  f.h.getState().pool = [hospital, f.h.profile(f.h.candidate(raw(103, { fair_fight: 2.5 })), torn(103))];
  const start = f.requests.length; f.advance(21000); await f.click('TF');
  assert.match(f.navigations[0], /user2ID=102$/); assert.equal(f.requests.length - start, 1);
  const after = f.requests.length; await f.click('TF');
  assert.match(f.navigations[1], /user2ID=103$/);
  assert.equal(f.requests.slice(after).some(u => u.pathname === '/user/102'), false, 'Opening again restores the duplicate-open hold');
});

test('an expired hospital timer never proves availability and a continuing stay schedules another bounded check', async () => {
  const f = await fixture({ discovery: 'auto', respond: url => url.pathname === '/user/102'
    ? torn(102, { status: { state: 'Hospital', until: NOW + 1000 } }) : independentResponse(url) });
  await f.connect();
  const hospital = f.h.profile(f.h.candidate(raw(102, { fair_fight: 2.9 })), torn(102, { status: { state: 'Hospital', until: NOW + 20 } }));
  hospital.retryAt = NOW + 300;
  f.h.getState().pool = [hospital, f.h.profile(f.h.candidate(raw(103, { fair_fight: 2.5 })), torn(103))];
  const start = f.requests.length; f.advance(21000); await f.click('TF');
  assert.deepEqual(f.requests.slice(start).map(u => u.pathname), ['/user/102', '/user/103']);
  assert.match(f.navigations[0], /user2ID=103$/);
  const updated = f.h.getState().pool.find(row => row.id === 102);
  assert.equal(updated.status, 'Hospital'); assert.equal(updated.statusUntil, NOW + 1000); assert.equal(updated.retryAt, updated.statusUntil);
});

test('skip boxes hold federal, fallen and travelling players until their bounded time; unticking resumes checks', async () => {
  const f = await fixture({ discovery: 'auto', respond: independentResponse }); await f.connect();
  const cached = (id, ff, status) => f.h.profile(f.h.candidate(raw(id, { fair_fight: ff })), torn(id, status ? { status } : {}));
  f.h.getState().pool = [cached(102, 2.9, { state: 'Federal', until: NOW + 3 * DAY }), cached(104, 2.99, { state: 'Fallen' }),
    cached(105, 2.95, { state: 'Traveling' }), cached(103, 2.5)];
  const checked = start => f.requests.slice(start).map(u => u.pathname).filter(p => p.startsWith('/user/'));
  let start = f.requests.length; await f.click('TF');
  assert.match(f.navigations[0], /user2ID=103$/); assert.deepEqual(checked(start), ['/user/103']);
  assert.equal(f.h.ready().some(row => [102, 104, 105].includes(row.id)), false);
  f.h.getFields().skipFederal.checked = false; await f.click('Save settings');
  assert.equal(f.h.getState().config.skipFederal, '0');
  assert.equal(f.h.getState().pool.length, 4, 'Changing a skip box keeps the cached pool');
  start = f.requests.length; await f.click('TF');
  assert.match(f.navigations[1], /user2ID=102$/); assert.deepEqual(checked(start), ['/user/102']);
  // Leave only the held players so the proven-Okay preference cannot pick 102 or 103 again.
  const keep = ids => { const s = f.h.getState(); for (const k of ['pool', 'rows', 'saved']) s[k] = s[k].filter(row => ids.includes(row.id)); };
  keep([104, 105]);
  start = f.requests.length; f.advance(800000); await f.click('TF');
  assert.equal(checked(start).includes('/user/105'), false, 'Travel is held for fifteen minutes');
  f.advance(120000); start = f.requests.length; await f.click('TF');
  assert.match(f.navigations.at(-1), /user2ID=105$/); assert.ok(checked(start).includes('/user/105'));
  f.advance(30 * DAY * 1000); start = f.requests.length; await f.click('TF');
  assert.equal(checked(start).includes('/user/104'), false, 'Fallen stays skipped while its box is ticked');
});

test('federal stays without a Torn release time hold for seven days; existing installs default every skip box on', async () => {
  const f = await fixture({ discovery: 'auto', respond: independentResponse }); await f.connect();
  const federal = f.h.profile(f.h.candidate(raw(102, { fair_fight: 2.9 })), torn(102, { status: { state: 'Federal' } }));
  f.h.getState().pool = [federal, f.h.profile(f.h.candidate(raw(103, { fair_fight: 2.5 })), torn(103))];
  f.advance(6 * DAY * 1000); await f.click('TF');
  assert.match(f.navigations[0], /user2ID=103$/); assert.equal(f.requests.some(u => u.pathname === '/user/102'), false);
  for (const k of ['pool', 'rows', 'saved']) f.h.getState()[k] = f.h.getState()[k].filter(row => row.id === 102);
  f.advance(DAY * 1000 + 1000); const start = f.requests.length; await f.click('TF');
  assert.match(f.navigations[1], /user2ID=102$/);
  assert.deepEqual(f.requests.slice(start).map(u => u.pathname), ['/user/102', '/api/v1/get-stats'], 'One Torn check; the week-old estimate is refreshed');
  const old = JSON.parse(f.store[STORE]); for (const k of ['skipFederal', 'skipTravel', 'skipFallen']) delete old.config[k];
  old.cooldownReason = 'HF pause after Torn backend errors';
  const decoded = f.h.decodeState(JSON.stringify(old));
  assert.deepEqual([decoded.config.skipFederal, decoded.config.skipTravel, decoded.config.skipFallen], ['1', '1', '1']);
  assert.equal(decoded.cooldownReason, 'TF pause after Torn backend errors');
  assert.throws(() => f.h.filters({ ...decoded.config, skipTravel: 'yes' }), /skip choice/);
});

test('Clear all local data restores the skip boxes to their defaults', async () => {
  const f = await fixture({ discovery: 'auto' }); await f.connect();
  for (const k of ['skipFederal', 'skipTravel', 'skipFallen']) f.h.getFields()[k].checked = false;
  await f.click('Save settings'); assert.equal(f.h.getState().config.skipTravel, '0');
  await f.click('Clear all local data');
  for (const k of ['skipFederal', 'skipTravel', 'skipFallen']) { assert.equal(f.h.getFields()[k].checked, true); assert.equal(f.h.getState().config[k], '1'); }
});

test('known recent activity skips futile profile checks, while a changed inactivity threshold reevaluates cached evidence', async () => {
  const f = await fixture({ discovery: 'auto', respond: url => url.pathname.endsWith('/get-targets')
    ? { targets: [raw(103, { fair_fight: 2.5 })] } : url.pathname === '/user/102'
      ? torn(102, { last_action: { timestamp: NOW - 10 * DAY } }) : independentResponse(url) });
  await f.connect();
  const recent = f.h.profile(f.h.candidate(raw(102, { fair_fight: 2.9 })), torn(102, { last_action: { timestamp: NOW - 10 * DAY } }));
  f.h.getState().pool = [recent]; f.h.getState().saved = [recent];
  await f.click('TF'); assert.match(f.navigations[0], /user2ID=103$/);
  assert.equal(f.requests.some(u => u.pathname === '/user/102'), false);
  await f.config({ days: '7' }); const start = f.requests.length; await f.click('TF');
  assert.match(f.navigations[1], /user2ID=102$/); assert.equal(f.requests.length - start, 1);
});

test('due cached hospital checks retain cancellation, defer stale replies and never navigate on a late response', async () => {
  let resolve;
  const f = await fixture({ discovery: 'auto', respond: url => url.pathname === '/user/102'
    ? new Promise(r => { resolve = r; }) : independentResponse(url) });
  await f.connect();
  const hospital = f.h.profile(f.h.candidate(raw(102, { fair_fight: 2.9 })), torn(102, { status: { state: 'Hospital', until: NOW + 20 } }));
  hospital.retryAt = NOW + 300; f.h.getState().pool = [hospital]; f.advance(21000);
  const searching = f.click('TF'); for (let i = 0; i < 10 && !resolve; i++) await settle();
  assert.ok(resolve); f.blur(); await searching;
  const count = f.requests.length; resolve(torn(102)); await settle();
  assert.equal(f.requests.length, count); assert.equal(f.navigations.length, 0); assert.equal(f.h.ready().length, 0);
  assert.equal(f.h.getState().pool[0].status, 'Unverified');
});

for (const kind of ['pda', 'gm']) test(kind + ': 1000 cached and saved profiles persist across reload without losing keys or history', async () => {
  const f = await fixture({ kind, discovery: 'auto' }); await f.connect(true);
  for (let id = 2000; id < 3000; id++) {
    const row = f.h.profile(f.h.candidate(raw(id)), torn(id));
    f.h.keepPool(row); f.h.rememberTarget(row); f.h.getState().rows.push(row);
  }
  f.h.getState().used = [88];
  await f.click('Save settings');
  const reload = await fixture({ kind, store: f.store });
  for (const list of ['pool', 'saved', 'rows']) assert.equal(reload.h.getState()[list].length, 1000);
  assert.equal(reload.h.getKey(), TEST_KEY); assert.deepEqual([...reload.h.getState().used], [88]);
  assert.equal(reload.requests.length, 0);
  const overflow = reload.h.profile(reload.h.candidate(raw(3000)), torn(3000));
  reload.h.keepPool(overflow); reload.h.rememberTarget(overflow);
  assert.equal(reload.h.getState().pool.length, 1000); assert.equal(reload.h.getState().pool[0].id, 2001);
  assert.equal(reload.h.getState().pool.at(-1).id, 3000);
  assert.equal(reload.h.getState().saved.length, 1000); assert.equal(reload.h.getState().saved.at(-1).id, 2999);
  reload.h.rememberTarget({ ...reload.h.getState().saved[0], status: 'Hospital' });
  assert.equal(reload.h.getState().saved[0].status, 'Hospital', 'Full libraries still update existing profiles');
  for (const list of ['pool', 'saved', 'rows']) {
    const invalid = JSON.parse(f.store[STORE]); invalid[list].push(overflow);
    assert.throws(() => reload.h.decodeState(JSON.stringify(invalid)), /invalid/);
  }
});

for (const kind of ['pda', 'gm']) test(kind + ': cached available matches avoid early hospital checks while preserving FF order and live validation', async () => {
  const f = await fixture({ kind, discovery: 'auto', respond: independentResponse }); await f.connect();
  f.h.getState().pool = [
    f.h.profile(f.h.candidate(raw(101, { fair_fight: 2.99 })), torn(101, { status: { state: 'Hospital', until: NOW + 600 } })),
    f.h.profile(f.h.candidate(raw(102, { fair_fight: 2.5 })), torn(102)),
    f.h.profile(f.h.candidate(raw(103, { fair_fight: 2.8 })), torn(103))];
  f.advance(61000);
  const start = f.requests.length; await f.click('TF');
  assert.deepEqual(f.requests.slice(start).map(u => u.pathname), ['/user/103']);
  assert.ok(f.requests.at(-1).searchParams.has('timestamp'));
  assert.match(f.navigations[0], /user2ID=103$/);
  await f.click('TF'); assert.match(f.navigations[1], /user2ID=102$/);
  f.advance(540000);
  await f.click('TF'); assert.match(f.navigations[2], /user2ID=101$/);
});

test('larger pool still rejects changed status and selects the next qualifying cached match', async () => {
  const f = await fixture({ discovery: 'auto', respond: url => url.pathname === '/user/2000'
    ? torn(2000, { status: { state: 'Hospital', until: NOW + 600 } }) : independentResponse(url) });
  await f.connect();
  for (let id = 2000; id < 3000; id++) f.h.keepPool(f.h.profile(f.h.candidate(raw(id)), torn(id)));
  const start = f.requests.length; await f.click('TF');
  assert.deepEqual(f.requests.slice(start).map(u => u.pathname), ['/user/2000', '/user/2001']);
  assert.match(f.navigations[0], /user2ID=2001$/);
  assert.equal(f.h.getState().pool.find(row => row.id === 2000).status, 'Hospital');
});

for (const kind of ['pda', 'gm']) test(kind + ': a new hospitalization replaces the expired timer and persists the next release across reload', async () => {
  const f = await fixture({ kind, discovery: 'auto', respond: url => url.pathname === '/user/102'
    ? torn(102, { status: { state: 'Hospital', until: NOW + 1000 } }) : independentResponse(url) });
  await f.connect(true); await f.config({ days: '20' });
  f.h.getState().pool = [
    f.h.profile(f.h.candidate(raw(102, { fair_fight: 2.9 })), torn(102, { status: { state: 'Hospital', until: NOW + 20 } })),
    f.h.profile(f.h.candidate(raw(103)), torn(103)), f.h.profile(f.h.candidate(raw(104)), torn(104))];
  f.advance(21000); await f.click('TF');
  assert.match(f.navigations[0], /user2ID=103$/);
  const reload = await fixture({ kind, store: f.store, respond: independentResponse });
  assert.equal(reload.h.getState().config.days, '20');
  const held = reload.h.getState().pool.find(row => row.id === 102);
  assert.equal(held.statusUntil, NOW + 1000); assert.equal(held.retryAt, NOW + 1000);
  reload.advance(100000); await reload.click('TF');
  assert.match(reload.navigations[0], /user2ID=104$/);
  assert.equal(reload.requests.some(u => u.pathname === '/user/102'), false);
  reload.advance(901000); const start = reload.requests.length; await reload.click('TF');
  assert.match(reload.navigations[1], /user2ID=102$/); assert.equal(reload.requests.length - start, 1);
  assert.ok(reload.requests.at(-1).searchParams.has('timestamp'));
});

test('independent fallback cannot bypass a cached future hospital release', async () => {
  const f = await fixture({ discovery: 'auto', respond: independentResponse }); await f.connect();
  await f.config({ minID: '102', maxID: '104' });
  const hospital = f.h.profile(f.h.candidate(raw(102, { fair_fight: 2.9 })), torn(102, { status: { state: 'Hospital', until: NOW + 600 } }));
  f.h.getState().pool = [hospital]; f.h.getState().saved = [hospital];
  f.h.getState().poolExhausted = true; f.h.getState().poolFetched = NOW;
  f.h.getState().scan = { min: 102, max: 104, offset: 0, cursor: 0 };
  const start = f.requests.length; f.advance(61000); await f.click('TF');
  assert.equal(f.requests.slice(start).some(u => u.pathname === '/user/102'), false);
  assert.match(f.navigations[0], /user2ID=103$/);
});

for (const status of ['Hospital', 'Jail']) test(status + ': missing release timers remain recheckable after a minute', async () => {
  const f = await fixture({ discovery: 'auto', respond: independentResponse }); await f.connect();
  const waiting = f.h.profile(f.h.candidate(raw(102, { fair_fight: 2.9 })), torn(102, { status: { state: status } }));
  waiting.retryAt = NOW + 300;
  f.h.getState().pool = [waiting, f.h.profile(f.h.candidate(raw(103)), torn(103))];
  await f.click('TF'); assert.match(f.navigations[0], /user2ID=103$/);
  const start = f.requests.length; f.advance(61000); await f.click('TF');
  assert.match(f.navigations[1], /user2ID=102$/); assert.equal(f.requests.length - start, 1);
});

const SEARCH_BUDGET = 'sr_halloween_search_budget_v1';
for (const kind of ['pda', 'gm']) test(kind + ': BSP retirement preserves FF cache, filters and key, removes its own obsolete key and uses only FF estimates', async () => {
  const f = await fixture({ kind, discovery: 'auto' }); await f.connect(true);
  const old = JSON.parse(f.store[STORE]);
  Object.assign(old.config, { statSource: 'bsp', days: '20', maxStats: '15m' });
  const row = f.h.profile(f.h.candidate(raw(102)), torn(102));
  Object.assign(row, { bspStats: 100e6, bspFetched: NOW, bspAt: NOW });
  old.pool = [row]; old.saved = [row]; old.rows = [row]; old.used = [88];
  old.cooldownReason = 'BSP throttle/block'; old.cooldown = NOW * 1000 + 60000;
  f.store[STORE] = JSON.stringify(old); f.store[BSP_KEY] = BSP_TEST_KEY; f.store.unrelated_bsp_script = 'untouched';
  const reload = await fixture({ kind, store: f.store, respond: independentResponse });
  assert.equal(reload.store[BSP_KEY], ''); assert.equal(reload.store.unrelated_bsp_script, 'untouched');
  assert.equal(reload.h.getKey(), TEST_KEY); assert.equal(reload.requests.length, 0);
  assert.equal(reload.h.getState().config.days, '20'); assert.equal(reload.h.getState().config.maxStats, '15m');
  assert.equal(reload.h.getState().config.statSource, undefined); assert.equal(reload.h.getState().pool[0].bspStats, undefined);
  assert.equal(reload.button('Connect BSP'), undefined); assert.equal(reload.h.getFields().statSource, undefined);
  await reload.click('TF');
  assert.match(reload.navigations[0], /user2ID=102$/); assert.deepEqual(reload.requests.map(u => u.hostname), ['api.torn.com']);
  assert.deepEqual([...reload.h.getState().used], [88, 102]);
});

test('retired BSP estimates cannot make unknown or excessive FF estimates eligible', async () => {
  const f = await fixture(); const filters = f.h.filters({ ...f.h.getState().config, maxStats: '20m' });
  const row = f.h.profile(f.h.candidate(raw()), torn());
  for (const stats of [null, 21e6]) assert.equal(f.h.matches({ ...row, stats, bspStats: 10e6 }, filters), false);
  assert.equal(source.includes('lol-manager.com'), false); assert.equal(source.includes('Connect BSP'), false);
});

test('failed obsolete BSP key cleanup does not discard scouting cache or credentials', async () => {
  const f = await fixture(); await f.connect(true); f.store[BSP_KEY] = BSP_TEST_KEY;
  const reload = await fixture({ store: f.store, dropKeyWrites: true });
  assert.equal(reload.h.getKey(), TEST_KEY); assert.match(reload.h.getNotice(), /old key copy could not be erased/);
  assert.equal(reload.requests.length, 0);
});

for (const kind of ['pda', 'gm']) test(kind + ': full FF search budget permits a cached target with just one fresh Torn request', async () => {
  const f = await fixture({ kind, discovery: 'auto', respond: independentResponse }); await f.connect(true);
  f.store[SEARCH_BUDGET] = JSON.stringify(Array(20).fill(NOW * 1000));
  f.h.getState().pool = [f.h.profile(f.h.candidate(raw(102)), torn(102))];
  const start = f.requests.length; await f.click('TF');
  assert.equal(f.requests.length - start, 1); assert.match(f.navigations[0], /user2ID=102$/);
  assert.equal(f.requests.at(-1).hostname, 'api.torn.com');
});

test('FF list budget counts actual requests across reloads and resets, then resumes after its rolling minute', async () => {
  let batch = 0;
  const respond = url => url.pathname.endsWith('/get-targets')
    ? { targets: [raw(4000 + ++batch, { fair_fight: 3 - batch * 0.01, bs_estimate: 50e6 })] }
    : url.pathname === '/user/' ? torn(999) : torn(Number(url.pathname.split('/').pop()), { status: { state: 'Hospital' } });
  const f = await fixture({ discovery: 'auto', respond }); await f.connect(true);
  await f.config({ maxStats: '20m', minID: '100', maxID: '108' });
  await f.click('TF'); assert.equal(batch, 20); assert.equal(JSON.parse(f.store[SEARCH_BUDGET]).length, 20);
  const reload = await fixture({ store: f.store, respond });
  await reload.click('Clear shortlist'); await reload.click('TF');
  assert.equal(batch, 20); assert.equal(reload.button('TF').textContent, 'TF\nWAIT');
  assert.match(reload.h.getNotice(), /TF target-search budget/); assert.equal(reload.h.getState().cooldown, 0);
  const start = reload.requests.length; reload.advance(81000); await settle(); assert.equal(reload.requests.length, start);
  await reload.click('TF'); assert.equal(batch, 40); assert.equal(reload.navigations.length, 0);
});

test('automatic independent fallback never repeats pool rejects or failed IDs on the same tap', async () => {
  const f = await fixture({ discovery: 'auto', respond: url => url.pathname === '/user/102'
    ? { error: { code: 17 } } : independentResponse(url) }); await f.connect();
  await f.config({ minID: '100', maxID: '103', maxStats: '20m' });
  f.h.getState().pool = [f.h.candidate(raw(100, { fair_fight: 1.1 })), f.h.candidate(raw(101, { bs_estimate: 50e6 })), f.h.candidate(raw(102))];
  f.h.getState().poolExhausted = true; f.h.getState().poolFetched = NOW;
  f.h.getState().scan = { min: 100, max: 103, offset: 0, cursor: 0 };
  const start = f.requests.length; await f.click('TF');
  const paths = f.requests.slice(start).filter(u => u.hostname === 'api.torn.com').map(u => u.pathname);
  assert.deepEqual(paths, ['/user/102', '/user/103']);
  assert.match(f.navigations[0], /user2ID=103$/);
});

test('malformed target-search budgets fail without network requests', async () => {
  const f = await fixture({ discovery: 'auto' }); await f.connect();
  f.store[SEARCH_BUDGET] = JSON.stringify(Array(21).fill(NOW * 1000));
  const start = f.requests.length; await f.click('TF'); assert.equal(f.requests.length, start);
  assert.match(f.h.getNotice(), /budget could not be read/); assert.equal(f.navigations.length, 0);
});

for (const kind of ['pda', 'gm']) test(kind + ': changing filters retains cached hospital timers and reevaluates strength before requests', async () => {
  const f = await fixture({ kind, discovery: 'auto', respond: independentResponse }); await f.connect(true);
  f.h.getState().pool = [
    f.h.profile(f.h.candidate(raw(101, { fair_fight: 2.9 })), torn(101, { status: { state: 'Hospital', until: NOW + 3600 } })),
    f.h.profile(f.h.candidate(raw(102, { fair_fight: 2.8, bs_estimate: 50e6 })), torn(102)),
    f.h.profile(f.h.candidate(raw(103)), torn(103))
  ];
  await f.config({ days: '20', maxStats: '20m', faction: 'none' });
  assert.equal(f.h.getState().pool.length, 3);
  const reload = await fixture({ kind, store: f.store, respond: independentResponse });
  await reload.click('TF');
  assert.deepEqual(reload.requests.map(u => u.pathname), ['/user/103']);
  assert.equal(reload.h.getState().pool.find(r => r.id === 101).statusUntil, NOW + 3600);
  assert.match(reload.navigations[0], /user2ID=103$/);
  await reload.click('Clear shortlist');
  assert.equal(reload.h.getState().pool.length, 0, 'Explicit clearing still clears the candidate pool');
});

for (const kind of ['pda', 'gm']) test(kind + ': independent fallback skips 1,000 cached IDs with bounded storage writes', async () => {
  const f = await fixture({ kind, discovery: 'auto', respond: independentResponse }); await f.connect(true);
  await f.config({ minID: '1000', maxID: '2000' });
  f.h.getState().pool = Array.from({ length: 1000 }, (_, i) => f.h.candidate(raw(1000 + i, { fair_fight: 1.1 })));
  f.h.getState().poolExhausted = true; f.h.getState().poolFetched = NOW;
  f.h.getState().scan = { min: 1000, max: 2000, offset: 0, cursor: 0 };
  const writes = f.writes.length, requests = f.requests.length;
  await f.click('TF');
  assert.ok(f.writes.length - writes < 15, 'Local skips must not serialize the entire cache 1,000 times');
  assert.deepEqual(f.requests.slice(requests).map(u => u.hostname + u.pathname), ['api.torn.com/user/2000', 'ffscouter.com/api/v1/get-stats']);
  assert.ok(f.requests[requests].searchParams.has('timestamp'), 'The single profile request bypasses stale API cache');
  assert.match(f.navigations[0], /user2ID=2000$/);
  const reload = await fixture({ kind, store: f.store, respond: independentResponse });
  assert.equal(reload.h.getState().scan.cursor, 1001);
});

test('slow fallback enrichment requires a new status check and rejects a newly hospitalized target', async () => {
  let f, calls = 0;
  f = await fixture({ discovery: 'auto', respond: url => {
    if (url.pathname.endsWith('/get-stats')) f.advance(6000);
    if (url.pathname === '/user/100' && ++calls > 1) return torn(100, { status: { state: 'Hospital', until: NOW + 600 } });
    return independentResponse(url);
  } });
  await f.connect(); await f.config({ minID: '100', maxID: '100' });
  f.h.getState().poolExhausted = true; f.h.getState().poolFetched = NOW;
  await f.click('TF');
  assert.equal(calls, 2); assert.equal(f.navigations.length, 0);
  assert.equal(f.h.getState().pool[0].statusUntil, NOW + 600);
});

test('a pending profile from a previous tap never takes the fresh fallback shortcut', async () => {
  const f = await fixture({ discovery: 'auto', respond: url => url.pathname === '/user/100'
    ? torn(100, { status: { state: 'Hospital', until: NOW + 600 } }) : independentResponse(url) });
  await f.connect(); await f.config({ minID: '100', maxID: '100' });
  f.h.getState().pending = [f.h.profile({ id: 100, stats: null, ff: null, fetchedAt: null }, torn(100))];
  f.h.getState().poolExhausted = true; f.h.getState().poolFetched = NOW;
  const before = f.requests.length; await f.click('TF');
  assert.equal(f.requests.slice(before).filter(u => u.pathname === '/user/100').length, 1);
  assert.equal(f.navigations.length, 0);
});

for (const kind of ['pda', 'gm']) test(kind + ': cancelling fallback enrichment never opens the earlier fresh profile', async () => {
  let resolve;
  const f = await fixture({ kind, discovery: 'auto', respond: url => url.pathname.endsWith('/get-stats')
    ? new Promise(r => { resolve = r; }) : independentResponse(url) });
  await f.connect(); await f.config({ minID: '100', maxID: '100' });
  f.h.getState().poolExhausted = true; f.h.getState().poolFetched = NOW;
  const run = f.click('TF');
  for (let i = 0; i < 20 && !resolve; i++) await settle();
  assert.ok(resolve); f.blur(); await run;
  const count = f.requests.length; resolve([raw(100)]); await settle();
  assert.equal(f.requests.length, count); assert.equal(f.navigations.length, 0);
  assert.equal(f.h.ready().length, 0);
});

const LOG_STORE = 'sr_halloween_logs_v1';
for (const kind of ['pda', 'gm']) test(kind + ': WAIT logs persist across pages and copy without keys, player details or new requests', async () => {
  const f = await fixture({ kind, discovery: 'auto', respond: url => url.pathname === '/user/102'
    ? { status: 429, responseText: JSON.stringify({ error: { code: 5, error: TEST_KEY + ' private player 102' } }) } : poolResponse(url) });
  await f.connect(true); await f.click('TF');
  assert.equal(f.button('TF').textContent, 'TF\nWAIT'); assert.equal(f.h.getLogPanel().hidden, true);
  const persisted = f.store[LOG_STORE];
  assert.ok(persisted.includes('Torn throttle/block')); assert.ok(!persisted.includes(TEST_KEY));
  assert.ok(!persisted.includes('private player')); assert.ok(!persisted.includes('/user/102'));
  const reload = await fixture({ kind, store: f.store, page: '/page.php?sid=attackLog', respond: poolResponse });
  let copied = '';
  reload.context.navigator = { clipboard: { writeText: async text => { copied = text; } } };
  await reload.click('Logs'); await reload.click('Copy logs');
  assert.equal(reload.requests.length, 0); assert.equal(reload.navigations.length, 0);
  assert.match(copied, /Torn throttle\/block/); assert.match(copied, /HTTP 429 code 5/);
  assert.match(copied, /seconds remaining/); assert.match(copied, /TF v0.5.3/);
  assert.ok(!copied.includes(TEST_KEY)); assert.equal(reload.h.getPanel().hidden, true);
  await reload.click('Close logs'); assert.equal(reload.h.getLogPanel().hidden, true);
  reload.advance(63000); await reload.click('Logs'); assert.match(reload.h.logReport(), /WAIT has expired/);
});

test('logs distinguish FF provider throttling, the local list budget and backend-error pauses', async () => {
  const provider = await fixture({ discovery: 'auto', respond: url => url.pathname.endsWith('/get-targets')
    ? { status: 429, responseText: JSON.stringify({ code: 21, retry_after_seconds: 12 }) } : independentResponse(url) });
  await provider.connect(); await provider.click('TF');
  assert.match(provider.h.logReport(), /FFScouter throttle\/block/); assert.match(provider.h.logReport(), /get-targets received HTTP 429 code 21/);
  const local = await fixture({ discovery: 'auto', respond: url => url.pathname === '/user/100'
    ? torn(100, { status: { state: 'Hospital' } }) : independentResponse(url) });
  await local.connect(); await local.config({ minID: '100', maxID: '100' });
  local.store[SEARCH_BUDGET] = JSON.stringify(Array(20).fill(NOW * 1000));
  await local.click('TF'); assert.match(local.h.logReport(), /TF target-list budget/);
  assert.equal(local.requests.filter(u => u.pathname.endsWith('/get-targets')).length, 0);
  const backend = await fixture({ discovery: 'auto', respond: url => /^\/user\/10/.test(url.pathname) ? { error: { code: 17 } } : poolResponse(url) });
  await backend.connect(); await backend.click('TF');
  assert.match(backend.h.logReport(), /TF pause after Torn backend errors/);
  assert.equal(JSON.parse(backend.store[LOG_STORE]).filter(e => e.code === 17).length, 3);
});

test('bounded diagnostic storage sanitizes imported fields and corrupted logs never reset the cache or key', async () => {
  const f = await fixture({ discovery: 'auto', respond: poolResponse }); await f.connect(true); await f.click('TF');
  const before = JSON.parse(f.store[STORE]);
  f.store[LOG_STORE] = '{broken';
  const reload = await fixture({ store: f.store });
  assert.equal(reload.h.getKey(), TEST_KEY); assert.equal(reload.h.getState().pool.length, before.pool.length);
  for (let i = 0; i < 110; i++) reload.h.logEvent('request', { service: 'Torn', operation: 'profile', code: i, key: TEST_KEY, url: 'https://secret.example/' + TEST_KEY });
  await reload.h.flushLogs();
  const entries = JSON.parse(reload.store[LOG_STORE]); assert.equal(entries.filter(e => e.kind !== 'summary').length, 100);
  assert.equal(entries.find(e => e.kind === 'request').code, 10);
  entries[0].reason = TEST_KEY; entries[0].operation = TEST_KEY; entries[0].body = TEST_KEY;
  reload.store[LOG_STORE] = JSON.stringify(entries);
  const sanitized = await fixture({ store: reload.store });
  assert.ok(!sanitized.h.logReport().includes(TEST_KEY));
  await sanitized.h.flushLogs(); assert.ok(!sanitized.store[LOG_STORE].includes(TEST_KEY));
});

test('clipboard fallback selects report and clearing logs leaves cooldown, keys and targets intact', async () => {
  const f = await fixture({ discovery: 'auto', respond: poolResponse }); await f.connect(true); await f.click('TF');
  f.h.getState().cooldown = NOW * 1000 + 60000; f.h.getState().cooldownReason = 'Torn throttle/block';
  const requests = f.requests.length, candidates = f.h.getState().pool.length;
  await f.click('Logs'); await f.click('Copy logs');
  assert.equal(f.h.getLogText().selected, true); assert.match(f.h.getLogHint(), /Automatic copy unavailable/);
  await f.click('Clear logs'); assert.deepEqual(JSON.parse(f.store[LOG_STORE]), []);
  assert.equal(f.h.getState().pool.length, candidates); assert.equal(f.h.getKey(), TEST_KEY);
  assert.equal(f.h.getState().cooldown, NOW * 1000 + 60000);
  assert.equal(f.requests.length, requests);
  await f.button('Logs').dispatch('click', { isTrusted: false }); assert.equal(f.h.getLogPanel().hidden, false);
});

test('failed diagnostic writes do not block a valid target or discard the scouting cache', async () => {
  const f = await fixture({ discovery: 'auto', respond: poolResponse }); await f.connect(true);
  const original = f.context.PDA_storage.set;
  f.context.PDA_storage.set = async (key, value) => { if (key === LOG_STORE) throw Error('Storage unavailable'); return original(key, value); };
  await f.click('TF'); assert.equal(f.navigations.length, 1);
  await f.click('Logs'); assert.match(f.h.getLogHint(), /saving failed/);
  assert.equal(f.h.getState().pool.length, 3); assert.equal(f.store[KEY], TEST_KEY);
});

test('diagnostics distinguish transport timeout and cancellation without recording raw errors', async () => {
  for (const timeout of [true, false]) {
    let resolve;
    const f = await fixture({ discovery: 'auto', respond: url => url.pathname.endsWith('/get-targets') ? new Promise(r => { resolve = r; }) : independentResponse(url) });
    await f.connect(); const run = f.click('TF');
    for (let i = 0; i < 20 && !resolve; i++) await settle();
    assert.ok(resolve); if (timeout) f.expire(); else f.blur(); await run;
    assert.ok(JSON.parse(f.store[LOG_STORE]).some(e => e.outcome === (timeout ? 'timeout' : 'cancelled')));
    resolve({ targets: [raw(101)] }); await settle(); assert.equal(f.navigations.length, 0);
  }
});

for (const kind of ['pda', 'gm']) test(kind + ': diagnostic reads and stalled writes never hold up TF startup or navigation', async () => {
  const seed = await fixture({ kind, discovery: 'auto', respond: poolResponse }); await seed.connect(true);
  const f = await fixture({ kind, store: seed.store, logRead: () => new Promise(() => {}), respond: poolResponse });
  let writes = 0, release;
  const original = kind === 'pda' ? f.context.PDA_storage.set : f.context.GM_setValue;
  const slow = (key, value) => key === LOG_STORE ? (writes++, new Promise(resolve => { release = resolve; })) : original(key, value);
  if (kind === 'pda') f.context.PDA_storage.set = slow; else f.context.GM_setValue = slow;
  await f.click('TF'); assert.equal(f.navigations.length, 1);
  await f.click('TF'); assert.equal(f.navigations.length, 2, 'Another TF tap is not blocked by diagnostic storage');
  assert.equal(writes, 1, 'Only one diagnostic write can be in flight');
  assert.match(f.h.logReport(), /search opened/);
  release(); await settle(); await settle();
  assert.equal(writes, 2, 'Multiple pending snapshots coalesce to the newest one');
});

test('search summaries record cache skips, live rejection counts and request/pacing times', async () => {
  let f;
  f = await fixture({ discovery: 'auto', respond: url => {
    if (/\/user\/10/.test(url.pathname)) f.advance(20);
    return url.pathname === '/user/102' ? torn(102, { status: { state: 'Hospital', until: NOW + 600 } }) : independentResponse(url);
  } });
  await f.connect();
  f.h.getState().pool = [
    f.h.profile(f.h.candidate(raw(100, { fair_fight: 2.9 })), torn(100, { status: { state: 'Hospital', until: NOW + 600 } })),
    f.h.candidate(raw(101, { fair_fight: 1.1 })), f.h.candidate(raw(102, { fair_fight: 2.8 })), f.h.candidate(raw(103))
  ];
  await f.click('TF');
  const summary = JSON.parse(f.store[LOG_STORE]).findLast(e => e.kind === 'summary');
  assert.equal(summary.action, 'search'); assert.equal(summary.result, 'opened');
  assert.equal(summary.counts.poolAtStart, 4); assert.equal(summary.counts.hospitalTimersSkipped, 1);
  assert.equal(summary.counts.outsideFFAtStart, 1); assert.equal(summary.counts.eligibleAtStart, 2);
  assert.equal(summary.counts.cachedChecks, 2); assert.equal(summary.counts.tornRequests, 2);
  assert.equal(summary.counts.rejectedHospital, 1); assert.equal(summary.counts.rejectedStatus, undefined); assert.equal(summary.counts.networkMs, 40);
  assert.ok(summary.counts.storageWrites > 0); assert.ok(summary.counts.storageMs >= 0);
  assert.ok(summary.counts.pacingMs > 0); assert.ok(summary.ms >= summary.counts.pacingMs + summary.counts.networkMs);
  assert.ok(!JSON.stringify(summary).includes(TEST_KEY));
});

test('summaries survive request bursts and retain only the latest twenty actions', async () => {
  const f = await fixture(); await f.connect();
  for (let i = 0; i < 25; i++) f.h.logEvent('summary', { action: 'search', result: 'no match', counts: { cachedChecks: i, rawSecret: TEST_KEY } });
  for (let i = 0; i < 150; i++) f.h.logEvent('request', { service: 'Torn', operation: 'profile' });
  await f.h.flushLogs();
  const logs = JSON.parse(f.store[LOG_STORE]), summaries = logs.filter(e => e.kind === 'summary');
  assert.equal(summaries.length, 20); assert.equal(summaries[0].counts.cachedChecks, 5);
  assert.equal(logs.filter(e => e.kind !== 'summary').length, 100);
  const reload = await fixture({ store: f.store });
  assert.match(reload.h.logReport(), /cachedChecks=24/); assert.ok(!reload.h.logReport().includes('rawSecret'));
});

test('late diagnostic history cannot undo an explicit clear and validation errors have safe categories', async () => {
  let resolve;
  const f = await fixture({ logRead: () => new Promise(r => { resolve = r; }) });
  await f.click('Logs'); await f.click('Clear logs');
  resolve(JSON.stringify([{ at: NOW * 1000, kind: 'request', code: 987 }])); await settle();
  assert.ok(!f.h.logReport().includes('987'));
  f.h.getFields().days.value = '-1'; await f.click('Save settings');
  assert.match(f.h.logReport(), /error validation/); assert.match(f.h.logReport(), /settings error/);
  assert.equal(f.requests.length, 0);
});

test('Find target and maintenance controls retain specific diagnostic action labels', async () => {
  const f = await fixture({ discovery: 'auto', respond: poolResponse }); await f.connect();
  await f.click('Find target');
  assert.equal(JSON.parse(f.store[LOG_STORE]).findLast(e => e.kind === 'summary').action, 'search');
  await f.click('Clear shortlist');
  assert.equal(JSON.parse(f.store[LOG_STORE]).findLast(e => e.kind === 'summary').action, 'clear shortlist');
  await f.click('Forget key');
  assert.match(f.h.logReport(), /done forget key/); assert.ok(!f.store[LOG_STORE].includes(TEST_KEY));
});

test('Torn checks are paced 1.25 seconds apart without a separate save before each request', async () => {
  let f, before = null;
  f = await fixture({ discovery: 'auto', respond: url => {
    if (url.pathname === '/user/103') before = f.writes.filter(w => w.k === STORE).map(w => JSON.parse(w.v));
    return independentResponse(url);
  } });
  await f.connect();
  f.h.getState().pool = [f.h.profile(f.h.candidate(raw(103, { fair_fight: 2.5 })), torn(103))];
  await f.click('TF'); assert.match(f.navigations[0], /user2ID=103$/);
  const unverified = before.filter(s => s.pool.find(row => row.id === 103)?.status === 'Unverified');
  assert.equal(unverified.length, 1, 'Only the safety invalidation is written before the check');
  assert.ok(JSON.parse(f.store[STORE]).nextTorn >= NOW * 1000 + 1250, 'Spacing is saved before navigating');
  assert.ok(JSON.parse(f.store[STORE]).nextTorn <= NOW * 1000 + 2 * 1250 + 100, 'Connect check plus one paced check');
});

test('newer provider estimates refresh cached candidates without losing profile evidence; older ones are ignored', async () => {
  const f = await fixture({ discovery: 'auto', respond: url => url.pathname.endsWith('/get-targets')
    ? { targets: [raw(101, { fair_fight: 2.9, bs_estimate: 20e6, bss_public_timestamp: NOW }), raw(104, { fair_fight: 2.1, bss_public_timestamp: NOW - 5 * DAY })] }
    : torn(Number(url.pathname.split('/').pop()) || 999, { status: { state: 'Hospital', until: NOW + 600 } }) });
  await f.connect();
  const held = (id, ff, estimatedAt) => ({ ...f.h.profile(f.h.candidate(raw(id, { fair_fight: ff, bss_public_timestamp: estimatedAt })), torn(id, { status: { state: 'Hospital', until: NOW + 600 } })), retryAt: NOW + 600 });
  f.h.getState().pool = [held(101, 2.2, NOW - 30 * DAY), held(104, 2.6, NOW - DAY)];
  await f.click('TF');
  const [a, b] = [101, 104].map(id => f.h.getState().pool.find(row => row.id === id));
  assert.equal(a.ff, 2.9); assert.equal(a.stats, 20e6); assert.equal(a.estimatedAt, NOW);
  assert.equal(a.status, 'Hospital'); assert.equal(a.statusUntil, NOW + 600); assert.ok(a.lastAction);
  assert.equal(b.ff, 2.6, 'An older provider estimate never replaces a newer cached one');
});

test('week-old estimates are refreshed after a matching profile; a missing refresh keeps the dated estimate', async () => {
  const f = await fixture({ discovery: 'auto', respond: url => url.pathname.endsWith('/get-stats') ? [] : independentResponse(url) });
  await f.connect();
  const row = f.h.profile(f.h.candidate(raw(103, { fair_fight: 2.5, bss_public_timestamp: NOW - 9 * DAY })), torn(103));
  row.fetchedAt = NOW - 8 * DAY; f.h.getState().pool = [row];
  await f.click('TF');
  assert.match(f.navigations[0], /user2ID=103$/);
  assert.ok(f.requests.some(u => u.pathname.endsWith('/get-stats')));
  const saved = f.h.getState().pool.find(item => item.id === 103);
  assert.equal(saved.ff, 2.5); assert.equal(saved.estimatedAt, NOW - 9 * DAY); assert.ok(saved.fetchedAt >= NOW);
});

test('errors carry a fixed detail label in stored and copied logs, never the free-form message', async () => {
  const f = await fixture({ discovery: 'auto' }); await f.connect();
  f.h.getState().used = Array.from({ length: 2000 }, (_, i) => i + 1);
  await f.click('TF');
  const error = f.h.getState() && JSON.parse(f.store[LOG_STORE] || '[]').findLast(e => e.kind === 'error');
  assert.equal(error.detail, 'opened history full');
  assert.match(f.h.logReport(), /error operation: opened history full/);
  assert.equal(f.h.logEvent('error', { detail: 'Player 123 secret text' }).detail, undefined, 'Unknown details are dropped');
  assert.match(f.h.logReport(), /^TF v0.5.3 diagnostics/);
});

test('v0.4.2 defaults to most-likely-available order, including once for existing installs', async () => {
  const f = await fixture({ discovery: 'auto', sort: null });
  assert.equal(f.h.getState().config.sort, 'available'); assert.equal(f.h.getFields().sort.value, 'available');
  const old = JSON.parse(JSON.stringify(f.h.getState())); old.config.sort = 'ff-desc'; delete old.availableOrderVersion;
  assert.equal(f.h.decodeState(JSON.stringify(old)).config.sort, 'available');
  old.availableOrderVersion = 1;
  assert.equal(f.h.decodeState(JSON.stringify(old)).config.sort, 'ff-desc', 'A later choice in settings is kept');
});

test('availability order checks recently seen Okay, then unchecked, then uncontested before stale or contested players', async () => {
  const f = await fixture({ discovery: 'auto', sort: null, respond: independentResponse }); await f.connect();
  const seen = (id, ff, history, okayAgo) => ({ ...f.h.profile(f.h.candidate(raw(id, { fair_fight: ff })), torn(id)),
    ...history, okayAt: NOW - okayAgo });
  const rows = [
    seen(101, 2.99, { checks: 6, hospitalHits: 6 }, 3600),   // high FF but nearly always hospitalised
    seen(102, 2.95, { checks: 4, hospitalHits: 1 }, 3600),   // stale Okay, rarely hospitalised
    f.h.candidate(raw(103, { fair_fight: 2.2 })),             // never checked here
    seen(104, 2.1, { checks: 2, hospitalHits: 0 }, 120)       // seen Okay two minutes ago
  ];
  const order = Array.from(f.h.sorted(rows, f.h.filters(f.h.getState().config)), row => row.id);
  assert.deepEqual(order, [104, 103, 102, 101]);
  const ffOrder = f.h.sorted(rows, f.h.filters({ ...f.h.getState().config, sort: 'ff-desc' })).map(row => row.id);
  assert.equal(ffOrder.at(-1), 101, 'Fair-fight order still lists heavily contested players last');
  assert.equal(ffOrder[0], 102);
});

test('profile checks record bounded hospital history and the last time a player was seen Okay', async () => {
  const f = await fixture({ discovery: 'auto', sort: null });
  let row = f.h.candidate(raw(101));
  for (let i = 0; i < 25; i++) row = f.h.profile(row, torn(101, { status: { state: i % 2 ? 'Okay' : 'Hospital', until: NOW + 60 } }));
  assert.ok(row.checks <= 20 && row.checks > 0); assert.ok(row.hospitalHits <= row.checks);
  assert.equal(row.okayAt, NOW);
  const hospital = f.h.profile({ ...row, okayAt: NOW - 50 }, torn(101, { status: { state: 'Hospital', until: NOW + 60 } }));
  assert.equal(hospital.okayAt, NOW - 50, 'A hospital check keeps the previous Okay time');
  const saved = JSON.parse(JSON.stringify(f.h.getState())); saved.pool = [{ ...hospital, checks: -3, hospitalHits: 9 }];
  const decoded = f.h.decodeState(JSON.stringify(saved)).pool[0];
  assert.equal(decoded.checks, 0); assert.equal(decoded.hospitalHits, 0);
});

test('three hospital misses in a tap fetch a fresh candidate list before checking more cached players', async () => {
  let lists = 0;
  const f = await fixture({ discovery: 'auto', sort: null, respond: url => {
    if (url.pathname.endsWith('/get-targets')) { lists++; return { targets: [raw(900, { fair_fight: 2.4 })] }; }
    if (url.pathname.endsWith('/get-stats')) return independentResponse(url);
    const id = Number(url.pathname.split('/').pop()) || 999;
    return id === 900 ? torn(900) : torn(id, { status: { state: 'Hospital', until: NOW + 600 } });
  } });
  await f.connect();
  f.h.getState().pool = [101, 102, 103, 104, 105].map(id => f.h.profile(f.h.candidate(raw(id, { fair_fight: 2.9 })), torn(id)))
    .map(row => ({ ...row, okayAt: NOW - 3600 }));
  const start = f.requests.length; await f.click('TF');
  const paths = f.requests.slice(start).map(u => u.pathname);
  assert.equal(lists, 1);
  assert.equal(paths.indexOf('/api/v1/get-targets'), 3, 'List requested right after the third hospital miss');
  assert.match(f.navigations[0], /user2ID=900$/);
  assert.equal(paths.filter(p => /^\/user\/10[45]$/.test(p)).length, 0, 'The fresh candidate is checked before more cached ones');
  const summary = JSON.parse(f.store[LOG_STORE]).findLast(e => e.kind === 'summary');
  assert.equal(summary.counts.earlyBatches, 1); assert.equal(summary.counts.rejectedHospital, 3);
});

test('an unavailable early list never stops checking cached candidates', async () => {
  const f = await fixture({ discovery: 'auto', sort: null, respond: url => {
    const id = Number(url.pathname.split('/').pop()) || 999;
    return id === 105 ? torn(105) : torn(id, { status: { state: 'Hospital', until: NOW + 600 } });
  } });
  await f.connect();
  f.h.getState().poolExhausted = true; f.h.getState().poolFetched = NOW;
  f.h.getState().pool = [101, 102, 103, 104, 105].map((id, i) => ({ ...f.h.profile(f.h.candidate(raw(id, { fair_fight: 2.9 - i / 100 })), torn(id)), okayAt: NOW - 3600 }));
  await f.click('TF');
  assert.match(f.navigations[0], /user2ID=105$/);
  assert.equal(f.requests.some(u => u.pathname.endsWith('/get-targets')), false);
});

test('targets TF just opened are checked after everyone else until a later check, in both orders', async () => {
  const f = await fixture({ discovery: 'auto', sort: null, respond: independentResponse }); await f.connect();
  const okay = (id, ff) => f.h.profile(f.h.candidate(raw(id, { fair_fight: ff })), torn(id));
  // 101 was opened right after its Okay check (the state TF leaves after navigating).
  const opened = { ...okay(101, 2.99), lastOpened: NOW };
  const rows = [opened, f.h.candidate(raw(102, { fair_fight: 2.2 })), { ...okay(103, 2.5), okayAt: NOW - 3600 }];
  const order = config => Array.from(f.h.sorted(rows, f.h.filters({ ...f.h.getState().config, ...config })), row => row.id);
  assert.deepEqual(order({}), [102, 103, 101]);
  assert.deepEqual(order({ sort: 'ff-desc' }), [103, 102, 101]);
  const rechecked = f.h.profile({ ...opened, checkedAt: NOW - 1 }, torn(101, { status: { state: 'Hospital', until: NOW + 60 } }));
  rechecked.checkedAt = NOW + 1;
  const ffConfig = f.h.filters({ ...f.h.getState().config, sort: 'ff-desc' });
  assert.equal(f.h.sorted([rechecked, rows[2]], ffConfig)[0].id, 101, 'A check after opening restores normal ranking');
  // End to end: after the duplicate-open hold, the just-opened target is not checked first.
  f.h.getState().pool = [opened, okay(104, 2.4)]; f.h.getState().used = [101];
  f.advance(121000); const start = f.requests.length; await f.click('TF');
  assert.equal(f.requests.slice(start).find(u => u.pathname.startsWith('/user/')).pathname, '/user/104');
  assert.match(f.navigations[0], /user2ID=104$/);
});

test('players from a list fetched during the tap are checked before older unchecked cache entries', async () => {
  let lists = 0;
  const f = await fixture({ discovery: 'auto', sort: null, respond: url => {
    if (url.pathname.endsWith('/get-targets')) { lists++; return { targets: [raw(900, { fair_fight: 2.2 }), raw(901, { fair_fight: 2.1 })] }; }
    if (url.pathname.endsWith('/get-stats')) return independentResponse(url);
    const id = Number(url.pathname.split('/').pop()) || 999;
    return id === 901 ? torn(901) : torn(id, { status: { state: 'Hospital', until: NOW + 600 } });
  } });
  await f.connect();
  // Many never-checked, higher-FF players from earlier lists: they rank with the fresh ones by tier.
  f.h.getState().pool = Array.from({ length: 8 }, (_, i) => f.h.candidate(raw(200 + i, { fair_fight: 2.9 - i / 100 })));
  const start = f.requests.length; await f.click('TF');
  const checks = f.requests.slice(start).map(u => u.pathname).filter(p => p.startsWith('/user/'));
  assert.equal(lists, 1);
  assert.deepEqual(checks.slice(3), ['/user/900', '/user/901'], 'After the list, only its players are checked');
  assert.match(f.navigations[0], /user2ID=901$/);
  const summary = JSON.parse(f.store[LOG_STORE]).findLast(e => e.kind === 'summary');
  assert.equal(summary.counts.newCandidateChecks, 2); assert.equal(summary.counts.cachedChecks, 3);
});

test('once a fresh list is used up, three more misses can request another, at most three early lists per tap', async () => {
  let lists = 0;
  const f = await fixture({ discovery: 'auto', sort: null, respond: url => {
    if (url.pathname.endsWith('/get-targets')) { lists++; return { targets: [raw(900 + lists, { fair_fight: 2.5 - lists / 10 })] }; }
    return torn(Number(url.pathname.split('/').pop()) || 999, { status: { state: 'Hospital', until: NOW + 600 } });
  } });
  await f.connect();
  f.h.getState().pool = Array.from({ length: 20 }, (_, i) => f.h.candidate(raw(200 + i, { fair_fight: 2.9 - i / 100 })));
  await f.click('TF');
  assert.equal(f.navigations.length, 0);
  const summary = JSON.parse(f.store[LOG_STORE]).findLast(e => e.kind === 'summary');
  assert.equal(summary.counts.earlyBatches, 3, 'At most three early lists; later lists only refill an empty queue');
  assert.ok(lists >= 3);
});

const UPLOAD = 'https://shadowreapersfaction.com/api/public/script-logs';
const uploadResponder = reply => (url, body) => url.hostname === 'shadowreapersfaction.com' ? reply(body)
  : url.hostname === 'ffscouter.com' ? { targets: [raw()] } : torn(Number(url.pathname.split('/').pop()) || 999, { name: 'Reaper_9' });

for (const kind of ['pda', 'gm']) test(kind + ': Send to leadership uploads only the report; name and ID only when ticked; never the key', async () => {
  const f = await fixture({ kind, respond: uploadResponder(() => ({ status: 201, responseText: JSON.stringify({ id: 12 }) })) });
  await f.connect(true);
  assert.equal(f.h.getState().ownerName, 'Reaper_9');
  const before = f.requests.length;
  await f.click('Send to leadership');
  assert.equal(f.requests.length, before + 1, 'exactly one upload, no Torn or FFScouter calls');
  const post = f.posts.at(-1);
  assert.equal(post.url.href, UPLOAD);
  assert.deepEqual(Object.keys(post.body).sort(), ['log', 'note', 'script']);
  assert.equal(post.body.script, 'target-finder'); assert.match(post.body.log, /^TF v0.5.3 diagnostics/);
  assert.ok(!JSON.stringify(post.body).includes(TEST_KEY)); assert.ok(!post.url.search);
  assert.match(f.h.getLogHint(), /log #12/);
  f.h.getLogIdentity().checked = true;
  await f.click('Send to leadership');
  assert.deepEqual(f.posts.at(-1).body.sender, { id: 999, name: 'Reaper_9' });
  assert.ok(!JSON.stringify(f.posts.at(-1)).includes(TEST_KEY));
});

test('Send to leadership needs a trusted tap, reports server errors and keeps working state', async () => {
  let status = 429;
  const f = await fixture({ respond: uploadResponder(() => ({ status, responseText: JSON.stringify({ error: 'Too many logs sent from this connection. Try again in an hour.' }) })) });
  const before = f.requests.length;
  await f.button('Send to leadership').dispatch('click', { isTrusted: false }); await settle();
  assert.equal(f.requests.length, before);
  await f.click('Send to leadership');
  assert.match(f.h.getLogHint(), /^Not sent: Too many logs/);
  status = 500;
  await f.click('Send to leadership');
  assert.match(f.h.getLogHint(), /^Not sent: Too many logs/, 'server error text is shown, never the raw body otherwise');
  // Not connected: ticking the box still sends no identity.
  f.h.getLogIdentity().checked = true; status = 201;
  await f.click('Send to leadership');
  assert.equal(f.posts.at(-1).body.sender, undefined);
  assert.equal(f.h.getState().cooldown, 0, 'upload failures never pause TF');
});

test('saved owner names are validated on load', async () => {
  const f = await fixture({ respond: uploadResponder(() => ({})) });
  await f.connect(true);
  const saved = JSON.parse(f.store[STORE]); saved.ownerName = '<img src=x>';
  const reload = await fixture({ store: { ...f.store, [STORE]: JSON.stringify(saved) } });
  assert.equal(reload.h.getState().ownerName, '');
});

test('metadata allows the log upload host and the data-use notice mentions it', () => {
  assert.match(source, /@connect\s+shadowreapersfaction\.com/);
  assert.match(source, /Your key is never sent/);
});

test('diagnostic report lists the search settings without player data', async () => {
  const f = await fixture({ sort: null });
  await f.config({ maxStats: '100m', days: '30', minFF: '1.5', maxFF: '2.5' });
  f.h.getFields().skipTravel.checked = false; await f.click('Save settings');
  const line = f.h.logReport().split('\n').find(l => l.startsWith('Settings: '));
  assert.equal(line, 'Settings: FF 1.5-2.5; stats 0-100m; inactive 30+ days; faction any; order available; source ff; IDs 1-any; skip federal/fallen.');
  assert.ok(!f.h.logReport().includes(TEST_KEY));
});

test('backend-error IDs return to normal checks after an hour and a full list never blocks searching', async () => {
  const f = await fixture();
  await f.connect();
  const st = f.h.getState();
  st.deferred = Array.from({ length: 100 }, (_, i) => i + 1000); st.deferredUntil = Object.fromEntries(st.deferred.map(id => [id, Math.floor(f.context.Date.now() / 1000) + 3600]));
  await f.click('Find / check more');
  assert.doesNotMatch(f.h.getNotice(), /100 failed IDs/);
  assert.equal(f.h.isDeferred(1000), true);
  f.advance(3601 * 1000);
  assert.equal(f.h.isDeferred(1000), false, 'expired after an hour');
});

test('older saves without deferral times give their IDs one more hour', async () => {
  const f = await fixture(); await f.connect(true);
  const saved = JSON.parse(f.store[STORE]); saved.deferred = [100]; delete saved.deferredUntil;
  const reload = await fixture({ store: { ...f.store, [STORE]: JSON.stringify(saved) } });
  const until = reload.h.getState().deferredUntil[100];
  assert.ok(until > NOW && until <= Math.floor(reload.context.Date.now() / 1000) + 3600);
});
