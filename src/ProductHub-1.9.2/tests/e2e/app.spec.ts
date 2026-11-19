import { test, expect, Page } from '@playwright/test';

const P = '/?view=products&noonboard';
const pick = async (page: Page, testId: string, text: string) => { await page.getByTestId(testId).click(); await page.getByRole('option', { name: text, exact: true }).click(); };

test('首次启动引导：欢迎 → 数据已就绪 → 跳过 AI → 进入首页；只出现一次', async ({ page }) => {
  await page.goto('/');
  const ob = page.getByTestId('onboarding'); await expect(ob).toContainText('欢迎使用统一产品库');
  await page.getByTestId('ob-next').click(); await expect(page.getByTestId('ob-stats')).toContainText('10');
  await page.getByTestId('ob-next').click(); await expect(page.getByTestId('ob-key')).toBeVisible();
  await page.getByTestId('ob-skip-ai').click(); await page.getByTestId('ob-finish').click();
  await expect(ob).toBeHidden(); await expect(page.getByTestId('home')).toBeVisible();
  await page.reload(); await expect(page.getByTestId('home')).toBeVisible(); await page.waitForTimeout(500); await expect(ob).toHaveCount(0);
  await page.getByTestId('nav-settings').click(); await page.getByTestId('rerun-onboarding').click(); await expect(ob).toBeVisible(); await page.getByTestId('ob-skip').click(); await expect(ob).toBeHidden();
});

test('产品库列表、侧栏分类树、关键词搜索', async ({ page }) => {
  await page.goto(P);
  await expect(page.getByTestId('total')).toContainText('10');
  await page.getByTestId('search').fill('Shopify');
  await expect(page.getByTestId('product-row')).toHaveCount(1);
  await page.getByTestId('search').fill('');
  await expect(page.getByTestId('total')).toContainText('10');
  await page.getByTestId('cat-ai').click();
  await expect.poll(() => page.getByTestId('product-row').count()).toBe(3);
  await expect(page.getByTestId('product-table')).toContainText('PixelForge');
  await page.getByTestId('cat-ai').locator('xpath=..').getByRole('button', { name: '展开' }).click().catch(() => {});
});

test('详情、版本记录、AI 分析、找相似（右侧 Sheet 面板）', async ({ page }) => {
  await page.goto(P); await page.getByTestId('search').fill('WriteBot');
  await expect(page.getByTestId('product-row')).toHaveCount(1);
  await page.getByTestId('product-row').first().click();
  const d = page.getByTestId('product-detail'); await expect(d).toContainText('WriteBot');
  await page.getByTestId('tab-versions').click(); await expect(page.getByTestId('versions').locator('li')).toHaveCount(2);
  await page.getByTestId('analyze').click(); await expect(page.getByTestId('ai-analysis')).toContainText('创新度');
  await page.getByTestId('find-similar').click();
  await expect(page.getByTestId('ai-panel')).toBeVisible();
  await expect(page.getByTestId('similar-list')).toContainText('CopyGenie');
  await page.getByTestId('ai-input').fill('password privacy'); await page.getByTestId('ai-input').press('Enter');
  await expect(page.getByTestId('ai-panel')).toContainText('VaultKey');
  await page.keyboard.press('Control+j'); await expect(page.getByTestId('ai-panel')).toBeHidden();
});

