import { describe, it, expect } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { parseFeed, parseJsonLd, extractByRule, inferHtmlRule, discoverFeeds, parseDetail, runRule, crawlSource, generateRule, cleanName, regDomain } from '../../src/server/crawler';
import { DB } from '../../src/server/db';
import { upsertSource } from '../../src/server/sources';
import { sourceGuid } from '../../src/server/util';
import { cacheImage } from '../../src/server/images';
import { LIST_HTML, RSS, ATOM, JSONLD, mockFetcher } from '../fixtures/pages';

describe('解析器', () => {
  it('RSS：拆分标题/简介，提取图片与日期', () => {
    const items = parseFeed(RSS, 'https://launch.example.com/');
    expect(items).toHaveLength(3); expect(items[0]).toMatchObject({ name: 'Zeta Agent', tagline: 'Autonomous AI agent for sales outreach', image: 'https://cdn.example.com/zeta.png', date: '2026-10-05' });
    expect(items[0].description).toContain('Zeta automates sales');
  });
  it('Atom', () => { const i = parseFeed(ATOM, 'https://atom.example.com/'); expect(i[0]).toMatchObject({ name: 'Iota VPN', detailUrl: 'https://iota.vpn/' }); });
  it('JSON-LD ItemList', () => { const i = parseJsonLd(JSONLD, 'https://ld.example.com/'); expect(i.map(x => x.name)).toEqual(['Kappa CRM', 'Lambda DB', 'Mu Music']); expect(i[2].detailUrl).toBe('https://mu.app/'); });
  it('HTML 规则提取（含票数/正则）', () => {
    const items = extractByRule(LIST_HTML, { mode: 'html', itemSelector: 'article.product-card', fields: { name: { selector: 'h3' }, url: { selector: 'a', attr: 'href' }, description: { selector: 'p' }, image: { selector: 'img', attr: 'src' }, votes: { selector: '.votes' } } }, 'https://launch.example.com/');
    expect(items).toHaveLength(5); expect(items[1]).toMatchObject({ name: 'Beta DevKit', detailUrl: 'https://launch.example.com/p/beta-devkit', image: 'https://launch.example.com/logos/1.png', votes: 24 });
  });
  it('启发式推断列表规则', () => { const r = inferHtmlRule(LIST_HTML, 'https://launch.example.com/')!; expect(r.itemSelector).toBe('article.product-card'); expect(extractByRule(LIST_HTML, r, 'https://launch.example.com/')[0].name).toBe('Alpha AI Writer'); });
  it('Feed 发现 & 详情页解析（官网外链、去掉跟踪参数前的选择、OG）', () => {
    expect(discoverFeeds(LIST_HTML, 'https://launch.example.com/')).toEqual(['https://launch.example.com/feed.xml']);
    const d = parseDetail('<html><head><meta property="og:title" content="Foo - Site"><meta property="og:image" content="/i.png"></head><body><a href="https://x.com/a">x</a><a href="https://foo.io/?ref=site">Visit website</a></body></html>', 'https://site.com/p/foo');
    expect(d.url).toBe('https://foo.io/?ref=site'); expect(d.image).toBe('https://site.com/i.png'); expect(d.name).toBe('Foo');
  });
  it('名称清洗 / 注册域名', () => {
    expect(cleanName('1. ToolVerified')).toBe('ToolVerified'); expect(cleanName('Vendbuddyby Vendbuddy · @vendbuddy')).toBe('Vendbuddy');
    expect(cleanName('Something very long name that goes on and on - and a tagline here too', 'Short')).toBe('Short');
    expect(regDomain('auth.pitchwall.co')).toBe('pitchwall.co'); expect(regDomain('a.b.co.uk')).toBe('b.co.uk');
  });
});

