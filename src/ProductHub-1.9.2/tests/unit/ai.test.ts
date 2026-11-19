import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DB } from '../../src/server/db';
import { localEmbed, cosine, tokenize, findSimilar, localAnalysis, analyzeProduct, askAI, aiConfig, aiEnabled, libraryAnalytics, DIM } from '../../src/server/ai';
import { upsertProduct, getProduct } from '../../src/server/products';

let db: DB;
beforeAll(async () => {
  db = await DB.open(null);
  for (const [n, t] of [['WriteBot', 'AI writing assistant for blog posts and copywriting'], ['CopyGenie', 'AI copywriting tool to write marketing blog content'], ['FitTrack', 'Workout and fitness tracker app'], ['CodeShip', 'Deploy code to the cloud with one CLI command'], ['笔记大师', '一款高效的笔记与知识管理工具']]) upsertProduct(db, { name: n, url: `https://${encodeURIComponent(n)}.com`, tagline: t });
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.OPENAI_API_KEY; });

describe('本地 AI 能力（离线降级）', () => {
  it('向量维度 / 归一化 / 中文分词', () => {
    const v = localEmbed('hello world'); expect(v).toHaveLength(DIM); expect(Math.abs(cosine(v, v) - 1)).toBeLessThan(1e-3);
    expect(tokenize('笔记工具')).toEqual(['笔记', '记工', '工具']); expect(cosine([], [])).toBe(0);
  });
  it('相似产品：语义接近的排在前面', () => {
    const w = db.get<any>("SELECT guid FROM products WHERE name='WriteBot'").guid;
    const s = findSimilar(db, { guid: w, limit: 3 }); expect(s[0].name).toBe('CopyGenie'); expect(s.find(x => x.guid === w)).toBeUndefined();
    expect(findSimilar(db, { text: '知识管理 笔记' })[0].name).toBe('笔记大师');
    expect(findSimilar(db, { guid: 'nope' })).toEqual([]);
  });
  it('本地多维分析包含 6 个维度与 1-10 评分', () => {
    const p = getProduct(db, db.get<any>("SELECT guid FROM products WHERE name='WriteBot'").guid);
    const a = localAnalysis(p, [{ name: 'CopyGenie' }]); expect(a.mode).toBe('local'); expect(a.dimensions).toHaveLength(6);
    for (const d of a.dimensions) { expect(d.score).toBeGreaterThanOrEqual(1); expect(d.score).toBeLessThanOrEqual(10); }
    expect(a.summary).toContain('WriteBot'); expect(a.competitors).toEqual(['CopyGenie']);
  });
  it('无 Key 时 analyze / ask 自动降级', async () => {
    expect(aiEnabled(db)).toBe(false);
    const p = getProduct(db, db.get<any>("SELECT guid FROM products WHERE name='FitTrack'").guid);
    expect((await analyzeProduct(db, p)).mode).toBe('local');
    const r = await askAI(db, 'fitness workout'); expect(r.mode).toBe('local'); expect(r.products[0].name).toBe('FitTrack');
  });
  it('配置 Key 后调用 OpenAI 兼容接口；接口失败回退本地', async () => {
    db.setSetting('ai.apiKey', 'sk-test'); db.setSetting('ai.baseUrl', 'https://llm.local/v1/');
    expect(aiConfig(db).baseUrl).toBe('https://llm.local/v1');
    const fetchMock = vi.fn(async (_u: string, init: any) => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.parse(init.body).response_format ? JSON.stringify({ summary: '大模型总结', dimensions: [{ key: 'innovation', label: '创新度', score: 8, comment: 'ok' }], audience: ['开发者'], features: [], business_model: '订阅', competitors: [] }) : '推荐 FitTrack' } }] }) }));
    vi.stubGlobal('fetch', fetchMock);
    const p = getProduct(db, db.get<any>("SELECT guid FROM products WHERE name='FitTrack'").guid);
    const a = await analyzeProduct(db, p); expect(a.mode).toBe('ai'); expect(a.summary).toBe('大模型总结');
    expect(fetchMock.mock.calls[0][0]).toBe('https://llm.local/v1/chat/completions'); expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer sk-test');
    expect((await askAI(db, 'fitness')).answer).toBe('推荐 FitTrack');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' })));
    const b = await analyzeProduct(db, p); expect(b.mode).toBe('local'); expect((b as any).error).toContain('500');
    db.setSetting('ai.apiKey', '');
  });
  it('环境变量 OPENAI_API_KEY 生效', () => { process.env.OPENAI_API_KEY = 'sk-env'; expect(aiEnabled(db)).toBe(true); });
  it('全库统计', () => { const a = libraryAnalytics(db); expect(a.totals.products).toBe(5); expect(a.byCat.length).toBeGreaterThan(0); });
});
