import { test, expect, APIRequestContext } from '@playwright/test';
/** v1.3 交互：多选/批量、撤销、内联校验、详情上下切换、AI 流式与停止、引导恢复、分隔条键盘 —— 每个用例自建数据，互不依赖 */
const mk = async (r: APIRequestContext, prefix: string, n: number) => { const id = prefix + Date.now().toString(36); const out: string[] = [];
  for (let i = 0; i < n; i++) out.push((await (await r.post('/api/products', { data: { name: `${id} ${i}`, url: `https://${id}-${i}.dev`, tagline: 'v13 e2e' } })).json()).guid); return id; };

test('多选：Shift 连选、Ctrl+A、批量加标签（可撤销）、批量关注、导出选中', async ({ page, request }) => {
  const id = await mk(request, 'bt', 4); await page.goto('/?view=products&noonboard'); await page.getByTestId('search').fill(id);
  const rows = page.getByTestId('product-row'); await expect(rows).toHaveCount(4);
  await rows.nth(0).getByTestId('row-check').click(); await rows.nth(2).getByTestId('row-check').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('batch-count')).toHaveText('已选 3 项');
  await page.getByTestId('product-table').click({ position: { x: 400, y: 4 } }).catch(() => {}); await page.keyboard.press('Escape'); await expect(page.getByTestId('batch-bar')).toBeHidden();
  await rows.nth(0).click(); await page.keyboard.press('Control+a'); await expect(page.getByTestId('batch-count')).toHaveText('已选 4 项');
  await expect(page.getByTestId('check-all')).toHaveAttribute('data-state', 'checked');
  await page.getByTestId('batch-tag').click(); await page.getByTestId('batch-tag-q').fill('开源'); await page.getByTestId('batch-tag-开源').click();
  await expect(page.getByTestId('toast').filter({ hasText: '添加标签「开源」' })).toBeVisible();
  await expect.poll(async () => (await (await request.post('/api/products/query', { data: { q: id, filter: { type: 'cond', field: 'tags', op: 'has_any', value: ['开源'] } } })).json()).total).toBe(4);
  await page.getByTestId('toast').filter({ hasText: '添加标签' }).getByTestId('toast-action').click();
  await expect.poll(async () => (await (await request.post('/api/products/query', { data: { q: id, filter: { type: 'cond', field: 'tags', op: 'has_any', value: ['开源'] } } })).json()).total).toBe(0);
  await page.getByTestId('batch-fav').click(); await expect(rows.first().getByTestId('fav-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await (await request.post('/api/products/query', { data: { q: id, filter: { type: 'cond', field: 'favorite', op: 'is_true' } } })).json()).total).toBe(4);
  const dl = page.waitForEvent('download'); await page.getByTestId('batch-export').click(); await page.getByTestId('batch-export-json').click();
  const f = await (await dl).path(); const j = JSON.parse(require('node:fs').readFileSync(f!, 'utf8')); expect(j.count).toBe(4);
  await page.getByTestId('batch-unfav').click(); await page.getByTestId('batch-clear').click(); await expect(page.getByTestId('batch-bar')).toBeHidden();
});

test('删除可撤销：行内删除 → 撤销恢复；批量删除 → 6 秒后真正删除', async ({ page, request }) => {
  const id = await mk(request, 'del', 3); await page.goto('/?view=products&noonboard'); await page.getByTestId('search').fill(id);
  const rows = page.getByTestId('product-row'); await expect(rows).toHaveCount(3);
  await rows.first().click({ button: 'right' }); await page.getByTestId('row-menu').getByText('删除').click();
  await expect(rows).toHaveCount(2); await expect(page.getByTestId('total')).toContainText('2');
  await page.getByTestId('toast').filter({ hasText: '已删除' }).getByTestId('toast-action').click();
  await expect(rows).toHaveCount(3);
  await page.waitForTimeout(6500); expect((await (await request.post('/api/products/query', { data: { q: id } })).json()).total).toBe(3);
  await rows.first().click(); await page.keyboard.press('Control+a'); await page.getByTestId('batch-delete').click();
  await expect(page.getByTestId('empty')).toBeVisible(); await expect(page.getByTestId('toast').filter({ hasText: '已删除 3 个产品' })).toBeVisible();
  await expect.poll(async () => (await (await request.post('/api/products/query', { data: { q: id } })).json()).total, { timeout: 12000 }).toBe(0);
});

test('乐观关注：我的关注中取消 → 立即移除 → 撤销恢复', async ({ page, request }) => {
  const id = await mk(request, 'fv', 1); const g = (await (await request.post('/api/products/query', { data: { q: id } })).json()).items[0].guid; await request.put('/api/favorites/' + g);
  await page.goto('/?view=products&noonboard'); await page.getByTestId('nav-favorites').click(); await page.getByTestId('search').fill(id);
  await expect(page.getByTestId('product-row')).toHaveCount(1); await page.getByTestId('fav-toggle').click();
  await expect(page.getByTestId('empty-fav')).toBeVisible();
  await page.getByTestId('toast').filter({ hasText: '已取消关注' }).getByTestId('toast-action').click();
  await expect(page.getByTestId('product-row')).toHaveCount(1); await expect.poll(async () => (await (await request.get('/api/products/' + g)).json()).favorite).toBe(true);
  await request.delete('/api/favorites/' + g);
});

test('内联校验：手动添加、规则 JSON、设置', async ({ page }) => {
  await page.goto('/?view=products&noonboard'); await page.getByTestId('add-product').click();
  await page.getByTestId('f-submit').click(); await expect(page.getByTestId('f-name-err')).toHaveText('名称不能为空'); await expect(page.getByTestId('f-name')).toBeFocused();
  await page.getByTestId('f-name').fill('X'); await page.getByTestId('f-url').fill('not a url'); await page.getByTestId('f-url').blur();
  await expect(page.getByTestId('f-url-err')).toContainText('http'); await expect(page.getByTestId('f-url')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('f-url').fill('https://ok.dev'); await expect(page.getByTestId('f-url-err')).toHaveCount(0); await page.keyboard.press('Escape');
  await page.getByTestId('nav-sources').click(); await page.getByTestId('tab-rules').click();
  await expect(page.getByTestId('page-title')).toHaveText('来源与规则'); await expect(page.getByRole('tab', { name: '抓取规则' })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('rule-json').fill('{ "mode": "html", '); await expect(page.getByTestId('rule-json-err')).toContainText('JSON'); await expect(page.getByTestId('rule-test')).toBeDisabled();
  await page.getByTestId('rule-json').fill('{ "mode": "xml" }'); await expect(page.getByTestId('rule-json-err')).toContainText('mode');
  await page.getByTestId('rule-json').fill('{ "mode": "html" }'); await expect(page.getByTestId('rule-test')).toBeEnabled();
  await page.getByTestId('rule-url').fill('abc'); await expect(page.getByTestId('rule-url-err')).toBeVisible(); await expect(page.getByTestId('rule-generate')).toBeDisabled();
  await page.getByTestId('nav-settings').click(); await page.getByTestId('set-batch').fill('99'); await expect(page.getByTestId('set-batch-err')).toContainText('1–50');
  await page.getByTestId('set-base').fill('api.openai'); await expect(page.getByTestId('set-base-err')).toBeVisible(); await expect(page.getByTestId('set-save-ai')).toBeDisabled();
});

test('详情上一个/下一个 + 位置指示 + 滚动位置记忆', async ({ page }) => {
  await page.goto('/?view=products&noonboard'); const rows = page.getByTestId('product-row'); await rows.nth(1).click();
  await expect(page.getByTestId('detail-pos')).toContainText('2 /'); const n2 = await page.getByTestId('product-detail').locator('h2').innerText();
  await page.getByTestId('detail-next').click(); await expect(page.getByTestId('detail-pos')).toContainText('3 /'); await expect(page.getByTestId('product-detail').locator('h2')).not.toHaveText(n2);
  await page.getByTestId('detail-prev').click(); await expect(page.getByTestId('product-detail').locator('h2')).toHaveText(n2);
  const sp = page.getByTestId('detail-splitter'); await sp.focus(); const w0 = Number(await sp.getAttribute('aria-valuenow')); await page.keyboard.press('ArrowLeft');
  await expect(sp).toHaveAttribute('aria-valuenow', String(w0 + 16)); await sp.dblclick(); await expect(sp).toHaveAttribute('aria-valuenow', '440');
});

test('AI 面板：流式输出、停止、完成后可再次提问', async ({ page }) => {
  await page.goto('/?view=products&noonboard'); await expect(page.getByTestId('product-row').first()).toBeVisible(); await page.keyboard.press('Control+j'); await expect(page.getByTestId('ai-panel')).toBeVisible();
  await page.route('**/api/ai/ask', async r => { await new Promise(x => setTimeout(x, 800)); await r.continue().catch(() => {}); });
  await page.getByTestId('ai-input').fill('AI writing'); await page.getByTestId('ai-input').press('Enter');
  await expect(page.getByTestId('ai-msg').last()).toHaveAttribute('data-state', 'streaming'); await page.getByTestId('ai-stop').click();
  await expect(page.getByTestId('ai-msg').last()).toHaveAttribute('data-state', 'stopped'); await expect(page.getByTestId('ai-send')).toBeVisible();
  await page.unroute('**/api/ai/ask'); await page.route('**/api/ai/ask', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"模拟故障"}' }));
  await page.getByTestId('ai-input').fill('notes'); await page.getByTestId('ai-input').press('Enter'); await expect(page.getByTestId('ai-msg').last()).toHaveAttribute('data-state', 'error');
  await page.unroute('**/api/ai/ask'); await page.getByTestId('ai-retry').click(); await expect(page.getByTestId('ai-msg').last()).toHaveAttribute('data-state', 'done', { timeout: 10000 });
});

test('新手引导：稍后继续 → 下次从同一步恢复；跳过后不再出现', async ({ page, request }) => {
  await request.post('/api/settings', { data: { 'app.onboarded': '', 'app.onboardStep': '' } });
  await page.goto('/'); const ob = page.getByTestId('onboarding'); await page.getByTestId('ob-next').click(); await page.getByTestId('ob-next').click();
  await expect(page.getByTestId('ob-key')).toBeVisible(); await page.getByTestId('ob-later').click(); await expect(ob).toBeHidden();
  await page.reload(); await expect(page.getByTestId('ob-resumed')).toContainText('第 3 步'); await expect(page.getByTestId('ob-key')).toBeVisible();
  await page.getByTestId('ob-key').fill('sk-x'); await page.getByTestId('ob-base').fill('bad'); await expect(page.getByTestId('ob-next')).toBeDisabled();
  await page.getByTestId('ob-skip').click(); await expect(ob).toBeHidden(); await page.reload(); await page.waitForTimeout(500); await expect(ob).toHaveCount(0);
});
