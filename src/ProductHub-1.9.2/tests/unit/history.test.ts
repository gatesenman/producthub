import { describe, it, expect } from 'vitest';
import { PoliteFetcher, backoffMs, findNextPage, pageUrlCandidates, parseSitemap, pickProductUrls, isArticleNoise, parseShowHn, parseBetaListPage } from '../../src/server/history';

describe('v1.5 历史抓取工具', () => {
  it('429 退避：遵守 Retry-After，并指数增长', async () => {
    let n = 0; const sleeps: number[] = [];
    const pf = new PoliteFetcher(0, {}, () => {}, async ms => { sleeps.push(ms); });
    const r = await pf.fetch('https://x.test/a', { raw: async () => (++n < 3 ? { status: 429, text: '', contentType: '', finalUrl: '', retryAfter: n === 1 ? 7 : null } : { status: 200, text: 'ok', contentType: 'text/html', finalUrl: '' }) });
    expect(r.status).toBe(200); expect(pf.stats.r429).toBe(2); expect(sleeps).toContain(7000); expect(sleeps).toContain(30000);
    expect(backoffMs(0)).toBe(15000); expect(backoffMs(10)).toBe(600000);
  });
  it('同主机请求串行并保持最小间隔', async () => {
    const pf = new PoliteFetcher(50); const t: number[] = [];
    await Promise.all([1, 2, 3].map(() => pf.fetch('https://h.test/', { raw: async () => { t.push(Date.now()); return { status: 200, text: '', contentType: '', finalUrl: '' }; } })));
    expect(t[2] - t[0]).toBeGreaterThanOrEqual(95);
  });
  it('发现下一页与分页模式', () => {
    expect(findNextPage('<a href="/list?page=3" rel="next">x</a>', 'https://a.com/list?page=2')).toBe('https://a.com/list?page=3');
    expect(findNextPage('<a href="/p/2">下一页</a>', 'https://a.com/')).toBe('https://a.com/p/2');
    expect(findNextPage('<a href="/x">hello</a>', 'https://a.com/')).toBeNull();
    expect(pageUrlCandidates('https://a.com/tools', 2)).toContain('https://a.com/tools?page=2');
  });
  it('sitemap 解析与产品 URL 挑选', () => {
    const idx = parseSitemap('<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>'); expect(idx.sitemaps).toEqual(['https://a.com/s1.xml']);
    const urls = [...Array(10)].map((_, i) => ({ loc: `https://a.com/tools/t${i}`, lastmod: <string | null>`2024-01-${String(i + 1).padStart(2, '0')}` })).concat([...Array(20)].map((_, i) => ({ loc: `https://a.com/blog/p${i}`, lastmod: null as string | null })));
    const p = pickProductUrls(urls, 'a.com'); expect(p.seg).toBe('tools'); expect(p.urls).toHaveLength(10); expect(p.urls[0].loc).toBe('https://a.com/tools/t9');
  });
  it('新闻/文章噪音过滤', () => {
    expect(isArticleNoise('Acme raises $20M Series B')).toBe(true);
    expect(isArticleNoise('某公司完成亿元融资')).toBe(true);
    expect(isArticleNoise('Notion', 'https://notion.so')).toBe(false);
    expect(isArticleNoise('Cal.com', 'https://techcrunch.com/2024/01/02/cal')).toBe(true);
  });
  it('Show HN 标题拆分', () => {
    expect(parseShowHn('Show HN: Plausible – Privacy-friendly analytics')).toEqual({ name: 'Plausible', tagline: 'Privacy-friendly analytics' });
  });
  it('BetaList 分页解析带日期', () => {
    const html = '<div data-duplicate-id="day_1394064000"><strong>Thu</strong></div><div class="startup-row">\n<a class="absolute" href="/startups/foo"></a><img src="https://i/x.png"/><span class="a">Foo &amp; Co</span><span>Do things</span></div>';
    expect(parseBetaListPage(html)).toEqual([{ name: 'Foo & Co', tagline: 'Do things', slug: 'foo', image: 'https://i/x.png', date: '2014-03-06' }]);
  });
});
