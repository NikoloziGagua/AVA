// Built production App; disposable browser-only API fixtures. Never contacts AVA's runtime.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'data/builds/atelier-m1-web');
const evidence = resolve(process.argv[3] ?? 'data/builds/atelier-presence-browser');
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
const frameEvidence = [];
const soakSeconds = Math.max(0, Math.min(300, Number(process.argv[4]) || 0));
const check = (test, condition) => { assert.ok(condition, test); results.push(test); };
try {
  for (const look of ['ink', 'paper']) for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    // Fixture routing must not be intercepted by a real service worker. PWA
    // precache integrity is verified separately, not claimed by this UI smoke.
    await context.route('**/registerSW.js', route => route.fulfill({ contentType: 'text/javascript', body: '/* UI fixture: service-worker registration disabled */' }));
    const errors = [], writes = [], sessionReads = [];
    page.on('pageerror', e => errors.push(e.stack || e.message));
    page.on('console', m => {
      if (m.type() === 'error' || /Too many active WebGL contexts/i.test(m.text())) errors.push(m.text());
    });
    const now = Date.now();
    const session = { id: 'atelier-fixture-chat', title: 'A local design check', origin: 'human', created_at: now, updated_at: now, last_human_activity_at: now, status: 'idle', pinned: 0 };
    const note = { id: 'atelier-fixture-note', title: 'A thought worth keeping', content: 'Disposable local browser fixture.', kind: 'documentation', status: 'ideas', pinned: true, updatedAt: now, createdAt: now, tags: [], links: [], changeLog: [], collection: null, projectId: null, section: 'capture', source: 'manual', sourceSessionId: null, promotion: null, version: 1 };
    await context.addInitScript(({ look }) => {
      // Seed once per disposable context; reload must use what App retained,
      // rather than silently repairing the selection/preferences in the test.
      if (!sessionStorage.getItem('atelier-fixture-seeded')) {
        localStorage.setItem('ava.token', 'browser-fixture-not-a-credential');
        localStorage.setItem('ava.ui.look', look);
        localStorage.setItem('ava-motion', 'full');
        localStorage.setItem('ava:last-chat-session', 'atelier-fixture-chat');
        sessionStorage.setItem('ava:splash-seen', '1');
        sessionStorage.setItem('atelier-fixture-seeded', '1');
      }
      // No physical microphone, audio, provider or socket: render the real failure state.
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true,
        value: async () => { throw new DOMException('Fixture microphone disabled', 'NotAllowedError'); } });
      const getContext = HTMLCanvasElement.prototype.getContext;
      const tracked = new WeakSet(), records = [];
      // Count live renderer resources, even on detached canvases. Keeping a native
      // context for StrictMode is intentional; browser GC/GPU memory is not measured.
      window.__atelierGl = () => records.map(record => ({ attached: record.canvas.deref()?.isConnected ?? false,
        buffers: record.Buffer.size, programs: record.Program.size }));
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        const context = getContext.call(this, type, ...args);
        if (context && /webgl/.test(type)) {
          this.dataset.qaContext = type;
          if (!tracked.has(context)) {
            tracked.add(context);
            // A strong canvas reference here would itself prevent native context
            // collection and manufacture a context-limit warning during the soak.
            const record = { canvas: new WeakRef(this), Buffer: new Set(), Program: new Set() };
            records.push(record);
            for (const kind of ['Buffer', 'Program']) {
              const create = context[`create${kind}`].bind(context), remove = context[`delete${kind}`].bind(context);
              context[`create${kind}`] = (...args) => { const value = create(...args); if (value) record[kind].add(value); return value; };
              context[`delete${kind}`] = value => { const result = remove(value); record[kind].delete(value); return result; };
            }
          }
        }
        return context;
      };
    }, { look });
    const graphics = async (destination, count) => {
      await page.waitForFunction(expected => {
        const rows = window.__atelierGl();
        return rows.filter(row => row.buffers || row.programs).length === expected
          && rows.every(row => row.attached || (!row.buffers && !row.programs));
      }, count);
      check(`${look}/${width} ${destination} renderer resources released or singly owned`, true);
      check(`${look}/${width} ${destination} attached WebGL count`, await page.locator('[data-qa-context]').count() === count);
    };
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (request.method() !== 'GET') writes.push(`${request.method()} ${path}`);
      if (/^\/api\/sessions\//.test(path)) sessionReads.push(path);
      let body = {};
      if (path === '/api/sessions') body = { sessions: [session], nextCursor: null };
      else if (path === '/api/sessions/atelier-fixture-chat') body = { session, messages: [
        { id: 1, role: 'user', content: 'Help me organise this week.', created_at: now },
        { id: 2, role: 'assistant', content: 'Start with one clear priority.\n\n- Read the lecture notes.\n- Leave some breathing room.', created_at: now },
      ] };
      else if (path === '/api/calendar/events') body = { fetchedAt: now, events: [], occurrences: [], complete: true };
      else if (path === '/api/notes/tree') body = {
        folders: [{ id: 'notes_general', parentId: null, name: 'General', description: '', position: 0, builtIn: true, version: 1,
          documentCount: 1, breadcrumb: [{ id: 'notes_general', name: 'General' }], path: 'General', createdAt: now, updatedAt: now }],
        snapshot: { fetchedAt: now, version: 'fixture', complete: true, totalDocuments: 1 },
        migration: { legacyProjectCount: 0, legacyRootFolderIds: [] },
      };
      else if (path === '/api/notes') body = { notes: [note], projects: [] };
      else if (path === '/api/watches') body = { watches: [] };
      else if (path === '/api/chat/atelier-fixture-chat/stream') {
        // A labelled fixture response-in-progress exposes the real "voice while
        // busy" control without sending a turn. A reconnect never repeats it.
        const event = url.searchParams.get('lastEventId') === '0'
          ? 'id: 1\nevent: delta\ndata: {"text":"Disposable browser fixture response in progress."}\n\n'
          : ': local read-only fixture\n\n';
        await route.fulfill({ contentType: 'text/event-stream', body: event }); return;
      }
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
    const form = page.locator('form.ds-composer-grow');
    check(`${look}/${width} bar rests narrow`, (await form.boundingBox()).width <= 480);
    check(`${look}/${width} closed menu leaves no wide backing`, await page.locator('.ds-menu').evaluate(el => getComputedStyle(el).opacity === '0' && el.inert));
    const stars = page.locator('[data-metal-stars]');
    await stars.waitFor();
    const beforeStars = await stars.evaluate(el => el.toDataURL());
    await page.waitForTimeout(250);
    check(`${look}/${width} stars advance`, await stars.evaluate(el => el.toDataURL()) !== beforeStars);
    check(`${look}/${width} bounded stars`, await stars.getAttribute('data-star-count') === (width < 600 ? '500' : '900'));
    check(`${look}/${width} one WebGL face`, await page.locator('[data-qa-context]').count() === 1);
    await graphics('Home', 1);
    if (width === 390) {
      const timing = await page.evaluate(() => new Promise(resolve => {
        const frames = []; let last = performance.now();
        const start = last;
        function tick(now) { frames.push(now-last); last=now; if(now-start < 1500) requestAnimationFrame(tick);
          else { frames.sort((a,b)=>a-b); resolve({ samples: frames.length, median: frames[Math.floor(frames.length*.5)], p95: frames[Math.floor(frames.length*.95)] }); } }
        requestAnimationFrame(tick);
      }));
      frameEvidence.push({ look, width, timing, note: 'Desktop Edge phone viewport, not physical phone performance' });
      if (look === 'ink' && soakSeconds > 0) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('HeapProfiler.collectGarbage');
        const before = await cdp.send('Runtime.getHeapUsage');
        for (let waited = 0; waited < soakSeconds; waited += 30) {
          await page.waitForTimeout(Math.min(30, soakSeconds - waited) * 1000);
          console.log(`Home motion soak: ${Math.min(waited + 30, soakSeconds)}/${soakSeconds}s`);
        }
        await cdp.send('HeapProfiler.collectGarbage');
        const after = await cdp.send('Runtime.getHeapUsage');
        const growth = after.usedSize - before.usedSize;
        check('Home soak heap growth under 30MB', growth < 30_000_000);
        check('Home soak retains one WebGL face', await page.locator('[data-qa-context]').count() === 1);
        frameEvidence.push({ soakSeconds, before: before.usedSize, after: after.usedSize, growth,
          note: 'Garbage-collected JavaScript heap on desktop Edge, not total GPU/process memory' });
        await cdp.detach();
      }
    }
    const atmosphere = page.locator('.ds-atmosphere canvas');
    const first = await atmosphere.evaluate(el => el.toDataURL());
    await page.waitForTimeout(250);
    check(`${look}/${width} Nocturne ground stays still behind moving stars`, await atmosphere.evaluate(el => el.toDataURL()) === first);
    await page.evaluate(() => { localStorage.setItem('ava-motion', 'reduced'); window.dispatchEvent(new Event('ava-motion-change')); });
    await page.locator('.ds-atmosphere canvas[data-motion="static"]').waitFor();
    const still = await atmosphere.evaluate(el => el.toDataURL());
    await page.waitForTimeout(150);
    check(`${look}/${width} reduced frame stable`, await atmosphere.evaluate(el => el.toDataURL()) === still);
    const starStill = await stars.evaluate(el => el.toDataURL());
    await page.waitForTimeout(120);
    check(`${look}/${width} reduced stars stable`, await stars.evaluate(el => el.toDataURL()) === starStill);
    await page.screenshot({ path: resolve(evidence, `home-${look}-${width}.png`) });
    const input = page.getByRole('textbox', { name: 'Message AVA' });
    const sameInput = await input.elementHandle();
    await input.fill('Keep this unsent draft');
    check(`${look}/${width} composer focus belongs to the pill`, await input.evaluate(el => {
      const pill = el.closest('.ds-bar'); return getComputedStyle(el).outlineStyle === 'none' && getComputedStyle(pill).outlineStyle !== 'none';
    }));
    check(`${look}/${width} navigation labels have an opaque ground`, await page.locator('.ds-light-trace').evaluate(el => !getComputedStyle(el).backgroundColor.startsWith('rgba')));
    await page.waitForTimeout(300);
    check(`${look}/${width} bar expands with draft`, await form.getAttribute('data-expanded') === 'true');
    await page.getByRole('group', { name: 'Quick navigation' }).getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByRole('region', { name: 'Recent notes' }).waitFor();
    check(`${look}/${width} Today has only the persistent composer`, await page.locator('textarea').count() === 1);
    check(`${look}/${width} draft survives`, await input.inputValue() === 'Keep this unsent draft');
    check(`${look}/${width} Silk destination`, await page.locator('[data-atmosphere="silk"]').count() === 1);
    check(`${look}/${width} no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await graphics('Today', 0);
    await page.screenshot({ path: resolve(evidence, `today-${look}-${width}.png`) });
    await page.getByRole('group', { name: 'Quick navigation' }).getByRole('button', { name: 'Talk', exact: true }).click();
    await page.locator('.ds-quiet-conversation').waitFor();
    await page.getByText('Help me organise this week.', { exact: true }).waitFor();
    check(`${look}/${width} remembered exact chat`, await page.getByText('Help me organise this week.', { exact: true }).count() === 1);
    check(`${look}/${width} readable real conversation`, await page.locator('.ds-quiet-thread').count() === 1);
    await graphics('Talk', 0);
    await page.screenshot({ path: resolve(evidence, `talk-${look}-${width}.png`) });
    const navigate = async name => {
      await page.getByRole('group', { name: 'Quick navigation' }).getByRole('button', { name, exact: true }).click();
    };
    const retainedDraft = async destination => {
      check(`${look}/${width} ${destination} keeps unsent words`, await input.inputValue() === 'Keep this unsent draft');
      check(`${look}/${width} ${destination} keeps the same composer`, await sameInput.evaluate(el => el.isConnected && el === document.querySelector('textarea[aria-label="Message AVA"]')));
      check(`${look}/${width} ${destination} has no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await graphics(destination, 0);
    };
    await navigate('Notes');
    await page.locator('.ds-notes-folders').waitFor();
    await retainedDraft('Notes');
    await page.screenshot({ path: resolve(evidence, `journey-notes-${look}-${width}.png`) });
    await navigate('Calendar');
    await page.getByRole('region', { name: 'Calendar', exact: true }).waitFor();
    await page.getByRole('button', { name: 'New event', exact: true }).waitFor();
    await retainedDraft('Calendar');
    await page.getByRole('button', { name: 'Reminders', exact: true }).click();
    await page.getByRole('region', { name: 'Reminders', exact: true }).waitFor();
    await retainedDraft('Reminders');
    await page.getByRole('button', { name: 'Back to Calendar', exact: true }).click();
    await page.getByRole('region', { name: 'Calendar', exact: true }).waitFor();
    await retainedDraft('Back to Calendar');
    await navigate('Ideas');
    await page.getByRole('heading', { name: 'Keep the spark.', exact: true }).waitFor();
    await retainedDraft('Ideas');
    await navigate('Home');
    await page.getByRole('heading', { name: /Good .*Niko/ }).waitFor();
    check(`${look}/${width} return Home keeps draft`, await input.inputValue() === 'Keep this unsent draft');
    await page.locator('.ds-home-face [data-face="live"]').waitFor();
    await graphics('Return Home', 1);
    check(`${look}/${width} return Home has no overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (look === 'ink' && width === 390) {
      const resources = () => page.evaluate(() => window.__atelierGl().reduce((total, row) => ({
        buffers: total.buffers + row.buffers, programs: total.programs + row.programs,
      }), { buffers: 0, programs: 0 }));
      const baseline = await resources();
      for (let trip = 1; trip <= 20; trip++) {
        await navigate('Notes');
        await page.locator('.ds-notes-folders').waitFor();
        await graphics(`Round trip ${trip} Notes`, 0);
        await navigate('Home');
        await page.locator('.ds-home-face [data-face="live"]').waitFor();
        await graphics(`Round trip ${trip} Home`, 1);
        check(`Round trip ${trip} restores resource baseline`, JSON.stringify(await resources()) === JSON.stringify(baseline));
      }
      check('Twenty round trips preserve draft', await input.inputValue() === 'Keep this unsent draft');
      check('Twenty round trips have no WebGL context-limit warning', !errors.some(error => /Too many active WebGL contexts/i.test(error)));
      await page.screenshot({ path: resolve(evidence, 'home-after-twenty-round-trips.png') });
    }
    await navigate('Talk');
    await page.getByText('Help me organise this week.', { exact: true }).waitFor();
    await retainedDraft('Return Talk');
    await page.keyboard.press('Control+k');
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await menu.getByRole('button', { name: 'Home', exact: true }).waitFor();
    check(`${look}/${width} menu receives keyboard focus`, await menu.evaluate(el => el.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    check(`${look}/${width} menu focus returns`, await page.getByRole('button', { name: 'Open menu' }).evaluate(el => el === document.activeElement));
    // App's existing in-memory workspace navigation does not push browser-history
    // entries. Do not pretend that a styling change adds cross-screen Back support.
    check(`${look}/${width} return navigation preserves draft`, await input.inputValue() === 'Keep this unsent draft');
    // Voice uses the real engine wrapper, but microphone rejection is fixture-owned.
    // Keep the draft: the fixture stream lets the existing busy-Talk voice button
    // enter Voice without clearing words or invoking Stop/send on a real task.
    await page.getByRole('navigation', { name: 'AVA', exact: true }).getByRole('button', { name: 'Talk to AVA', exact: true }).click();
    await page.locator('.ds-atelier-voice').waitFor();
    check(`${look}/${width} Voice discloses kept draft`, await page.getByText('Draft kept', { exact: true }).count() === 1);
    check(`${look}/${width} Voice keeps hidden draft`, await sameInput.evaluate(el => el.isConnected && el.value === 'Keep this unsent draft'));
    await page.locator('.ds-voice-face [data-face="live"]').waitFor();
    await page.locator('.ds-atelier-voice [data-metal-stars]').waitFor();
    check(`${look}/${width} voice has one WebGL face`, await page.locator('[data-qa-context]').count() === 1);
    await graphics('Voice', 1);
    check(`${look}/${width} Voice has no overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const voiceHeight = (await page.locator('.ds-voice-face').boundingBox()).height;
    check(`${look}/${width} voice face has room`, voiceHeight >= 200);
    check(`${look}/${width} voice controls fit`, await page.getByRole('button', { name: 'keyboard', exact: true }).evaluate(el => {
      const r=el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    }));
    await page.screenshot({ path: resolve(evidence, `voice-${look}-${width}.png`) });
    await page.emulateMedia({ forcedColors: 'active' });
    await page.waitForTimeout(80);
    check(`${look}/${width} forced colours omit decorative stars`, await page.locator('[data-metal-stars]').evaluate(el => {
      const data = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
      for (let i=3; i<data.length; i+=4) if (data[i] !== 0) return false;
      return true;
    }));
    check(`${look}/${width} forced colours retain keyboard control`, await page.getByRole('button', { name: 'keyboard', exact: true }).isVisible());
    await page.emulateMedia({ forcedColors: 'none' });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.getByRole('button', { name: 'keyboard', exact: true }).scrollIntoViewIfNeeded();
    check(`${look}/${width} short voice controls reachable`, await page.getByRole('button', { name: 'keyboard', exact: true }).isVisible());
    await page.getByRole('button', { name: 'keyboard', exact: true }).click();
    await page.locator('.ds-quiet-conversation').waitFor();
    check(`${look}/${width} same mounted composer after Voice`, await sameInput.evaluate(el => el.isConnected && el === document.querySelector('textarea[aria-label="Message AVA"]')));
    check(`${look}/${width} Voice return keeps unsent words`, await input.inputValue() === 'Keep this unsent draft');
    await graphics('Voice return', 0);
    await page.getByText('Help me organise this week.', { exact: true }).waitFor();
    check(`${look}/${width} no stars outside Home/Voice`, await page.locator('[data-metal-stars]').count() === 0);
    await page.reload();
    await page.getByRole('heading', { name: /Good .*Niko/ }).waitFor();
    check(`${look}/${width} reload does not pretend draft persistence`, await input.inputValue() === '');
    await navigate('Talk');
    await page.getByText('Help me organise this week.', { exact: true }).waitFor();
    check(`${look}/${width} only exact human session read`, sessionReads.length >= 3 && sessionReads.every(path => path === '/api/sessions/atelier-fixture-chat'));
    check(`${look}/${width} no writes`, writes.length === 0);
    check(`${look}/${width} no errors: ${errors.join(';')}`, errors.length === 0);
    await context.close();
  }
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ checks: results.length, results, frameEvidence }, null, 2));
  console.log(JSON.stringify({ checks: results.length, evidence, frameEvidence }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
