// Read-only reference capture. Not part of the preview runtime.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const out = 'data/builds/atelier-references';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  for (const [name, url] of [
    ['rauno-craft', 'https://rauno.me/craft'],
    ['magic-dock', 'https://magicui.design/docs/components/dock'],
    ['aceternity-expand', 'https://ui.aceternity.com/components/expandable-card'],
    ['assistant-ui', 'https://www.assistant-ui.com/'],
    ['linear', 'https://linear.app/now/behind-the-latest-design-refresh'],
    ['calendar', 'https://www.notion.com/product/calendar'],
    ['craft', 'https://www.craft.do/'],
    ['paper', 'https://shaders.paper.design/'],
    ['reflect', 'https://reflect.app/'],
  ]) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(2400);
      await page.screenshot({ path: `${out}/${name}.png` });
      console.log(name, page.url(), await page.title());
    } catch (error) { console.log(name, String(error).slice(0, 180)); }
  }
} finally { await browser.close(); }
