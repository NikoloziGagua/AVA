// Candidate-only browser check; AVA Vite must be running. No application routes are changed.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await context.newPage();
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.method() !== 'GET') writes.push(r.url()); });
  await page.goto('http://127.0.0.1:5174/?godui-preview');
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Starfield } = await import('/src/design/metal/Starfield.tsx');
    localStorage.setItem('ava-motion', 'full');
    const host = document.createElement('div');
    host.id = 'candidate-star-test';
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '100', pointerEvents: 'none' });
    document.body.append(host);
    window.candidateRoot = ReactDOM.createRoot(host);
    window.candidateRoot.render(React.createElement(Starfield));
  });
  const canvas = page.locator('#candidate-star-test canvas');
  await canvas.waitFor();
  const pixels = () => canvas.evaluate(c => c.toDataURL());
  const before = await pixels();
  await page.waitForTimeout(300);
  assert.notEqual(await pixels(), before, 'full motion changes actual pixels');
  await page.evaluate(() => { localStorage.setItem('ava-motion', 'reduced'); window.dispatchEvent(new Event('ava-motion-change')); });
  await page.locator('[data-metal-stars="static"]').waitFor();
  const still = await pixels();
  await page.waitForTimeout(300);
  assert.equal(await pixels(), still, 'reduced motion stays static');
  await page.evaluate(() => { window.candidateRoot.unmount(); document.querySelector('#candidate-star-test').remove(); });
  assert.equal(await page.locator('[data-metal-stars]').count(), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log(JSON.stringify({ movingPixels: true, reducedStatic: true, unmount: true, errors, writes }));
} finally { await browser.close(); }
