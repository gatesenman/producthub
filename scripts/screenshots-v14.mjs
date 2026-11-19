// v1.4 找产品截图（39+）：node scripts/screenshots-v14.mjs <rwUrl>（真实网络：联网搜索结果随时间变化）
import { chromium } from '@playwright/test';
const [rw = 'http://127.0.0.1:18800'] = process.argv.slice(2);
const out = 'screenshots/'; const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', colorScheme: 'light' });
const page = await ctx.newPage(); page.on('pageerror', e => console.log('PAGEERR', e.message));
const shot = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: out + n + '.png' }); console.log(n); };
await page.goto(rw + '/?noonboard'); await page.getByTestId('home-hero').waitFor(); await page.getByTestId('home-search').fill('帮团队做会议纪要的AI工具，支持中文'); await shot('39-首页-一句话找产品');
await page.getByTestId('home-search-go').click(); await page.getByTestId('intent-bar').waitFor(); await shot('40-自然语言搜索-理解为与为什么匹配');
await page.getByTestId('search').fill('免费的AI绘画'); await page.waitForTimeout(600); await page.getByTestId('chip-free').click(); await page.getByTestId('intent-bar').waitFor(); await shot('41-快捷条件-有免费版');
await page.getByTestId('chip-free').click(); await page.getByTestId('search').fill('notoin'); await page.getByTestId('intent-bar').waitFor(); await shot('42-拼写容错-notoin');
await page.getByTestId('search').fill('doubao'); await page.getByTestId('intent-bar').waitFor(); await shot('43-拼音搜索-doubao');
await page.getByTestId('search').fill('开源的会议纪要转写工具 本地运行'); await page.getByTestId('web-results').waitFor({ timeout: 20000 }); await page.getByTestId('web-list').waitFor({ timeout: 40000 }).catch(() => {}); await shot('44-联网搜索-本地结果少时自动补充');
await page.getByTestId('search').fill('录屏'); await page.getByTestId('intent-bar').waitFor(); await page.waitForTimeout(500);
const rows = page.getByTestId('row-check'); for (const i of [0, 3, 4]) await rows.nth(i).click(); await shot('45-批量操作-对比与补齐信息');
await page.getByTestId('batch-compare').click(); await page.getByTestId('compare-table').waitFor(); await shot('46-产品对比-差异高亮');
await page.getByTestId('diff-only').click(); await page.getByTestId('compare-table').evaluate(e => e.parentElement.scrollTo(0, 420)); await shot('47-产品对比-只看差异-AI评分');
await page.goto(rw + '/?view=products&noonboard'); await page.getByTestId('search').fill('HubSpot CRM'); await page.getByTestId('product-row').first().filter({ hasText: 'HubSpot CRM' }).waitFor(); await page.getByTestId('product-row').first().click(); await page.getByTestId('enrich-pricing').waitFor(); await page.getByTestId('enrich-section').waitFor(); await shot('48-详情-官网信息与新鲜度');
await b.close();
