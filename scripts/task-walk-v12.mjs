// v1.2.0：同样的人物任务在新信息架构下的点击 / 输入 / 快捷键次数
import { chromium } from '@playwright/test';
const base = process.argv[2] || 'http://127.0.0.1:18800';
const b = await chromium.launch({ channel: 'chrome' }); let page;
const out = {}; let n = 0, t = 0, k = 0; const c = async (loc) => { n++; await loc.click(); }; const type = async (loc, s) => { t++; await loc.fill(s); }; const key = async (s) => { k++; await page.keyboard.press(s); };
const task = async (name, fn) => { n = 0; t = 0; k = 0; page = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })).newPage(); page.setDefaultTimeout(8000); await page.goto(base + '/?noonboard'); await page.getByTestId('home').waitFor(); let note = ''; try { note = (await fn()) || ''; } catch (e) { note = '失败: ' + e.message.slice(0, 300); } out[name] = { clicks: n, typing: t, keys: k, note }; await page.context().close(); };
await task('T1 找竞品', async () => { await key('Control+k'); await type(page.getByTestId('palette-input'), 'ChatGPT'); await c(page.getByTestId('palette-similar').first()); await page.getByTestId('similar-list').locator('button').first().waitFor(); return '命令面板直接「找 X 的竞品」，同时打开详情与相似列表'; });
await task('T2 每日看新增', async () => { await page.getByTestId('home-new-count').waitFor(); return '启动即首页：今日新增数、新增列表、关注动态、来源健康一屏可见；0 次点击'; });
await task('T3 维护失败来源', async () => { await c(page.getByTestId('kpi-errors')); await page.getByTestId('source-table').waitFor(); const row = page.locator('[data-testid=source-table] tbody tr').first(); await row.hover(); await c(row.locator('button').nth(2)); await page.getByTestId('rule-generate').waitFor(); n++; /* AI 生成规则 */ n++; /* 测试规则 */ return '首页/状态栏一键定位到已筛选的失败来源，规则在同一工作区 Tab'; });
await task('T4 导出分析报告', async () => { await c(page.getByTestId('nav-analytics')); const [dl] = await Promise.all([page.waitForEvent('download'), c(page.getByTestId('report-html'))]); return '生成可分享的 HTML 报告：' + dl.suggestedFilename(); });
await task('T5 关注产品后续动态', async () => { await c(page.getByTestId('home-new-list').locator('button').first()); await c(page.getByTestId('fav')); await c(page.getByTestId('nav-home')); await page.getByTestId('kpi-fav').waitFor(); return '关注后首页「我的关注 / 新动态」自动跟踪'; });
console.log(JSON.stringify(out, null, 1)); await b.close();
