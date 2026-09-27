// Built AVA + real watch read route + durable pause transitions, no transport.
import { chromium } from 'playwright';
import express from 'express';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const web = resolve(process.argv[2]), server = resolve(process.argv[3]);
const evidence = resolve(process.argv[4] ?? 'data/builds/reminder-pause-browser');
assert.ok(evidence.startsWith(resolve('data/builds') + sep));
await mkdir(evidence, { recursive: true });
const load = path => import(pathToFileURL(resolve(server, path)));
const { openDb } = await load('state/db.js');
const { createWatch, setWatchEnabled, deleteWatch } = await load('state/watches.js');
const { claimDueReminders, deferReminder, REMINDER_WINDOW_MS } = await load('state/reminders.js');
const { watchesRoutes } = await load('routes/watches.js');
const path = resolve(evidence, `fixture-${Date.now()}.sqlite`), due = Date.parse('2030-09-27T10:00:00Z');
let db = openDb(path);
const paused = createWatch(db, { prompt: 'Disposable paused reminder', kind: 'reminder', runAt: due, timeZone: 'Europe/Dublin' });
setWatchEnabled(db, paused.id, false);
assert.deepEqual(claimDueReminders(db, due + REMINDER_WINDOW_MS), []);
const resumed = createWatch(db, { prompt: 'Disposable resumed reminder', kind: 'reminder', runAt: due + 7_200_000, timeZone: 'Europe/Dublin' });
const [claim] = claimDueReminders(db, resumed.run_at);
setWatchEnabled(db, resumed.id, false); deferReminder(db, claim, 'paused', resumed.run_at + 1);
setWatchEnabled(db, resumed.id, true);
const token = 'local-pause-fixture-only';
const auth = (req, res, next) => req.headers.authorization === `Bearer ${token}` ? next() : res.status(401).json({ error: 'missing_token' });
const router = () => watchesRoutes(db, auth);
let watches = router();
const app = express();
app.use('/api/watches', (req, res, next) => req.method === 'GET' ? watches(req, res, next) : res.status(405).end());
app.use(express.static(web));
const listener = await new Promise(done => { const l = app.listen(0, '127.0.0.1', () => done(l)); });
const origin = `http://127.0.0.1:${listener.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [], errors = [], writes = [];
const check = (label, value) => { assert.ok(value, label); checks.push(label); };
try {
  check('watch evidence requires authentication', (await fetch(origin + '/api/watches')).status === 401);
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await context.route('**/registerSW.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
    await context.addInitScript(({ token, due }) => {
      localStorage.setItem('ava.token', token); localStorage.setItem('ava.ui.look', 'ink');
      localStorage.setItem('ava-motion', 'reduced'); sessionStorage.setItem('ava:splash-seen', '1'); Date.now = () => due;
    }, { token, due });
    await context.route('**/api/**', route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (req.method() !== 'GET') { writes.push(path); return route.fulfill({ status: 405, body: '' }); }
      if (path === '/api/watches') return route.continue();
      let body = {};
      if (path === '/api/calendar/events') body = { fetchedAt: due, complete: true, events: [], occurrences: [] };
      else if (path === '/api/notes') body = { projects: [], notes: [] };
      else if (path === '/api/sessions') body = { sessions: [], nextCursor: null };
      else if (path.includes('/stream') || path.includes('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ':fixture\n\n' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const navigate = async () => {
      await page.getByRole('group', { name: 'Quick navigation' }).getByRole('button', { name: 'Calendar', exact: true }).click();
      await page.getByRole('button', { name: 'Reminders', exact: true }).click();
      await page.getByText(paused.prompt, { exact: true }).waitFor();
    };
    await page.goto(origin); await navigate();
    const expiredRow = page.getByRole('listitem').filter({ hasText: paused.prompt });
    const resumedRow = page.getByRole('listitem').filter({ hasText: resumed.prompt });
    check(`${width} expired pause has historical explanation`, (await expiredRow.textContent()).includes('It was paused when AVA last checked.') && !(await expiredRow.textContent()).includes('offline'));
    check(`${width} resumed row is scheduled without obsolete pause copy`, (await resumedRow.textContent()).includes('Scheduled') && !(await resumedRow.textContent()).includes("It's paused"));
    check(`${width} no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(evidence, `reminders-${width}.png`), fullPage: true });
    db.close(); db = openDb(path); watches = router();
    await page.reload(); await navigate();
    check(`${width} restart retains truthful pause history`, (await expiredRow.textContent()).includes('It was paused when AVA last checked.'));
    await context.close();
  }
  check('no browser writes', writes.length === 0);
  check('zero browser errors', errors.length === 0);
  check('zero transmission attempts', db.prepare('SELECT SUM(attempts) AS n FROM reminder_occurrences').get().n === 0);
  deleteWatch(db, paused.id); deleteWatch(db, resumed.id);
  check('fixture rows cleaned', db.prepare('SELECT COUNT(*) AS n FROM watches').get().n === 0);
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ checks: checks.length, results: checks, liveDataTouched: false, realPush: false }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, evidence }));
} finally { await browser.close(); await new Promise(done => listener.close(done)); db.close(); }
