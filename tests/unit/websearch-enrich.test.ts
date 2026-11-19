import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { DB } from '../../src/server/db';
import { upsertProduct } from '../../src/server/products';
import { parseBing, parseDuckDuckGo, parseGitHub, parseHN, webSearch, ingestWebItems, isProductCandidate } from '../../src/server/websearch';
import { extractFromHtml, extractPricing, findPricingUrl, enrichProduct, EnrichQueue } from '../../src/server/enrich';
import { compareProducts, compareExport } from '../../src/server/compare';
import * as XLSX from 'xlsx';

const fx = (n: string) => fs.readFileSync('tests/fixtures/web/' + n, 'utf8');
const fetcherFrom = (map: Record<string, { status?: number; text: string; type?: string } | Error>) => async (url: string) => {
  const k = Object.keys(map).find(k => url.includes(k)); if (!k) return { status: 404, text: '', contentType: 'text/html', finalUrl: url };
  const v = map[k]; if (v instanceof Error) throw v; return { status: v.status ?? 200, text: v.text, contentType: v.type || 'text/html', finalUrl: url };
};

describe('联网搜索解析器（离线样本）', () => {
  it('Bing：解出跳转后的真实地址与摘要', () => { const r = parseBing(fx('bing.html')); expect(r.length).toBeGreaterThan(5); expect(r[0].url).toMatch(/^https:\/\/(?!www\.bing\.com)/); expect(r[0].snippet.length).toBeGreaterThan(10); });
  it('DuckDuckGo：解析 uddg 跳转；被反爬拦截时报错而不是返回空', () => {
    const r = parseDuckDuckGo(fx('ddg-ok.html')); expect(r.map(x => x.url)).toEqual(['https://www.otter.ai/', 'https://en.wikipedia.org/wiki/Minutes', 'https://tldv.io/zh/']); expect(r[0].title).toContain('Otter.ai');
    expect(() => parseDuckDuckGo(fx('ddg.html'))).toThrow(/拦截/);
  });
  it('GitHub / HN：取主页或仓库地址、星标与日期', () => {
    const g = parseGitHub(fx('gh.json')); expect(g.length).toBeGreaterThan(0); expect(g[0]).toHaveProperty('stars');
    const h = parseHN(fx('hn.json')); expect(h.every((x: any) => /^https?:/.test(x.url))).toBe(true);
    expect(() => parseGitHub('{"message":"API rate limit exceeded"}')).toThrow(/rate limit/);
  });
  it('过滤百科/问答/榜单文章', () => { expect(isProductCandidate('https://en.wikipedia.org/wiki/X', 'X')).toBe(false); expect(isProductCandidate('https://foo.com', 'Top 10 best note apps in 2026')).toBe(false); expect(isProductCandidate('https://otter.ai', 'Otter.ai - AI Meeting Notes')).toBe(true); });
  it('多来源并发：单个来源失败/超时不影响其他；按域名去重并与库内比对；一键入库幂等', async () => {
    const db = await DB.open(null); upsertProduct(db, { name: 'tl;dv', url: 'https://tldv.io' });
    const f = fetcherFrom({ 'duckduckgo.com': { text: fx('ddg-ok.html') }, 'bing.com': new Error('ECONNRESET'), 'api.github.com': { status: 403, text: '{}' }, 'hn.algolia.com': { text: '{"hits":[{"title":"Show HN: Otter – meeting notes","url":"https://otter.ai/","points":12,"created_at":"2026-10-01T00:00:00Z"}]}' } });
    const r = await webSearch(db, 'AI meeting notes', { fetcher: f, timeoutMs: 2000 });
    const st = Object.fromEntries(r.providers.map(p => [p.id, p])); expect(st.ddg.ok).toBe(true); expect(st.bing.ok).toBe(false); expect(st.bing.error).toMatch(/ECONNRESET/); expect(st.github.error).toMatch(/限流/);
    expect(r.items.map(i => i.domain)).toEqual(['otter.ai', 'tldv.io']); expect(r.items[0].provider).toBe('DuckDuckGo · Hacker News');
    expect(r.items.find(i => i.domain === 'tldv.io')!.inLibrary).toBe(true);
    const a = ingestWebItems(db, [r.items[0]]); const b = ingestWebItems(db, [r.items[0]]); expect(a[0].guid).toBe(b[0].guid); expect(a[0].guid).toBe(r.items[0].guid);
    expect(db.get<any>('SELECT origin, tags FROM products WHERE guid=?', [a[0].guid])).toMatchObject({ origin: 'web' });
    const hung = await webSearch(db, 'x', { fetcher: () => new Promise(() => {}), timeoutMs: 30, providers: ['ddg'] }); expect(hung.providers[0].error).toMatch(/超时/);
  });
});

