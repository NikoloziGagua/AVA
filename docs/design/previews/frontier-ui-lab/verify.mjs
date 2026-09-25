import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(fileURLToPath(import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'ava-motion-lab-'));
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
} catch {
  browser = await chromium.launch({ headless: true });
}

const results = [];
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport, reducedMotion: 'no-preference' });
  const errors = [];
  const external = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => { if (/^https?:/i.test(request.url())) external.push(request.url()); });
  await page.goto(pathToFileURL(join(root, 'index.html')).href, { waitUntil: 'load' });

  assert.equal(await page.locator('[data-target]').count(), 5, 'five motion experiments are exposed');
  const semantics = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    const unnamedButtons = [...document.querySelectorAll('button')]
      .filter((button) => !(button.getAttribute('aria-label') || button.textContent.trim()))
      .length;
    return { duplicateIds, unnamedButtons };
  });
  assert.deepEqual(semantics.duplicateIds, [], 'IDs are unique');
  assert.equal(semantics.unnamedButtons, 0, 'every button has an accessible name');
  for (const name of ['signal', 'choreography', 'atlas', 'time', 'material']) {
    await page.locator(`[data-target="${name}"]`).click();
    await page.waitForTimeout(90);
    assert.equal(await page.locator(`[data-scene="${name}"]`).isVisible(), true, `${name} is visible`);
    const overflow = await page.evaluate(() => {
      const amount = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const offenders = [...document.querySelectorAll('body *')]
        .map((node) => ({ node: node.tagName.toLowerCase(), className: String(node.className || ''), rect: node.getBoundingClientRect() }))
        .filter(({ rect }) => rect.right > innerWidth + 1 || rect.left < -1)
        .slice(0, 8)
        .map(({ node, className, rect }) => `${node}.${className}: ${rect.left.toFixed(1)}..${rect.right.toFixed(1)}`);
      return { amount, offenders };
    });
    assert.ok(overflow.amount <= 1, `${name} has no horizontal overflow (${overflow.amount}px; ${overflow.offenders.join(', ')})`);
    if (viewport.width === 1440) {
      await page.waitForTimeout(650);
      await page.screenshot({ path: join(output, `motion-lab-${name}.png`) });
    }
  }

  await page.locator('[data-target="signal"]').click();
  await page.locator('#signal-voice').click();
  assert.equal(await page.locator('#signal-voice').getAttribute('aria-pressed'), 'true', 'signal motion follows explicit listening state');

  await page.locator('[data-target="choreography"]').click();
  await page.locator('#tempo-toggle').click();
  await page.locator('[data-replay="choreography"]').click();
  await page.waitForTimeout(2800);
  assert.equal(await page.locator('#flow-stage').getAttribute('data-flow-step'), '4', 'choreography reaches verified result');

  await page.locator('[data-target="atlas"]').click();
  await page.locator('[data-atlas="ideas"]').click();
  assert.equal(await page.locator('#atlas-detail h2').textContent(), 'Ideas', 'atlas selection updates detail');

  await page.locator('[data-target="time"]').click();
  const reviewBefore = await page.locator('.time-block.review').boundingBox();
  await page.locator('#resolve-day').click();
  await page.waitForTimeout(900);
  const reviewAfter = await page.locator('.time-block.review').boundingBox();
  assert.equal(await page.locator('#day-ribbon').getAttribute('class').then((value) => value.includes('is-resolved')), true, 'time preview animates to proposal');
  assert.match(await page.locator('#time-status').textContent(), /Preview only/, 'time preview stays truthful');
  assert.ok(Math.hypot(reviewAfter.x - reviewBefore.x, reviewAfter.y - reviewBefore.y) > 20, 'schedule block visibly moves to its proposed time');

  await page.locator('[data-target="material"]').click();
  const prismBox = await page.locator('[data-tilt]').boundingBox();
  await page.mouse.move(prismBox.x + prismBox.width * .8, prismBox.y + prismBox.height * .2);
  assert.notEqual(await page.locator('[data-tilt]').evaluate((node) => node.style.transform), '', 'optical material responds to pointer position');
  await page.locator('#kinetic-button').click();
  assert.equal(await page.locator('.kinetic-card h2').getAttribute('aria-label'), 'AVA is ready', 'material state remains accessible');

  await page.locator('#motion-toggle').click();
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'reduced', 'manual reduced motion is available');
  await page.keyboard.press('2');
  await page.waitForTimeout(80);
  assert.equal(await page.locator('#flow-stage').getAttribute('data-flow-step'), '4', 'reduced motion exposes complete static outcome');

  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: join(output, `motion-lab-${viewport.width}.png`) });
  assert.deepEqual(external, [], 'preview makes no network requests');
  assert.deepEqual(errors, [], `no browser errors at ${viewport.width}px`);
  results.push(`${viewport.width}x${viewport.height}: 5 scenes, interactions, reduced motion, no overflow/errors/network`);
  await page.close();
}

await browser.close();
console.log(results.join('\n'));
console.log(`screenshots: ${output}`);
