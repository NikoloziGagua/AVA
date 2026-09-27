// Built AVA + real Notes routes + disposable SQLite. No live data/provider access.
import { chromium } from 'playwright';
import express from 'express';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2]), serverDist = resolve(process.argv[3]);
const evidence = resolve(process.argv[4] ?? 'data/builds/atelier-notes-browser');
assert.ok(evidence.startsWith(resolve('data/builds') + sep)); await mkdir(evidence, { recursive: true });
const { openDb } = await import(pathToFileURL(resolve(serverDist, 'state/db.js')));
const { notesRoutes } = await import(pathToFileURL(resolve(serverDist, 'routes/notes.js')));
const database = resolve(evidence, `fixture-${Date.now()}.sqlite`), token = 'local-notes-fixture-only';
let db = openDb(database);
const auth = (req, res, next) => req.headers.authorization === `Bearer ${token}` ? next() : res.status(401).json({ error: 'missing_token' });
const createRouter = () => notesRoutes(db, auth, { queueSelfImprove: () => { throw Error('Not permitted in design fixture'); } });
let router = createRouter();
const app = express(); app.use(express.json()); app.use('/api/notes', (req, res, next) => router(req, res, next)); app.use(express.static(root));
const listener = await new Promise(done => { const l = app.listen(0, '127.0.0.1', () => done(l)); });
const origin = `http://127.0.0.1:${listener.address().port}`;
const request = async (path, body, method = 'POST') => {
  const r = await fetch(origin + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(r.ok, `${method} ${path}: ${r.status}`); return r.json();
};
const parent = (await request('/api/notes/folders', { name: 'Fixture University' })).folder;
const child = (await request('/api/notes/folders', { name: 'Agile Development', parentId: parent.id })).folder;
const long = Array.from({ length: 7 }, (_, i) => `## Topic ${i + 1}\n\n${'A disposable explanation of a concept, an example and an open question. '.repeat(18)}`).join('\n\n');
const first = (await request('/api/notes', { title: 'Lecture one', content: long, folderId: child.id, documentType: 'study' })).note;
await request('/api/notes', { title: 'Reflection', content: 'A separate document. Never a page of Lecture one.', folderId: child.id });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [], errors = [], writes = [];
const check = (label, value) => { assert.ok(value, label); checks.push(label); };
try {
  check('Notes route requires authentication', (await fetch(`${origin}/api/notes/tree`)).status === 401);
  for (const look of ['ink', 'paper']) for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    await context.route('**/registerSW.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
    await context.addInitScript(({ token, look }) => { localStorage.setItem('ava.token', token); localStorage.setItem('ava.ui.look', look); localStorage.setItem('ava-motion', 'reduced'); sessionStorage.setItem('ava:splash-seen', '1'); }, { token, look });
    await context.route('**/api/**', route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path.startsWith('/api/notes')) { if (req.method() !== 'GET') writes.push(req.method() + ' ' + path); return route.continue(); }
      let body = {};
      if (path === '/api/calendar/events') body = { fetchedAt: Date.now(), complete: true, events: [], occurrences: [] };
      else if (path === '/api/watches') body = { watches: [] };
      else if (path === '/api/sessions') body = { sessions: [], nextCursor: null };
      else if (path.includes('/stream') || path.includes('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ':fixture\n\n' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.stack)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(origin);
    await page.getByRole('group', { name: 'Quick navigation' }).getByRole('button', { name: 'Notes', exact: true }).click();
    await page.getByRole('navigation', { name: 'Folders', exact: true }).getByRole('button', { name: /^Agile Development/ }).click();
    const files = page.getByRole('navigation', { name: 'Files in Agile Development' });
    await files.getByRole('button', { name: 'Lecture one', exact: true }).click();
    await page.getByRole('region', { name: 'Note document' }).waitFor();
    check(`${look}/${width} dark/default or explicit Paper honoured`, await page.locator('html').getAttribute('data-look') === look);
    const counter = page.getByTestId('page-counter'); check(`${look}/${width} one long file has pages`, (await counter.textContent()) !== 'PAGE 1 / 1');
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    check(`${look}/${width} turns inside one file`, (await counter.textContent()).startsWith('PAGE 2 /'));
    await page.getByRole('button', { name: 'Show as one page', exact: true }).click();
    await page.getByRole('article', { name: 'Lecture one, full document' }).waitFor();
    check(`${look}/${width} complete canonical Markdown available`, await page.getByRole('heading', { name: 'Topic 7', exact: true }).count() === 1);
    check(`${look}/${width} no viewport overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(evidence, `notes-${look}-${width}.png`) });
    await page.getByRole('button', { name: 'Edit file', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.screenshot({ path: resolve(evidence, `notes-editor-${look}-${width}.png`) });
    check(`${look}/${width} editor fits`, await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    if (look === 'ink' && width === 1440) {
      await page.getByRole('dialog').getByRole('textbox', { name: 'Document', exact: true }).fill(long + '\n\nA saved clarification.');
      await page.getByRole('button', { name: 'Save file', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      check('real versioned edit persisted once', db.prepare('SELECT version FROM notes WHERE id=?').get(first.id).version === 2);
      db.close(); db = openDb(database); router = createRouter();
      check('database reopen retains complete source', db.prepare('SELECT content FROM notes WHERE id=?').get(first.id).content.endsWith('A saved clarification.'));
    } else { await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' }); }
    if (width < 850) {
      await page.getByRole('button', { name: 'Back to files', exact: true }).click();
      check(`${look}/${width} back shows files not entire reader`, await files.isVisible() && !await page.getByRole('region', { name: 'Note document' }).isVisible());
      await page.getByRole('button', { name: 'Back to library', exact: true }).click();
      check(`${look}/${width} back reaches folders`, await page.getByRole('navigation', { name: 'Folders', exact: true }).isVisible());
    }
    await page.reload();
    await page.getByRole('group', { name: 'Quick navigation' }).getByRole('button', { name: 'Notes', exact: true }).click();
    await page.getByRole('navigation', { name: 'Folders', exact: true }).getByRole('button', { name: /^Agile Development/ }).click();
    check(`${look}/${width} reload retains both separate files`, await files.getByRole('button', { name: 'Lecture one', exact: true }).count() === 1 && await files.getByRole('button', { name: 'Reflection', exact: true }).count() === 1);
    await context.close();
  }
  check('navigation/pagination produced no mutation; only explicit edit', writes.length === 1 && writes[0] === `PATCH /api/notes/${first.id}`);
  check(`zero browser errors: ${errors.join(';')}`, errors.length === 0);
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ checks: checks.length, results: checks, writes, fixtureDatabase: database, liveDataTouched: false }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, evidence }));
} finally { await browser.close(); await new Promise(done => listener.close(done)); db.close(); }
