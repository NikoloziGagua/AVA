// Built App + authenticated watch routes + disposable SQLite. No scheduler,
// device, push service, provider, or user database participates in this fixture.
import { chromium } from 'playwright';
import express from 'express';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2]), server = resolve(process.argv[3]);
const evidence = resolve(process.argv[4] ?? 'data/builds/atelier-reminders-browser');
assert.ok(evidence.startsWith(resolve('data/builds') + sep)); await mkdir(evidence, { recursive: true });
const load = p => import(pathToFileURL(resolve(server, p)));
const { openDb } = await load('state/db.js');
const { createWatch, setWatchEnabled, deleteWatch, listWatches } = await load('state/watches.js');
const { claimDueReminders, beginReminderSend, finishReminder } = await load('state/reminders.js');
const { watchesRoutes } = await load('routes/watches.js');
const database = resolve(evidence, `fixture-${Date.now()}.sqlite`), token = 'local-reminder-fixture-only', now = Date.now();
let db = openDb(database);
const scheduled = createWatch(db, { prompt: 'Prepare for the seminar', kind: 'reminder', runAt: now + 3_600_000, timeZone: 'Europe/Dublin' });
const paused = createWatch(db, { prompt: 'A paused local fixture', kind: 'reminder', runAt: now + 7_200_000, timeZone: 'Europe/Dublin' });
setWatchEnabled(db, paused.id, false);
const accepted = createWatch(db, { prompt: 'Synthetic service-acceptance receipt', kind: 'reminder', runAt: now - 60_000, timeZone: 'Europe/Dublin' });
const [claim] = claimDueReminders(db, now); const sending = beginReminderSend(db, claim, now + 1);
assert.equal(claim.watch_id, accepted.id);
// Explicit test receipt, not a real provider call or a claim of phone delivery.
finishReminder(db, sending, { subscriptions: { total: 1, accepted: 1, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 }, reasonCode: null }, now + 2);
const auth = (req, res, next) => req.headers.authorization === `Bearer ${token}` ? next() : res.status(401).json({ error: 'missing_token' });
let router = watchesRoutes(db, auth);
const app = express(); app.use(express.json()); app.use('/api/watches', (req, res, next) => router(req, res, next)); app.use(express.static(root));
const listener = await new Promise(done => { const l = app.listen(0, '127.0.0.1', () => done(l)); });
const origin = `http://127.0.0.1:${listener.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [], errors = [], writes = [];
let activePage;
const check = (label, value) => { assert.ok(value, label); checks.push(label); };
const navigate = async page => {
  await page.getByRole('group', { name: 'Quick navigation' }).getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByRole('button', { name: 'Reminders', exact: true }).click();
  await page.getByRole('heading', { name: 'A little less to remember.', exact: true }).waitFor();
};
const openMenu = async (page, name) => {
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.locator('.ds-menu').getByRole('button', { name, exact: true }).click();
};
const localWhen = instant => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant).replace(' ', 'T');
try {
  check('authenticated reads required', (await fetch(origin + '/api/watches')).status === 401);
  for (const look of ['ink', 'paper']) for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Europe/Dublin', serviceWorkers: 'block' });
    await context.route('**/registerSW.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
    await context.addInitScript(({ token, look }) => {
      localStorage.setItem('ava.token', token); localStorage.setItem('ava.ui.look', look);
      localStorage.setItem('ava-motion', 'reduced'); sessionStorage.setItem('ava:splash-seen', '1');
    }, { token, look });
    let readMode = 'real', loseReceipt = false;
    await context.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path.startsWith('/api/watches')) {
        if (req.method() !== 'GET') writes.push({ method: req.method(), path, body: req.postData() });
        if (req.method() === 'POST' && path === '/api/watches' && loseReceipt) {
          loseReceipt = false; const stored = await route.fetch(); assert.ok(stored.ok());
          return route.fulfill({ contentType: 'application/json', body: '{}' });
        }
        if (req.method() === 'GET' && path === '/api/watches' && readMode !== 'real') return route.fulfill({ contentType: 'application/json', body: readMode === 'empty' ? '{"watches":[]}' : 'null' });
        return route.continue();
      }
      let body = {};
      if (path === '/api/calendar/events') body = { fetchedAt: now, complete: true, events: [], occurrences: [] };
      else if (path === '/api/notes') body = { notes: [], projects: [] };
      else if (path === '/api/sessions') body = { sessions: [], nextCursor: null };
      else if (path === '/api/memory') body = {
        personality: 'Disposable fixture', memoryIndex: '', preferences: { lines: [] }, observations: { lines: [] }, projects: [],
        personaProfile: { version: 'fixture', architecture: 'identity + collaboration + context registers', registers: [],
          lab: { kind: 'deterministic_contract', scenarioCount: 0, coverage: { casual: 0, execution: 0, brainstorming: 0, repair: 0, high_stakes: 0 }, channels: ['chat', 'voice'], valid: true, caveat: 'Disposable UI fixture; no persona assessment performed.' } },
      };
      else if (path === '/api/people') body = { people: [] };
      else if (path === '/api/playbooks') body = { playbooks: [] };
      else if (path.includes('/stream') || path.includes('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ':fixture\n\n' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    activePage = page;
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(origin); await navigate(page);
    const receipt = page.getByRole('listitem').filter({ hasText: accepted.prompt });
    await receipt.waitFor();
    check(`${look}/${width} truthful service receipt`, (await receipt.textContent()).includes('Accepted by notification service') && (await receipt.textContent()).includes("can't confirm your phone showed it"));
    check(`${look}/${width} static Nocturne`, await page.locator('.ds-schedule [data-atmosphere] canvas').getAttribute('data-motion') === 'static');
    check(`${look}/${width} no nested item cards`, await page.locator('.ds-schedule-item').first().evaluate(el => getComputedStyle(el).borderTopWidth === '0px' && getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)'));
    const draft = page.getByLabel('What should AVA remind you about?', { exact: true }), when = page.getByLabel('When', { exact: true });
    await draft.focus(); await draft.fill('A local reminder draft'); await page.keyboard.press('Enter');
    check(`${look}/${width} underline focus`, await draft.evaluate(el => getComputedStyle(el).boxShadow !== 'none'));
    check(`${look}/${width} explicit zone`, await page.locator('.ds-reminder-when').textContent().then(text => text.includes('Europe/Dublin')));
    check(`${look}/${width} no typing write`, writes.length === (look === 'ink' && width === 1440 ? 0 : 3));
    if (look === 'ink' && width === 1440) {
      await when.fill(localWhen(now + 5 * 3_600_000));
      await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
      await page.getByText('Reminder saved.', { exact: true }).waitFor();
      const saved = listWatches(db).find(w => w.prompt === 'A local reminder draft');
      check('explicit real create persisted exact one-off and zone', writes.length === 1 && saved?.kind === 'reminder' && saved.once === 1 && saved.time_zone === 'Europe/Dublin');
      db.close(); db = openDb(database); router = watchesRoutes(db, auth);
      check('database reopen retains reminder', listWatches(db).some(w => w.id === saved.id));
      await draft.fill('Unconfirmed local reminder'); loseReceipt = true;
      await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
      await page.getByText(/couldn't confirm whether this reminder was saved. The list has been refreshed/).waitFor();
      check('unknown create keeps draft and never replays', writes.length === 2 && await draft.inputValue() === 'Unconfirmed local reminder' && listWatches(db).filter(w => w.prompt === 'Unconfirmed local reminder').length === 1);
      await page.getByRole('button', { name: 'Delete reminder: A local reminder draft', exact: true }).click();
      check('delete first asks confirmation', writes.length === 2);
      await page.getByRole('button', { name: 'Keep it', exact: true }).click();
      check('keep is local', writes.length === 2);
      await page.getByRole('button', { name: 'Delete reminder: A local reminder draft', exact: true }).click();
      await page.getByRole('button', { name: 'Delete it', exact: true }).click();
      await page.getByRole('button', { name: 'Delete reminder: A local reminder draft', exact: true }).waitFor({ state: 'hidden' });
      check('confirmed delete persisted', writes.length === 3 && !listWatches(db).some(w => w.id === saved.id));
      readMode = 'broken'; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.getByText(/Couldn't refresh. Showing reminders as of/).waitFor();
      check('stale read keeps rows and warns honestly', await receipt.count() === 1);
      readMode = 'real'; await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.getByText(/Couldn't refresh. Showing reminders as of/).waitFor({ state: 'hidden' });
    }
    await page.screenshot({ path: resolve(evidence, `reminders-${look}-${width}.png`) });
    check(`${look}/${width} no horizontal overflow`, await page.locator('.ds-schedule').evaluate(el => el.scrollWidth <= el.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth));
    const summary = page.locator('.ds-schedule-explainer summary');
    check(`${look}/${width} delivery explanation starts collapsed`, await summary.evaluate(el => !el.parentElement.open));
    await summary.focus(); await page.keyboard.press('Enter');
    await page.getByRole('region', { name: 'How reminders reach you', exact: true }).waitFor({ state: 'visible' });
    check(`${look}/${width} keyboard disclosure`, await summary.evaluate(el => el.parentElement.open));
    await page.reload(); await navigate(page); await receipt.waitFor();
    check(`${look}/${width} reload restores authoritative receipts`, await receipt.count() === 1);
    if (width === 390) {
      await page.emulateMedia({ forcedColors: 'active' }); await draft.focus();
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      check(`${look} forced-colour focus`, await draft.evaluate(el => getComputedStyle(el).borderBottomWidth === '2px'));
      await page.emulateMedia({ forcedColors: 'none' });
    }
    if (width === 1440) {
      await openMenu(page, 'Reminders & watches');
      const legacy = page.locator('[data-reminder-appearance="legacy"][data-reminder-tone="good"]').first(); await legacy.waitFor();
      const legacyStyle = await legacy.evaluate(el => ({ font: getComputedStyle(el).fontSize, colour: getComputedStyle(el).color }));
      check(`${look} Watches legacy receipt stays legacy: ${JSON.stringify(legacyStyle)}`, await page.locator('[data-reminder-appearance="atelier"]').count() === 0 && Number.parseFloat(legacyStyle.font) >= 12);
      await page.screenshot({ path: resolve(evidence, `legacy-watches-${look}.png`) });
      await openMenu(page, 'Memory');
      await page.getByRole('button', { name: 'List', exact: true }).click();
      await legacy.waitFor();
      check(`${look} Memory legacy receipt stays legacy`, await page.locator('[data-reminder-appearance="atelier"]').count() === 0);
      await legacy.scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(evidence, `legacy-memory-${look}.png`) });
      readMode = 'empty'; await navigate(page); await page.getByText(/No reminders yet/).waitFor();
      check(`${look} empty state is designed`, await page.getByText(/No reminders yet/).count() === 1);
      readMode = 'broken'; await page.reload(); await navigate(page);
      await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
      readMode = 'real'; await page.getByRole('button', { name: 'Retry', exact: true }).click(); await receipt.waitFor();
      check(`${look} initial error can recover`, await receipt.count() === 1);
    }
    await context.close();
  }
  check('only explicit fixture creates and confirmed delete wrote', writes.length === 3 && writes[0].method === 'POST' && writes[1].method === 'POST' && writes[2].method === 'DELETE');
  check(`zero unexpected errors: ${errors.join(';')}`, errors.length === 0);
  for (const w of listWatches(db)) deleteWatch(db, w.id);
  check('disposable fixture rows cleaned', listWatches(db).length === 0);
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ checks: checks.length, results: checks, writes, database, realTransportUsed: false, liveDataTouched: false }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, evidence }));
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: resolve(evidence, 'failure.png') });
    await writeFile(resolve(evidence, 'failure.json'), JSON.stringify({ message: String(error), checks, errors, writes, body: (await activePage.locator('body').innerText()).slice(0, 12000), fields: await activePage.locator('.ds-schedule-field').evaluateAll(els => els.map(el => el.outerHTML.slice(0, 3000))), focus: await activePage.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') })) }, null, 2));
  }
  throw error;
} finally { await browser.close(); await new Promise(done => listener.close(done)); db.close(); }