describe('官网信息补齐', () => {
  it('JSON-LD / meta / hreflang / 社交账号 / 公司 / 功能 / 目标用户', () => {
    const e = extractFromHtml(fx('site-home.html'), 'https://acmenotes.io/');
    expect(e.summary).toMatch(/transcribes/); expect(e.company).toMatchObject({ name: 'Acme Labs Inc.', founded: '2021', location: 'San Francisco' });
    expect(e.socials).toMatchObject({ x: 'https://twitter.com/acmenotes', linkedin: 'https://www.linkedin.com/company/acme-labs', discord: 'https://discord.gg/acme123' });
    expect(e.socials.github).toBe('https://github.com/acmenotes/sdk'); // 与域名无关的第三方库链接（bootstrap）不算
    expect(e.languages).toEqual(expect.arrayContaining(['en', 'zh', 'ja'])); expect(e.features).toEqual(expect.arrayContaining(['Automatic meeting transcription', 'Search across every meeting'])); expect(e.features).not.toContain('Privacy policy');
    expect(e.audience).toEqual(expect.arrayContaining(['销售', '产品经理', '初创公司']));
    expect(findPricingUrl(fx('site-home.html'), 'https://acmenotes.io/')).toBe('https://acmenotes.io/pricing');
  });
  it('定价页：档位、价格、周期、免费版', () => {
    const p = extractPricing(fx('site-pricing.html'));
    expect(p.tiers.map(t => t.name)).toEqual(['Free', 'Pro', 'Business', 'Enterprise']); expect(p.tiers[1]).toMatchObject({ price: '$12', period: 'per user' }); expect(p.tiers[3].price).toBe('联系销售');
    expect(p.hasFree).toBe(true); expect(p.model).toBe('Freemium');
  });
  it('enrichProduct 写入 enrich_json/状态；失败记录原因；队列并发与进度', async () => {
    const db = await DB.open(null); const ok = upsertProduct(db, { name: 'Acme Notes', url: 'https://acmenotes.io' }).guid; const bad = upsertProduct(db, { name: 'Down', url: 'https://down.io' }).guid; const nourl = upsertProduct(db, { name: 'NoUrl' }).guid;
    const f = fetcherFrom({ 'acmenotes.io/pricing': { text: fx('site-pricing.html') }, 'acmenotes.io': { text: fx('site-home.html') }, 'down.io': { status: 503, text: '' } });
    const q = new EnrichQueue(db, f, 2); expect(q.add([ok, bad, nourl, ok]).queued).toBe(3); await q.idle();
    const s = q.status(); expect(s).toMatchObject({ active: false, done: 3, failed: 2, total: 3 });
    const row = db.get<any>('SELECT * FROM products WHERE guid=?', [ok]); expect(row.enrich_status).toBe('ok'); expect(row.enriched_at).toBeTruthy();
    const e = JSON.parse(row.enrich_json); expect(e.pricing.tiers).toHaveLength(4); expect(e.pricing.url).toBe('https://acmenotes.io/pricing'); expect(e.method).toBe('heuristic');
    expect(db.get<any>('SELECT enrich_status FROM products WHERE guid=?', [bad]).enrich_status).toBe('error:HTTP 503');
    expect((await enrichProduct(db, nourl, f)).error).toBe('无官网地址');
  });
});

describe('产品对比', () => {
  it('2–5 个产品；逐行差异；AI 评分最高者；导出 xlsx / md', async () => {
    const db = await DB.open(null); const f = fetcherFrom({ 'acmenotes.io/pricing': { text: fx('site-pricing.html') }, 'acmenotes.io': { text: fx('site-home.html') } });
    const a = upsertProduct(db, { name: 'Acme Notes', url: 'https://acmenotes.io', tagline: 'AI meeting notes', tags: ['免费增值'] }).guid; await enrichProduct(db, a, f);
    const b = upsertProduct(db, { name: 'Beta', url: 'https://beta.io', tagline: 'AI meeting notes', launch_date: '2026-10-01' }).guid;
    expect(() => compareProducts(db, [a])).toThrow(/2–5/); expect(() => compareProducts(db, [a, a])).toThrow(/2–5/);
    const c = compareProducts(db, [a, b]); const row = (k: string) => c.rows.find(r => r.key === k)!;
    expect(c.products.map(p => p.name)).toEqual(['Acme Notes', 'Beta']); expect(row('hasFree').values).toEqual(['有', '']); expect(row('tiers').values[0]).toMatch(/Pro \$12/);
    expect(row('company').values[0]).toBe('Acme Labs Inc.'); expect(row('launch_date').differs).toBe(true); expect(c.diffCount).toBe(c.rows.filter(r => r.differs).length); expect(c.rows.some(r => r.key.startsWith('ai_'))).toBe(true);
    const md = compareExport(db, [a, b], 'md'); expect(String(md.body)).toMatch(/\| 属性 \| Acme Notes \| Beta \|/); expect(String(md.body)).toMatch(/★ 免费版/);
    const x = compareExport(db, [a, b], 'xlsx'); const ws = XLSX.read(x.body, { type: 'buffer' }).Sheets['对比']; expect(XLSX.utils.sheet_to_json<any>(ws, { header: 1 })[0]).toEqual(['分组', '属性', '差异', 'Acme Notes', 'Beta']);
  });
});
