import { chromium } from '@playwright/test';
import fs from 'fs';
const OUT = '/workspace/product-hub/screenshots/e2e-v18';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const base = 'http://127.0.0.1:8787';
async function shot(name, url, ready) {
  await page.goto(url.startsWith('http') ? url : base + url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (ready) await ready(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log('shot', name);
}
try {
await shot('01-home', '/?noonboard', async p => { await p.getByTestId('home').waitFor({ timeout: 15000 }); });
await shot('02-products-search', '/?view=products&noonboard', async p => {
  await p.getByTestId('search').waitFor();
  await p.getByTestId('search').fill('AI');
  await p.waitForTimeout(800);
});
await shot('03-detail', '/?view=products&noonboard', async p => {
  await p.getByTestId('product-row').first().waitFor({ timeout: 15000 });
  await p.getByTestId('product-row').first().click();
  await p.getByTestId('product-detail').waitFor({ timeout: 10000 });
});
await shot('05-sources', '/?view=sources&noonboard', async p => { await p.getByTestId('source-table').waitFor({ timeout: 15000 }); });
await shot('06-rules', '/?view=sources&noonboard', async p => {
  await p.getByTestId('tab-rules').click();
  await p.getByTestId('rule-json').waitFor();
});
await shot('07-analytics', '/?view=analytics&noonboard', async p => { await p.getByTestId('analytics').waitFor({ timeout: 15000 }); });
await shot('08-data', '/?view=data&noonboard', async p => { await p.waitForTimeout(600); });
await shot('09-settings', '/?view=settings&noonboard', async p => { await p.waitForTimeout(600); });
await shot('10-design', '/?view=design&dev=1&noonboard', async p => { await p.getByTestId('design-gallery').waitFor({ timeout: 10000 }).catch(()=>{}); });
await shot('11-palette', '/?view=products&noonboard', async p => {
  await p.getByTestId('product-row').first().waitFor({ timeout: 10000 });
  await p.keyboard.press('Control+k');
  await p.getByTestId('palette-input').waitFor();
  await p.getByTestId('palette-input').fill('AI');
  await p.waitForTimeout(400);
});
await shot('12-ai-panel', '/?view=products&noonboard', async p => {
  await p.getByTestId('product-row').first().click();
  await p.keyboard.press('Control+j');
  await p.getByTestId('ai-panel').waitFor({ timeout: 8000 });
  await p.waitForTimeout(400);
});
await shot('13-readonly', 'http://127.0.0.1:8788/?view=products&noonboard', async p => {
  await p.getByText('只读').first().waitFor({ timeout: 10000 }).catch(()=>{});
  await p.waitForTimeout(400);
});
await page.goto(base + '/?view=products&noonboard', { waitUntil: 'domcontentloaded' });
await page.getByTestId('product-row').first().waitFor({ timeout: 10000 }).catch(()=>{});
for (let i=0;i<3;i++) { await page.keyboard.press('Control+Shift+L'); await page.waitForTimeout(200); }
await page.screenshot({ path: `${OUT}/14-theme.png` });
console.log('shot 14-theme');
} catch (e) { console.error('SHOT_ERR', e); }
await browser.close();
console.log('done');
