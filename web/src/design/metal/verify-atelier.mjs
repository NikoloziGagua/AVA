// Built production App; disposable browser-only API fixtures. Never contacts AVA's runtime.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'data/builds/atelier-m1-web');
const evidence = resolve('data/builds/atelier-m1-browser');
await mkdir(evidence, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
  if (req.method !== 'GET' || !file.startsWith(root + sep) || !mime[extname(file)]) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', mime[extname(file)]); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const check = (test, condition) => { assert.ok(condition, test); results.push(test); };
try {
  for (const look of ['ink', 'paper']) for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    // Fixture routing must not be intercepted by a real service worker. PWA
    // precache integrity is verified separately, not claimed by this UI smoke.
    await context.route('**/registerSW.js', route => route.fulfill({ contentType: 'text/javascript', body: '/* UI fixture: service-worker registration disabled */' }));
    const errors = [], writes = [];
    page.on('pageerror', e => errors.push(e.stack || e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const now = Date.now();
    const session = { id: 'atelier-fixture-chat', title: 'A local design check', origin: 'human', created_at: now, updated_at: now, last_human_activity_at: now, status: 'idle', pinned: 0 };
    const note = { id: 'atelier-fixture-note', title: 'A thought worth keeping', content: 'Disposable local browser fixture.', kind: 'documentation', status: 'ideas', pinned: true, updatedAt: now, createdAt: now, tags: [], links: [], changeLog: [], collection: null, projectId: null, section: 'capture', source: 'manual', sourceSessionId: null, promotion: null, version: 1 };
    await context.addInitScript(({ look }) => {
      localStorage.setItem('ava.token', 'browser-fixture-not-a-credential');
      localStorage.setItem('ava.ui.look', look);
      localStorage.setItem('ava-motion', 'full');
      localStorage.setItem('ava:last-chat-session', 'atelier-fixture-chat');
      sessionStorage.setItem('ava:splash-seen', '1');
    }, { look });
    await context.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() !== 'GET') writes.push(`${request.method()} ${path}`);
      let body = {};
      if (path === '/api/sessions') body = { sessions: [session], nextCursor: null };
      else if (path === '/api/sessions/atelier-fixture-chat') body = { session, messages: [
        { id: 1, role: 'user', content: 'Help me organise this week.', created_at: now },
        { id: 2, role: 'assistant', content: 'Start with one clear priority.\n\n- Read the lecture notes.\n- Leave some breathing room.', created_at: now },
      ] };
      else if (path === '/api/calendar/events') body = { fetchedAt: now, occurrences: [], complete: true };
      else if (path === '/api/notes') body = { notes: [note], projects: [] };
      else if (path === '/api/watches') body = { watches: [] };
      else if (path.includes('/events') || path.includes('/stream')) {
        await route.fulfill({ contentType: 'text/event-stream', body: ': local read-only fixture\n\n' }); return;
      }
      else if (path.includes('chips')) body = { chips: [] };
      else if (path === '/api/voice/engine') body = { engine: 'openai' };
      else if (path === '/api/reasoning') body = { level: 'medium' };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(origin);
    await page.getByRole('heading', { name: /Good .*Niko/ }).waitFor();
    await page.getByRole('button', { name: /A thought worth keeping/ }).waitFor();
    const home = await page.locator('.ds-atelier-home').evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight, width: el.scrollWidth }));
    check(`${look}/${width} Home fits`, home.scroll <= home.client + 1 && home.width <= width);
    const face = page.locator('.ds-home-face');
    check(`${look}/${width} face has room`, (await face.boundingBox()).height >= 200);
    const atmosphere = page.locator('.ds-atmosphere canvas');
    const first = await atmosphere.evaluate(el => el.toDataURL());
    await page.waitForTimeout(250);
    check(`${look}/${width} animated pixels`, await atmosphere.evaluate(el => el.toDataURL()) !== first);
    await page.evaluate(() => { localStorage.setItem('ava-motion', 'reduced'); window.dispatchEvent(new Event('ava-motion-change')); });
    await page.locator('.ds-atmosphere canvas[data-motion="static"]').waitFor();
    const still = await atmosphere.evaluate(el => el.toDataURL());
    await page.waitForTimeout(150);
    check(`${look}/${width} reduced frame stable`, await atmosphere.evaluate(el => el.toDataURL()) === still);
    await page.screenshot({ path: resolve(evidence, `home-${look}-${width}.png`) });
    const input = page.getByRole('textbox', { name: 'Message AVA' });
    await input.fill('Keep this unsent draft');
    await page.getByRole('group', { name: 'Quick navigation' }).getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByRole('region', { name: 'Recent notes' }).waitFor();
    check(`${look}/${width} draft survives`, await input.inputValue() === 'Keep this unsent draft');
    check(`${look}/${width} Silk destination`, await page.locator('[data-atmosphere="silk"]').count() === 1);
    check(`${look}/${width} no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(evidence, `today-${look}-${width}.png`) });
    await page.getByRole('group', { name: 'Quick navigation' }).getByRole('button', { name: 'Talk', exact: true }).click();
    await page.locator('.ds-quiet-conversation').waitFor();
    await page.getByText('Help me organise this week.', { exact: true }).waitFor();
    check(`${look}/${width} remembered exact chat`, await page.getByText('Help me organise this week.', { exact: true }).count() === 1);
    check(`${look}/${width} readable real conversation`, await page.locator('.ds-quiet-thread').count() === 1);
    await page.screenshot({ path: resolve(evidence, `talk-${look}-${width}.png`) });
    await page.keyboard.press('Control+k');
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await menu.getByRole('button', { name: 'Home', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    check(`${look}/${width} menu focus returns`, await page.getByRole('button', { name: 'Open menu' }).evaluate(el => el === document.activeElement));
    // App's existing in-memory workspace navigation does not push browser-history
    // entries. Do not pretend that a styling change adds cross-screen Back support.
    await page.getByRole('group', { name: 'Quick navigation' }).getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByRole('region', { name: 'Recent notes' }).waitFor();
    check(`${look}/${width} return navigation preserves draft`, await input.inputValue() === 'Keep this unsent draft');
    check(`${look}/${width} no writes`, writes.length === 0);
    check(`${look}/${width} no errors: ${errors.join(';')}`, errors.length === 0);
    await context.close();
  }
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ checks: results.length, results }, null, 2));
  console.log(JSON.stringify({ checks: results.length, evidence }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
