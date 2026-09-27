// Built AVA + authenticated Notes routes + disposable SQLite. No user/provider data.
import { chromium } from 'playwright';
import express from 'express';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2]), serverDist = resolve(process.argv[3]);
const evidence = resolve(process.argv[4] ?? 'data/builds/atelier-ideas-browser');
assert.ok(evidence.startsWith(resolve('data/builds') + sep));
await mkdir(evidence, { recursive: true });
const { openDb } = await import(pathToFileURL(resolve(serverDist, 'state/db.js')));
const { notesRoutes } = await import(pathToFileURL(resolve(serverDist, 'routes/notes.js')));
const database = resolve(evidence, `fixture-${Date.now()}.sqlite`), token = 'local-ideas-fixture-only';
let db = openDb(database);
const auth = (req, res, next) => req.headers.authorization === `Bearer ${token}` ? next() : res.status(401).json({ error: 'missing_token' });
const makeRouter = () => notesRoutes(db, auth, { queueSelfImprove: () => { throw Error('Unavailable in fixture'); } });
let router = makeRouter();
const app = express(); app.use(express.json()); app.use('/api/notes', (req, res, next) => router(req, res, next)); app.use(express.static(root));
const listener = await new Promise(done => { const l = app.listen(0, '127.0.0.1', () => done(l)); });
const origin = `http://127.0.0.1:${listener.address().port}`;
const seed = async body => {
  const res = await fetch(origin + '/api/notes', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(res.ok); return (await res.json()).note;
};
const selected = await seed({ title: 'A quieter morning', content: 'Make a little room for reading before the day begins.', kind: 'idea' });
await seed({ title: 'A small project with a long reference', content: 'https://example.invalid/' + 'reference'.repeat(30), kind: 'idea' });
await seed({ title: 'Not an idea', content: 'Not part of the Ideas view.', kind: 'task' });
await seed({ title: 'Archived thought', content: 'Not part of the Ideas view.', kind: 'idea', status: 'archived' });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [], errors = [], writes = [];
const check = (label, value) => { assert.ok(value, label); checks.push(label); };
const openIdeas = async page => {
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.locator('.ds-menu').getByRole('button', { name: 'Ideas', exact: true }).click();
  await page.getByRole('heading', { name: 'Keep the spark.' }).waitFor();
};
try {
  check('Notes requires authentication', (await fetch(origin + '/api/notes')).status === 401);
  for (const look of ['ink', 'paper']) for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    await context.route('**/registerSW.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
    await context.addInitScript(({ token, look }) => {
      localStorage.setItem('ava.token', token); localStorage.setItem('ava.ui.look', look);
      localStorage.setItem('ava-motion', 'reduced'); sessionStorage.setItem('ava:splash-seen', '1');
    }, { token, look });
    await context.route('**/api/**', route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path.startsWith('/api/notes')) { if (req.method() !== 'GET') writes.push({ method: req.method(), path, body: req.postDataJSON() }); return route.continue(); }
      let body = {};
      if (path === '/api/calendar/events') body = { fetchedAt: Date.now(), complete: true, events: [], occurrences: [] };
      else if (path === '/api/watches') body = { watches: [] };
      else if (path === '/api/sessions') body = { sessions: [], nextCursor: null };
      else if (path.includes('/stream') || path.includes('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ':fixture\n\n' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.stack)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(origin); await openIdeas(page);
    const ideaCard = page.getByRole('button', { name: 'Open A quieter morning in Notes', exact: true });
    await ideaCard.waitFor();
    check(`${look}/${width} only live ideas`, !await page.getByText('Not an idea', { exact: true }).count() && !await page.getByText('Archived thought', { exact: true }).count());
    check(`${look}/${width} Silk static under Reduced`, await page.locator('[data-atmosphere="silk"] canvas').getAttribute('data-motion') === 'static');
    check(`${look}/${width} real update timezone`, (await ideaCard.locator('time').textContent()).includes('Dublin'));
    const draft = page.getByRole('textbox', { name: "What's the idea?" });
    await draft.focus();
    check(`${look}/${width} visible underline focus`, await draft.evaluate(el => getComputedStyle(el).outlineStyle === 'none' && getComputedStyle(el).boxShadow !== 'none'));
    await draft.fill('A thought to keep\nWith exact words: <not HTML> & "quotes".');
    await page.keyboard.press('Enter');
    check(`${look}/${width} typing does not save`, writes.length === (look === 'ink' && width === 1440 ? 0 : 1));
    if (look === 'ink' && width === 1440) {
      await draft.locator('xpath=ancestor::form').evaluate(el => { el.requestSubmit(); el.requestSubmit(); });
      await page.getByText('Idea saved.', { exact: true }).waitFor();
      check('rapid submit creates one real idea', writes.length === 1 && writes[0].body.kind === 'idea' && writes[0].body.projectId === null);
      check('exact non-HTML words persisted', db.prepare('SELECT content FROM notes ORDER BY created_at DESC LIMIT 1').get().content === 'A thought to keep\nWith exact words: <not HTML> & "quotes".');
      db.close(); db = openDb(database); router = makeRouter();
      check('database reopen preserves saved idea', db.prepare("SELECT COUNT(*) AS n FROM notes WHERE kind='idea'").get().n === 4);
    }
    await page.screenshot({ path: resolve(evidence, `ideas-${look}-${width}.png`) });
    check(`${look}/${width} no viewport or workspace overflow`, await page.locator('.ds-ideas').evaluate(el => el.scrollWidth <= el.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth));
    await ideaCard.focus();
    check(`${look}/${width} card keyboard focus visible`, await ideaCard.evaluate(el => getComputedStyle(el).outlineStyle !== 'none'));
    await page.keyboard.press('Enter');
    const reader = page.getByRole('region', { name: 'Note document' });
    await reader.getByRole('heading', { name: 'A quieter morning', exact: true }).waitFor();
    check(`${look}/${width} exact note handoff`, await reader.getByRole('heading', { name: 'A quieter morning', exact: true }).count() === 1 && await reader.getByText(selected.content, { exact: true }).count() === 1);
    await page.reload(); await openIdeas(page);
    await page.getByRole('button', { name: /Open A thought to keep/ }).waitFor();
    check(`${look}/${width} saved capture survives App reload`, await page.getByRole('button', { name: /Open A thought to keep/ }).count() === 1);
    if (look === 'ink' && width === 390) {
      await page.emulateMedia({ forcedColors: 'active' }); await draft.focus();
      // Media emulation acknowledges the setting before Edge necessarily paints it.
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const focus = await draft.evaluate(el => ({ forced: matchMedia('(forced-colors: active)').matches, visible: el.matches(':focus-visible'), border: getComputedStyle(el).borderBottomWidth }));
      check(`forced colours retains focus boundary: ${JSON.stringify(focus)}`, focus.forced && focus.visible && focus.border === '2px');
    }
    await context.close();
  }
  check('only explicit capture mutated state', writes.length === 1 && writes[0].path === '/api/notes');
  check(`zero browser errors: ${errors.join(';')}`, errors.length === 0);
  db.prepare('DELETE FROM notes').run();
  check('disposable fixture records cleaned', db.prepare('SELECT COUNT(*) AS n FROM notes').get().n === 0);
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ checks: checks.length, results: checks, writes, database, liveDataTouched: false }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, evidence }));
} finally { await browser.close(); await new Promise(done => listener.close(done)); db.close(); }