test('普通表单查询：分类 + 标签 + 更多条件 + 重置', async ({ page }) => {
  await page.goto(P);
  await pick(page, 'q-category', '金融财务'); await page.getByTestId('q-submit').click();
  await expect.poll(() => page.getByTestId('product-row').count()).toBe(1); await expect(page.getByTestId('product-table')).toContainText('PayFlow');
  await page.getByTestId('q-reset').click(); await expect(page.getByTestId('total')).toContainText('10');
  await page.getByTestId('q-tags').click(); await page.getByTestId('ms-option').filter({ hasText: '开源' }).click(); await page.keyboard.press('Escape');
  await page.getByTestId('q-submit').click(); await expect(page.getByTestId('product-table')).toContainText('CodeShip');
  await page.getByTestId('q-reset').click();
  await page.getByTestId('q-more').click(); await expect(page.getByTestId('q-more-panel')).toBeVisible();
  await page.getByTestId('q-votes').fill('80'); await page.getByTestId('q-submit').click();
  await expect.poll(() => page.getByTestId('product-row').count()).toBe(3);
  await page.getByTestId('q-launches').fill('2'); await page.getByTestId('q-votes').fill(''); await page.getByTestId('q-submit').click();
  await expect.poll(() => page.getByTestId('product-row').count()).toBe(1); await expect(page.getByTestId('product-table')).toContainText('WriteBot');
  await page.getByTestId('q-sources').click(); await expect(page.getByTestId('ms-option').first()).toBeVisible(); await page.keyboard.press('Escape');
  await page.getByTestId('q-reset').click(); await expect(page.getByTestId('total')).toContainText('10');
});

test('手动添加产品（Dialog）+ 去重合并', async ({ page }) => {
  await page.goto(P); await page.getByTestId('add-product').click();
  await page.getByTestId('f-name').fill('E2E Tool'); await page.getByTestId('f-url').fill('https://e2e-tool.dev'); await page.getByTestId('f-tagline').fill('A tool added by e2e');
  await page.getByTestId('f-submit').click();
  await expect(page.getByTestId('product-detail')).toContainText('E2E Tool');
  await page.getByTestId('detail-close').click();
  await page.keyboard.press('Control+n'); await page.getByTestId('f-name').fill('E2E Tool again'); await page.getByTestId('f-url').fill('http://www.e2e-tool.dev/'); await page.getByTestId('f-submit').click();
  await expect(page.getByText('产品已存在，已合并为新版本')).toBeVisible();
  await expect(page.getByTestId('total')).toContainText('11');
});

test('命令面板、右键菜单、键盘导航、主题、侧栏折叠', async ({ page }) => {
  await page.goto(P); await page.getByTestId('product-row').first().waitFor();
  await page.keyboard.press('Control+k'); await page.getByTestId('palette-input').fill('VaultKey');
  await page.getByRole('option', { name: /VaultKey/ }).first().click(); await expect(page.getByTestId('product-detail')).toContainText('VaultKey');
  await page.keyboard.press('Escape'); await expect(page.getByTestId('product-detail')).toBeHidden();
  await page.keyboard.press('Control+k'); await page.getByTestId('palette-input').fill('分析与报告'); await page.keyboard.press('Enter'); await expect(page.getByTestId('analytics')).toBeVisible();
  await page.keyboard.press('Control+2'); await page.getByTestId('product-row').first().click({ button: 'right' });
  await expect(page.getByTestId('row-menu')).toBeVisible(); await page.getByRole('menuitem', { name: '查找相似产品' }).click(); await expect(page.getByTestId('ai-panel')).toBeVisible(); await page.keyboard.press('Control+j');
  await page.getByTestId('product-row').first().click(); const first = await page.getByTestId('product-detail').locator('h2').innerText();
  await page.locator('body').press('ArrowDown'); await expect(page.getByTestId('product-detail').locator('h2')).not.toHaveText(first);
  await page.getByTestId('theme-toggle').click(); await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  const sb = page.getByTestId('sidebar'); const c0 = await sb.getAttribute('data-collapsed'); const c1 = c0 === 'true' ? 'false' : 'true';
  await page.keyboard.press('Control+b'); await expect(sb).toHaveAttribute('data-collapsed', c1);
  await page.keyboard.press('Control+b'); await expect(sb).toHaveAttribute('data-collapsed', c0!);
  await expect(page.getByTestId('statusbar')).toContainText('AI 离线模式');
});