describe('抓取流程（模拟网络）', () => {
  it('auto 模式优先发现 RSS，并跟进详情页拿官网', async () => {
    const f = mockFetcher(); const { items, rule } = await runRule({ mode: 'auto' }, 'https://launch.example.com/', f);
    expect(rule.mode).toBe('rss'); expect(items.map(i => i.name)).toEqual(['Zeta Agent', 'Eta Design', 'Theta Shop']);
    expect(items[2].url).toBe('https://thetashop.com/'); expect(items[0].url).toBe('https://zeta.example.net/?ref=launchsite');
  });
  it('站点级通用外链（出现≥3次）被判为无效官网', async () => {
    const page = `<div>${[1, 2, 3, 4].map(i => `<article class="c"><h3>Prod ${i}</h3><a href="https://sponsor.com/">Sponsor</a></article>`).join('')}</div>`;
    const f = mockFetcher({ 'https://dir.example.com/': page });
    const { items } = await runRule({ mode: 'html', itemSelector: 'article.c', fields: { name: { selector: 'h3' }, url: { selector: 'a', attr: 'href' } }, followDetail: false }, 'https://dir.example.com/', f);
    expect(items).toHaveLength(4); expect(items.every(i => i.url === null)).toBe(true);
  });
  it('crawlSource 入库 + 增量 + 图片缓存 + 错误记录', async () => {
    const db = await DB.open(null); upsertSource(db, { name: 'Launch', url: 'https://launch.example.com/' });
    const g = sourceGuid('https://launch.example.com/'); const f = mockFetcher();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-'));
    const r1 = await crawlSource(db, g, { fetcher: f, imageDir: dir }); expect(r1).toMatchObject({ found: 3, inserted: 3 });
    const r2 = await crawlSource(db, g, { fetcher: f }); expect(r2).toMatchObject({ found: 3, inserted: 0, updated: 0 });
    const s = db.get<any>('SELECT * FROM sources WHERE guid=?', [g]); expect(s.last_status).toBe('ok'); expect(s.product_count).toBe(3); expect(JSON.parse(s.rule_json).mode).toBe('rss');
    expect(db.all('SELECT * FROM crawl_runs')).toHaveLength(2);
    upsertSource(db, { name: 'Bad', url: 'https://bad.example.com/' }); const r3 = await crawlSource(db, sourceGuid('https://bad.example.com/'), { fetcher: f });
    expect(r3.error).toContain('404'); expect(r3.kind).toBe('not_found'); expect(db.get<any>("SELECT last_status FROM sources WHERE name='Bad'").last_status).toBe('error');
    await expect(crawlSource(db, 'missing')).rejects.toThrow();
  });
  it('AI 辅助规则生成（无 Key → 本地推断/JSON-LD/RSS）', async () => {
    const db = await DB.open(null);
    const f = mockFetcher({ 'https://plain.example.com/': LIST_HTML.replace(/<link[^>]+>/, '') });
    const a = await generateRule(db, 'https://plain.example.com/', '', f); expect(a.mode).toBe('local'); expect(a.rule.itemSelector).toBe('article.product-card'); expect(a.preview).toHaveLength(5);
    expect((await generateRule(db, 'https://ld.example.com/', '', f)).rule.mode).toBe('jsonld');
    expect((await generateRule(db, 'https://launch.example.com/feed.xml', '', f)).rule.mode).toBe('rss');
    expect((await generateRule(db, 'https://launch.example.com/', '', f)).rule.mode).toBe('rss');
  });
});

describe('图片缓存', () => {
  it('下载一次后命中本地缓存；非图片/失败返回 null', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-')); let n = 0;
    const png = Buffer.alloc(200, 1);
    const ok: any = async () => { n++; return new Response(png, { headers: { 'content-type': 'image/png' } }); };
    const f1 = await cacheImage('https://x.com/a.png', dir, ok); expect(f1).toMatch(/\.png$/); expect(fs.existsSync(path.join(dir, f1!))).toBe(true);
    expect(await cacheImage('https://x.com/a.png', dir, ok)).toBe(f1); expect(n).toBe(1);
    expect(await cacheImage('https://x.com/b', dir, (async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })) as any)).toBeNull();
    expect(await cacheImage('https://x.com/c', dir, (async () => { throw new Error('net'); }) as any)).toBeNull();
    expect(await cacheImage('data:image/png;base64,xx', dir)).toBeNull();
  });
});
