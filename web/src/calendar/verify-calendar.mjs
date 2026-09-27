// Actual built App + actual calendar router + disposable durable SQLite.
// No live AVA endpoint, provider, account, notification or user database is used.
import { chromium } from 'playwright';
import express from 'express';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2]);
const serverDist = resolve(process.argv[3]);
const evidence = resolve(process.argv[4] ?? 'data/builds/atelier-c2-browser');
assert.ok(evidence.startsWith(resolve('data/builds') + sep));
await mkdir(evidence, { recursive: true });
const { openDb } = await import(pathToFileURL(resolve(serverDist, 'state/db.js')));
const { calendarRoutes } = await import(pathToFileURL(resolve(serverDist, 'routes/calendar.js')));
const token = 'local-calendar-fixture-only';
const now = Date.parse('2030-09-27T07:00:00Z');
const database = resolve(evidence, `fixture-${Date.now()}.sqlite`);
let db = openDb(database);
const auth = (req, res, next) => req.headers.authorization === `Bearer ${token}` ? next() : res.status(401).json({ error: 'missing_token' });
const router = () => calendarRoutes(db, auth, { now: () => now });
let calendar = router();
const app = express();
app.use(express.json());
app.use('/api/calendar', (req, res, next) => calendar(req, res, next));
app.use(express.static(root));
const listener = await new Promise(done => { const listener = app.listen(0, '127.0.0.1', () => done(listener)); });
const origin = `http://127.0.0.1:${listener.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [], errors = [];
const check = (label, condition) => { assert.ok(condition, label); results.push(label); };
try {
  check('real calendar route rejects unauthenticated requests', (await fetch(`${origin}/api/calendar/events?from=0&to=1`)).status === 401);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.route('**/registerSW.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.addInitScript(({ token, now }) => { localStorage.setItem('ava.token', token); localStorage.setItem('ava.ui.look', 'ink'); sessionStorage.setItem('ava:splash-seen', '1'); Date.now = () => now; }, { token, now });
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/calendar/')) return route.continue();
    let body = {};
    if (path === '/api/notes/tree') body = { folders: [], snapshot: { complete: true, version: 'fixture', fetchedAt: now, totalDocuments: 0 }, migration: { legacyProjectCount: 0, legacyRootFolderIds: [] } };
    else if (path === '/api/notes') body = { notes: [], projects: [] };
    else if (path === '/api/watches') body = { watches: [] };
    else if (path === '/api/sessions') body = { sessions: [], nextCursor: null };
    else if (path.includes('/stream') || path.includes('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.stack)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(origin);
  const navigate = () => page.getByRole('group', { name: 'Quick navigation' }).getByRole('button', { name: 'Calendar', exact: true }).click();
  await navigate(); await page.getByText('A little open space.').waitFor();
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Disposable lecture');
  await page.getByLabel('Starts', { exact: true }).fill('10:00');
  check('event opens with only essential fields', !await page.getByLabel('Location', { exact: true }).isVisible());
  await page.getByText(/More details/).click();
  await page.getByLabel('Location', { exact: true }).fill('Fixture room');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  const agenda = page.getByRole('complementary', { name: 'Selected day' });
  await agenda.getByRole('button', { name: /Disposable lecture/ }).click();
  await page.getByRole('region', { name: 'Event details' }).waitFor();
  check('real UI persisted one event', db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get().n === 1);
  await page.getByRole('button', { name: 'Edit event series' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Disposable lecture revised');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await agenda.getByRole('button', { name: /Disposable lecture revised/ }).click();
  check('versioned series edit persists', db.prepare('SELECT version FROM calendar_events').get().version === 2);
  await page.getByRole('button', { name: 'Attendance / this occurrence' }).click();
  await page.getByLabel('My plan').selectOption('skip');
  await page.getByRole('button', { name: 'Save occurrence' }).click();
  await agenda.getByRole('button', { name: /study independently/ }).waitFor();
  check('intent saved without invented outcome', db.prepare('SELECT attendance_intent_override, attendance_outcome FROM calendar_event_exceptions').get().attendance_outcome === 'unknown');
  db.close(); db = openDb(database); calendar = router();
  await page.reload(); await navigate();
  await agenda.getByRole('button', { name: /Disposable lecture revised/ }).click();
  check('reload + database restart retains event and plan', await agenda.getByText('Plan to study independently / skip').count() === 1);
  await page.getByRole('button', { name: 'Attendance / this occurrence' }).click();
  await page.getByLabel('My plan').selectOption('inherit');
  await page.getByRole('button', { name: 'Save occurrence' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  check('explicit inheritance reset persisted', db.prepare('SELECT attendance_intent_override FROM calendar_event_exceptions').get().attendance_intent_override === null);
  await page.getByRole('button', { name: 'Attendance / this occurrence' }).click();
  await page.getByLabel('What happened').selectOption('attended');
  await page.getByRole('button', { name: 'Save occurrence' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const attendance = db.prepare('SELECT attendance_intent_override, attendance_outcome FROM calendar_event_exceptions').get();
  check('outcome-only edit does not pin inherited plan', attendance.attendance_intent_override === null && attendance.attendance_outcome === 'attended');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of ['Month', 'Week', 'Day']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await page.waitForTimeout(80);
      check(`${width}/${mode} no viewport overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: resolve(evidence, `calendar-${width}-${mode}.png`) });
    }
    await page.getByRole('button', { name: 'New event' }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(650); // inspect settled motion, not the entering sheet
    await page.getByLabel('Title', { exact: true }).focus();
    check(`${width} open field uses an underline not a nested focus box`, await page.getByLabel('Title', { exact: true }).evaluate(el => {
      const style = getComputedStyle(el); return style.outlineStyle === 'none' && style.boxShadow !== 'none';
    }));
    check(`${width} editor fits`, await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    const bounds = await page.getByRole('dialog').boundingBox();
    check(`${width} editor stays inside viewport`, bounds.y >= -1 && bounds.y + bounds.height <= 901);
    await page.screenshot({ path: resolve(evidence, `editor-${width}.png`) });
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await agenda.getByRole('button', { name: /Disposable lecture revised/ }).click();
  await page.getByRole('button', { name: 'Edit event series' }).click();
  // Another legitimate writer updates the exact record while this editor is open.
  const id = db.prepare('SELECT id FROM calendar_events').get().id;
  await fetch(`${origin}/api/calendar/events/${id}`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 2, location: 'Changed elsewhere' }) });
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'changed elsewhere' }).waitFor();
  check('stale edit locked with no overwrite', await page.getByRole('button', { name: 'Save event', exact: true }).isDisabled() && db.prepare('SELECT version FROM calendar_events').get().version === 3);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Edit event series' }).click();
  await page.getByText(/More details/).click();
  check('closing a conflict reads the authoritative new version', await page.getByLabel('Location', { exact: true }).inputValue() === 'Changed elsewhere');
  await page.getByLabel('Location', { exact: true }).fill('Reviewed latest location');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  check('reopened edit saves once with latest version', db.prepare('SELECT version FROM calendar_events').get().version === 4);
  // HTTP 409 is the expected stale-write test, not a JavaScript/runtime error.
  check(`no unexpected browser errors: ${errors.join(';')}`, errors.every(e => String(e).includes('409')));
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ checks: results.length, results, fixtureDatabase: database, liveDataTouched: false }, null, 2));
  console.log(JSON.stringify({ checks: results.length, evidence }));
  await context.close();
} finally { await browser.close(); await new Promise(done => listener.close(done)); db.close(); }