test('来源监控 + 自定义监控 + 规则工作台 + 导出', async ({ page }) => {
  await page.goto('/?view=sources&noonboard');
  await expect(page.getByTestId('source-table')).toContainText('Product Hunt');
  await page.getByTestId('add-source').click(); await page.getByTestId('s-name').fill('My Site'); await page.getByTestId('s-url').fill('https://example.org/new'); await page.getByTestId('s-submit').click();
  await expect(page.getByTestId('source-table')).toContainText('My Site');
  await page.getByTestId('tab-rules').click(); await expect(page.getByTestId('rule-json')).toBeVisible();
  await page.getByTestId('nav-data').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-xlsx').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.xlsx$/);
  await page.getByTestId('nav-analytics').click(); await expect(page.getByTestId('analytics')).toContainText('产品总数');
  await page.getByTestId('nav-settings').click(); await page.getByTestId('theme-light').click(); await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('首页今日新增 + 关注/我的关注 + 列设置', async ({ page, request }) => {
  // 自包含、可重复：先清空关注，确保首页基线已建立，再新增一个唯一产品
  const favs = await (await request.post('/api/products/query', { data: { filter: { type: 'cond', field: 'favorite', op: 'is_true' } } })).json();
  for (const p of favs.items) await request.delete('/api/favorites/' + p.guid);
  await request.get('/api/home'); const name = 'Fresh ' + Date.now().toString(36);
  await request.post('/api/products', { data: { name, url: `https://${name.replace(' ', '-').toLowerCase()}.dev` } });
  await page.goto('/?noonboard');
  await expect(page.getByTestId('home-new-list')).toContainText(name); expect(Number(await page.getByTestId('home-new-count').innerText())).toBeGreaterThanOrEqual(1);
  await page.getByTestId('kpi-today').click(); await expect(page.getByTestId('list-title')).toHaveText('同步新增'); await expect(page.getByTestId('product-table')).toContainText(name);
  await page.getByTestId('nav-products').click(); await expect(page.getByTestId('list-title')).toHaveText('全部产品');
  await page.getByTestId('search').fill('PayFlow'); await expect(page.getByTestId('product-row')).toHaveCount(1);
  await page.getByTestId('product-row').first().click(); await expect(page.getByTestId('product-detail')).toContainText('PayFlow'); await page.getByTestId('fav').click(); await expect(page.getByTestId('fav')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('detail-stats')).toContainText('发布次数');
  await page.getByTestId('nav-favorites').click(); await expect(page.getByTestId('list-title')).toHaveText('我的关注');
  await expect(page.getByTestId('product-row')).toHaveCount(1); await expect(page.getByTestId('product-table')).toContainText('PayFlow');
  await page.getByTestId('nav-home').click(); await expect(page.getByTestId('kpi-fav')).toContainText('1');
  await page.keyboard.press('Control+3'); await expect(page.getByTestId('list-title')).toHaveText('我的关注'); await expect(page.getByTestId('product-row')).toHaveCount(1);
  await page.getByTestId('fav-toggle').first().click(); await expect(page.getByTestId('empty-fav')).toBeVisible();
  await page.getByTestId('nav-products').click(); await expect(page.getByTestId('product-row').first()).toBeVisible(); await expect(page.getByTestId('product-table')).not.toContainText('票数');
  await page.getByTestId('col-menu').click(); await page.getByTestId('col-votes').click(); await page.keyboard.press('Escape');
  await expect(page.getByTestId('product-table')).toContainText('票数');
});

test('来源异常定位 + 分析报告导出 + 组件库（开发模式）', async ({ page }) => {
  await page.goto('/?noonboard'); await page.getByTestId('kpi-errors').click();
  await expect(page.getByTestId('sources')).toBeVisible(); await expect(page.getByTestId('src-status')).toContainText('失败');
  await page.getByTestId('nav-analytics').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('report-html').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.html$/);
  await page.goto('/?view=design&dev=1&noonboard'); await expect(page.getByTestId('design-gallery')).toContainText('颜色令牌');
  await expect(page.getByTestId('nav-design')).toBeVisible();
});

test('内部预览站点为只读', async ({ page }) => {
  await page.goto('http://127.0.0.1:18791/?view=products');
  await expect(page.getByText('内部预览 · 只读')).toBeVisible();
  await expect(page.getByTestId('add-product')).toHaveCount(0);
  await expect(page.getByTestId('nav-settings')).toHaveCount(0);
  await page.getByTestId('product-row').first().click(); await expect(page.getByTestId('product-detail')).toBeVisible(); await expect(page.getByTestId('analyze')).toHaveCount(0);
});
