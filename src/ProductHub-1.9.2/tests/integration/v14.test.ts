import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { DB } from '../../src/server/db';
import { startServer } from '../../src/server/server';
import { upsertProduct } from '../../src/server/products';

const fx = (n: string) => fs.readFileSync('tests/fixtures/web/' + n, 'utf8');
const fetcher = async (url: string) => {
  const ok = (text: string, type = 'text/html') => ({ status: 200, text, contentType: type, finalUrl: url });
  if (url.includes('duckduckgo.com')) return ok(fx('ddg-ok.html'));
  if (url.includes('bing.com')) throw new Error('network down');
  if (url.includes('api.github.com')) return ok('{"items":[]}', 'application/json');
  if (url.includes('hn.algolia.com')) return ok('{"hits":[]}', 'application/json');
  if (url.includes('acmenotes.io/pricing')) return ok(fx('site-pricing.html'));
  if (url.includes('acmenotes.io') || url.includes('otter.ai')) return ok(fx('site-home.html'));
  return { status: 404, text: '', contentType: 'text/html', finalUrl: url };
};
let srv: Awaited<ReturnType<typeof startServer>>; let ro: Awaited<ReturnType<typeof startServer>>; let db: DB; let G: Record<string, string> = {};
const call = async (base: string, p: string, method = 'GET', body?: any) => { const r = await fetch(base + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let data: any = t; try { data = JSON.parse(t); } catch { /* raw */ } return { status: r.status, data, headers: r.headers }; };
const idle = async () => { for (let i = 0; i < 100; i++) { const s = (await call(srv.url, '/api/enrich/status')).data; if (!s.active) return s; await new Promise(r => setTimeout(r, 30)); } };
beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-v14-')); db = await DB.open(path.join(dir, 'x.db'));
  for (const [n, u, t] of [['Acme Notes', 'https://acmenotes.io', 'AI meeting notes for teams'], ['tl;dv', 'https://tldv.io', 'Record and transcribe meetings'], ['CleanShot', 'https://cleanshot.com', 'Screen recording for Mac'], ['Paper', 'https://paper.io', 'Docs']] as const)
    G[n] = upsertProduct(db, { name: n, url: u, tagline: t, launch_date: '2025-01-01' }).guid;
  srv = await startServer({ db, dataDir: dir, fetcher }); ro = await startServer({ db, dataDir: dir, readOnly: true, fetcher });
});
afterAll(async () => { await srv.close(); await ro.close(); });

describe('v1.4 找产品：搜索 / 联网 / 补齐 / 对比', () => {
  it('自然语言搜索：相关度排序、为什么匹配、解析结果、快捷条件', async () => {
    const r = (await call(srv.url, '/api/products/query', 'POST', { q: '帮团队做会议纪要的工具' })).data;
    expect(r.items[0].name).toBe('Acme Notes'); expect(r.items[0].match.reasons.join()).toMatch(/会议纪要/);
    expect(r.search).toMatchObject({ mode: 'rule', keywords: ['会议纪要'], constraints: ['team'] }); expect(r.search.concepts[0].alts.length).toBeGreaterThan(0);
    expect((await call(srv.url, '/api/products/query', 'POST', { q: '录屏', chips: ['mac'] })).data.items.map((x: any) => x.name)).toEqual(['CleanShot']);
    expect((await call(srv.url, '/api/products/query', 'POST', { q: '会议', chips: ['opensource'] })).data.total).toBe(0);
    expect((await call(ro.url, '/api/products/query', 'POST', { q: 'clenshot' })).data.items[0].name).toBe('CleanShot');
  });
  it('联网搜索：来源状态、过滤非产品、已在库标记；入库后去重并自动排队补齐；只读可搜不可入库', async () => {
    const r = (await call(srv.url, '/api/websearch', 'POST', { q: 'AI meeting notes' })).data;
    expect(r.providers.find((p: any) => p.id === 'bing')).toMatchObject({ ok: false }); expect(r.providers.find((p: any) => p.id === 'ddg')).toMatchObject({ ok: true });
    expect(r.items.map((x: any) => x.domain)).toEqual(['otter.ai', 'tldv.io']); expect(r.items[1]).toMatchObject({ inLibrary: true, libraryGuid: G['tl;dv'] });
    expect((await call(srv.url, '/api/websearch', 'POST', {})).status).toBe(400);
    expect((await call(ro.url, '/api/websearch', 'POST', { q: 'AI meeting notes' })).status).toBe(200);
    expect((await call(ro.url, '/api/websearch/ingest', 'POST', { items: [r.items[0]] })).status).toBe(403);
    const ing = (await call(srv.url, '/api/websearch/ingest', 'POST', { items: [r.items[0]] })).data; expect(ing.items[0]).toMatchObject({ status: 'inserted', guid: r.items[0].guid });
    expect((await call(srv.url, '/api/websearch/ingest', 'POST', { items: [r.items[0]] })).data.items[0].guid).toBe(ing.items[0].guid);
    await idle(); const p = (await call(srv.url, '/api/products/' + ing.items[0].guid)).data; expect(p.origin).toBe('web'); expect(p.enrich_status).toBe('ok'); expect(p.enrich.company.name).toBe('Acme Labs Inc.');
    const again = (await call(srv.url, '/api/websearch', 'POST', { q: 'AI meeting notes' })).data; expect(again.items.every((x: any) => x.inLibrary)).toBe(true);
  });
  it('补齐信息：批量入队、进度、失败原因、写入后可被“有免费版”快捷条件命中', async () => {
    expect((await call(srv.url, '/api/enrich', 'POST', { guids: [] })).status).toBe(400); expect((await call(ro.url, '/api/enrich', 'POST', { guids: [G.Paper] })).status).toBe(403);
    const q = (await call(srv.url, '/api/enrich', 'POST', { guids: [G['Acme Notes'], G.Paper] })).data; expect(q.queued).toBe(2);
    const s = await idle(); expect(s.enriched).toBeGreaterThanOrEqual(2); expect(s.errors).toBe(1);
    const a = (await call(srv.url, '/api/products/' + G['Acme Notes'])).data; expect(a.enrich.pricing.tiers.length).toBe(4); expect(a.enriched_at).toBeTruthy();
    expect((await call(srv.url, '/api/products/' + G.Paper)).data.enrich_status).toBe('error:HTTP 404');
    expect((await call(srv.url, '/api/products/query', 'POST', { q: 'meeting', chips: ['free'] })).data.items.map((x: any) => x.name)).toContain('Acme Notes');
  });
  it('对比：参数校验、差异行、导出 xlsx / md（只读可用）', async () => {
    expect((await call(srv.url, '/api/compare?guids=' + G.Paper)).status).toBe(400);
    const c = (await call(ro.url, `/api/compare?guids=${G['Acme Notes']},${G['tl;dv']},${G.CleanShot}`)).data; expect(c.products).toHaveLength(3); expect(c.rows.find((r: any) => r.key === 'company').values[0]).toBe('Acme Labs Inc.'); expect(c.diffCount).toBeGreaterThan(0);
    const md = await call(srv.url, `/api/compare/export?format=md&guids=${G['Acme Notes']},${G['tl;dv']}`); expect(md.headers.get('content-type')).toMatch(/markdown/); expect(md.data).toMatch(/Acme Notes \| tl;dv/);
    const x = await fetch(srv.url + `/api/compare/export?format=xlsx&guids=${G['Acme Notes']},${G['tl;dv']}`); expect(x.headers.get('content-disposition')).toMatch(/xlsx/); expect((await x.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });
});
