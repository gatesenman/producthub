// v1.1.0 基线：按人物任务走一遍真实界面并统计点击/输入次数
import { chromium } from '@playwright/test';
const base = process.argv[2] || 'http://127.0.0.1:18800';
const b = await chromium.launch({ channel: 'chrome' }); let page;
const out = {}; let n = 0, t = 0; const c = async (loc) => { n++; await loc.click(); }; const type = async (loc, s) => { t++; await loc.fill(s); };
const task = async (name, fn) => { n = 0; t = 0; page = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })).newPage(); await page.goto(base + '/'); await page.getByTestId('product-row').first().waitFor(); page.setDefaultTimeout(8000); let note = ''; try { note = (await fn()) || ''; } catch (e) { note = '失败: ' + e.message.slice(0,600); } out[name] = { clicks: n, typing: t, note }; };
await task('T1 找竞品', async () => { await c(page.getByTestId('search')); await type(page.getByTestId('search'), 'ChatGPT'); await page.waitForTimeout(500); await c(page.getByTestId('product-row').first()); await c(page.getByTestId('find-similar')); await page.getByTestId('similar-list').locator('button').first().waitFor(); });
await task('T2 每日看新增', async () => { await c(page.locator('button:has-text("最近收录")').first()); await page.waitForTimeout(400); return '只能按收录时间排序，看不到“今天新增多少”，需逐行看日期'; });
await task('T3 维护失败来源', async () => { await c(page.getByTestId('nav-sources')); await page.getByTestId('source-table').waitFor(); await c(page.getByText('全部状态')); await c(page.getByRole('option', { name: '失败' })); await page.waitForTimeout(300); const row = page.locator('[data-testid=source-table] tbody tr').first(); if (!(await row.count())) return '无失败来源（种子数据）'; await row.hover(); await c(row.locator('button').nth(2)); await page.getByTestId('rule-generate').waitFor(); n++; /* AI 生成规则 */ n++; /* 测试规则（需联网，计入点击） */ return '失败来源没有入口提示，需自己进入页面筛选'; });
await task('T4 导出分类报告', async () => { await c(page.getByTestId('q-category')); await c(page.getByRole('option').nth(1)); await c(page.getByTestId('q-submit')); await page.waitForTimeout(400); await c(page.getByRole('button', { name: '导出', exact: true })); await page.getByRole('menuitem').nth(1).waitFor(); n++; await page.keyboard.press('Escape'); await c(page.getByTestId('nav-analytics')); return '导出只有原始表格，看板不能导出报告'; });
await task('T5 关注产品后续动态', async () => 'v1.1 无收藏/关注功能，无法完成');
console.log(JSON.stringify(out, null, 1)); await b.close();
