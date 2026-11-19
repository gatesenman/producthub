import { test, expect, APIRequestContext } from '@playwright/test';
/** v1.4 找产品：首页一句话搜索、解释与高亮、快捷条件、联网搜索与入库、对比与导出、官网信息补齐（联网部分使用 --web-fixtures 本地样本） */
const mk = async (r: APIRequestContext, prefix: string, items: [string, string][]) => { const id = prefix + Date.now().toString(36); const out: string[] = [];
  for (const [n, t] of items) out.push((await (await r.post('/api/products', { data: { name: `${id} ${n}`, url: `https://${id}-${n.toLowerCase()}.dev`, tagline: t } })).json()).guid); return { id, guids: out }; };

test('首页一句话找产品：解析意图、相关度排序、为什么匹配、命中高亮', async ({ page }) => {
  await page.goto('/?noonboard'); await page.getByTestId('home-search').fill('帮我找一个记笔记的AI工具');
  await page.getByTestId('home-search-go').click();
  await expect(page.getByTestId('intent-bar')).toBeVisible(); await expect(page.getByTestId('search')).toHaveValue('帮我找一个记笔记的AI工具');
  await expect(page.getByTestId('intent-concept').first()).toContainText('笔记');
  const first = page.getByTestId('product-row').first(); await expect(first).toContainText('NoteNest');
  await expect(first.getByTestId('match-reasons')).toContainText('为什么匹配'); await expect(first.getByTestId('hl').first()).toBeVisible();
  await expect(page.getByTestId('q-sort')).toContainText('相关度');
});

test('拼写容错 + 快捷条件（开源）+ 清空搜索恢复默认排序', async ({ page }) => {
  await page.goto('/?view=products&noonboard'); await page.getByTestId('search').fill('writbot');
  await expect(page.getByTestId('product-row').first()).toContainText('WriteBot'); await expect(page.getByTestId('product-row').first().getByTestId('match-reasons')).toContainText('拼写纠正');
  await page.getByTestId('search').fill('code'); await expect(page.getByTestId('product-row').first()).toContainText('CodeShip');
  await page.getByTestId('chip-opensource').click(); await expect(page.getByTestId('chip-opensource')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('product-row')).toHaveCount(1); await expect(page.getByTestId('product-row')).toContainText('CodeShip');
  await page.getByTestId('chip-opensource').click(); await page.getByTestId('search-clear').click();
  await expect(page.getByTestId('intent-bar')).toBeHidden(); await expect(page.getByTestId('q-sort')).toContainText('最近更新');
});

test('本地无结果 → 自动联网搜索：来源状态、失败来源提示、一键入库并去重', async ({ page }) => {
  await page.goto('/?view=products&noonboard'); await page.getByTestId('search').fill('会议纪要');
  const web = page.getByTestId('web-results'); await expect(web).toBeVisible(); await expect(web).toContainText('本地没有找到匹配的产品');
  await expect(page.getByTestId('web-item').first()).toBeVisible();
  await expect(page.getByTestId('provider-bing')).toHaveAttribute('data-ok', 'false'); await expect(page.getByTestId('provider-ddg')).toHaveAttribute('data-ok', 'true');
  await expect(web).not.toContainText('wikipedia');
  const otter = page.getByTestId('web-item').filter({ hasText: 'otter.ai' }); await otter.getByTestId('web-ingest').click();
  await expect(page.getByTestId('toast').filter({ hasText: '已入库' })).toBeVisible();
  await expect(page.getByTestId('product-row').filter({ hasText: 'Otter' })).toBeVisible();
  await expect(page.getByTestId('web-item').filter({ hasText: 'otter.ai' }).getByTestId('web-in-lib')).toBeVisible();
});

test('勾选 3 个产品 → 对比：差异高亮、只看差异、移除一列、导出 Markdown', async ({ page, request }) => {
  const { id } = await mk(request, 'cmp', [['Alpha', 'Screen recorder for Mac'], ['Beta', 'Screen recorder for teams'], ['Gamma', 'Screen recorder, open-source']]);
  await page.goto('/?view=products&noonboard'); await page.getByTestId('search').fill(id); const rows = page.getByTestId('product-row'); await expect(rows).toHaveCount(3);
  await rows.nth(0).getByTestId('row-check').click(); await expect(page.getByTestId('batch-compare')).toBeDisabled();
  await rows.nth(1).getByTestId('row-check').click(); await rows.nth(2).getByTestId('row-check').click(); await page.getByTestId('batch-compare').click();
  await expect(page.getByTestId('compare-col')).toHaveCount(3); const all = await page.getByTestId('compare-row').count();
  await expect(page.locator('[data-testid=compare-row][data-differs]').first()).toBeVisible();
  await page.getByTestId('diff-only').click(); await expect.poll(() => page.getByTestId('compare-row').count()).toBeLessThan(all);
  const dl = page.waitForEvent('download'); await page.getByTestId('compare-md').click(); const f = await (await dl).path();
  const md = require('node:fs').readFileSync(f!, 'utf8'); expect(md).toContain(`${id} Alpha`); expect(md).toContain('| 属性 |');
  await page.getByTestId('compare-remove').first().click(); await expect(page.getByTestId('compare-col')).toHaveCount(2);
});

test('官网信息补齐：详情页单个补齐（新鲜度）+ 批量补齐进度', async ({ page, request }) => {
  const { id } = await mk(request, 'enr', [['One', 'AI notes'], ['Two', 'AI notes'], ['Three', 'AI notes']]);
  await page.goto('/?view=products&noonboard'); await page.getByTestId('search').fill(id); const rows = page.getByTestId('product-row'); await expect(rows).toHaveCount(3);
  await rows.first().click(); const sec = page.getByTestId('enrich-section'); await expect(sec).toContainText('尚未补齐');
  await sec.getByTestId('enrich').click(); await expect(page.getByTestId('enrich-pricing')).toContainText('Pro'); await expect(page.getByTestId('enrich-fresh')).toHaveText('今天更新');
  await expect(sec).toContainText('Acme Labs Inc.'); await expect(page.getByTestId('toast').filter({ hasText: '官网信息已更新' })).toBeVisible();
  await rows.nth(1).getByTestId('row-check').click(); await rows.nth(2).getByTestId('row-check').click(); await page.getByTestId('batch-enrich').click();
  await expect(page.getByTestId('toast').filter({ hasText: '已加入补齐队列 2' })).toBeVisible();
  await expect.poll(async () => (await (await request.post('/api/products/query', { data: { q: id, chips: ['free'] } })).json()).total, { timeout: 15000 }).toBe(3);
});

test('只读预览：可以搜索、联网查看与对比，但不能入库或补齐', async ({ page }) => {
  await page.goto('http://127.0.0.1:18791/?view=products&noonboard'); await page.getByTestId('search').fill('会议纪要');
  await expect(page.getByTestId('web-item').first()).toBeVisible(); await expect(page.getByTestId('web-ingest')).toHaveCount(0); await expect(page.getByTestId('web-ingest-all')).toHaveCount(0);
});
