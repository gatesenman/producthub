import { describe, it, expect, beforeAll } from 'vitest';
import { DB } from '../../src/server/db';
import { upsertProduct } from '../../src/server/products';
import { normalize, docTokens, segmentCJK, editDistance, pinyinTokens, stem, isGenericProductName, looksLikeAlternativesList } from '../../src/server/search/text';
import { parseRule, parseWithLLM, expand } from '../../src/server/search/nlq';
import { search, constraintOf } from '../../src/server/search/engine';
import { queryProducts, queryProductsLegacy } from '../../src/server/filter';

describe('文本处理', () => {
  it('归一化、英文词干、中文二元组、带数字前缀的品牌名', () => {
    expect(normalize('ＡＩ　Notion')).toBe('ai notion');
    expect(stem('meetings')).toBe(stem('meeting'));
    const t = docTokens('1Password 会议纪要'); expect(t).toContain('1password'); expect(t).toContain('password'); expect(t).toContain('会议'); expect(t).toContain('纪要');
  });
  it('中文分词：最长匹配词典词，去掉口语填充词但不拆散真实词', () => {
    const seg = segmentCJK('做会议纪要的工具'); const kept = seg.filter(x => !x.filler).map(x => x.w); expect(kept).toContain('会议纪要'); expect(kept).not.toContain('的'); expect(kept).not.toContain('工具');
    expect(segmentCJK('和风天气').filter(x => !x.filler).map(x => x.w).join('')).toBe('和风天气');
  });
  it('编辑距离（含相邻换位）与上限截断', () => {
    expect(editDistance('notoin', 'notion', 2)).toBe(1); expect(editDistance('midjouney', 'midjourney', 2)).toBe(1); expect(editDistance('abc', 'xyzw', 1)).toBeGreaterThan(1);
  });
  it('拼音：全拼、首字母', () => { const p = pinyinTokens('豆包'); expect(p).toContain('doubao'); expect(p).toContain('db'); });
  it('识别类目名与替代品清单页', () => {
    expect(isGenericProductName('Collaboration & Project Management Software')).toBe(true);
    expect(isGenericProductName('Enterprise Resource Planning Software (ERP)')).toBe(true);
    expect(isGenericProductName('What is the best network monitoring software for large enterprises?')).toBe(true);
    expect(isGenericProductName('Notion')).toBe(false);
    expect(isGenericProductName('Obsidian')).toBe(false);
    expect(isGenericProductName('We want to displace Notion with')).toBe(true);
    expect(looksLikeAlternativesList('Discover the best open source alternatives to Notion, including Appflowy')).toBe(true);
    expect(looksLikeAlternativesList('All-in-one workspace for notes and docs')).toBe(false);
  });
});

describe('自然语言解析（规则）', () => {
  it('从一句话需求中抽取意图词、约束与“类似X”', () => {
    const p = parseRule('帮团队做会议纪要的AI工具，支持中文');
    expect(p.keywords).toEqual(expect.arrayContaining(['会议纪要', 'ai'])); expect(p.constraints).toEqual(expect.arrayContaining(['chinese', 'team'])); expect(p.mode).toBe('rule');
    const s = parseRule('类似 Notion 的开源笔记'); expect(s.similarTo?.toLowerCase()).toBe('notion'); expect(s.constraints).toContain('opensource'); expect(s.keywords).toContain('笔记');
    expect(parseRule('最近30天上线的免费录屏软件').constraints).toEqual(expect.arrayContaining(['recent', 'free']));
  });
  it('同义词跨中英文扩展，权重低于原词', () => {
    const c = expand('笔记'); const texts = c.alts.map(a => a.text); expect(texts).toEqual(expect.arrayContaining(['note', 'notion'])); expect(c.alts[0]).toMatchObject({ text: '笔记', w: 1, kind: 'exact' });
    expect(c.alts.find(a => a.text === 'note')!.w).toBeLessThan(1);
  });
  it('大模型解析：成功时合并其同义词；失败/超时回退规则解析', async () => {
    const ok = await parseWithLLM('开会记录神器', async () => JSON.stringify({ terms: [{ term: '会议纪要', synonyms: ['otter'] }], constraints: ['free'], similar_to: null }));
    expect(ok.mode).toBe('llm'); expect(ok.constraints).toContain('free'); expect(ok.concepts[0].alts.map(a => a.text)).toContain('otter');
    const bad = await parseWithLLM('录屏工具 x', async () => { throw new Error('401'); }); expect(bad.mode).toBe('rule'); expect(bad.keywords).toContain('录屏');
    const slow = await parseWithLLM('录屏工具 y', () => new Promise(r => setTimeout(() => r('{}'), 500)), 50); expect(slow.mode).toBe('rule');
  });
});

describe('搜索引擎（BM25F + 同义词 + 容错 + 拼音 + 约束 + 解释）', () => {
  let db: DB; const now = Date.parse('2026-10-12T00:00:00Z');
  beforeAll(async () => {
    db = await DB.open(null);
    const P = (name: string, tagline: string, extra: any = {}) => upsertProduct(db, { name, url: `https://${name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'x' + Math.random().toString(36).slice(2, 6)}.com`, tagline, ...extra });
    P('Notion', 'All-in-one workspace for notes and docs', { launch_date: '2020-01-01' });
    P('Fellow', 'AI meeting assistant: transcription, meeting notes and action items for teams', { launch_date: '2026-10-01', tags: ['免费增值'] });
    P('Otter', 'Real-time transcription and meeting notes', { launch_date: '2025-01-01' });
    P('CleanShot', 'Screen recording and screenshots for macOS', { launch_date: '2026-09-30', platforms: ['macOS'] });
    P('OpenCut', 'Open-source video editor, free alternative to CapCut', { launch_date: '2026-10-05', tags: ['开源'] });
    P('豆包', '字节跳动的 AI 助手，支持中文对话与写作', { launch_date: '2026-10-08' });
    P('Paperless', 'Document archive', { description: 'Mentions notion once in passing', launch_date: '2022-02-02' });
    for (let i = 0; i < 30; i++) P('Filler' + i, 'Generic productivity tool number ' + i, { launch_date: '2024-01-01' });
    db.run("UPDATE products SET launch_date='2023-05-05' WHERE COALESCE(launch_date,'')=''");
  });
  const names = (q: string, o: any = {}) => search(db, q, { now, ...o }).hits.map(h => db.get<any>('SELECT name FROM products WHERE guid=?', [h.guid]).name);
  it('名称精确命中排第一，名称加权高于描述', () => { expect(names('notion')[0]).toBe('Notion'); expect(names('notion').indexOf('Paperless')).toBeGreaterThan(0); });
  it('中文需求 → 英文产品（跨语言同义词）', () => { const n = names('会议纪要'); expect(n.slice(0, 2)).toEqual(expect.arrayContaining(['Fellow', 'Otter'])); expect(names('录屏')[0]).toBe('CleanShot'); });
  it('拼写错误、前缀、拼音', () => { expect(names('notoin')[0]).toBe('Notion'); expect(names('cleansh')[0]).toBe('CleanShot'); expect(names('doubao')[0]).toBe('豆包'); });
  it('自然语言整句 + 解释“为什么匹配”与高亮词', () => {
    const r = search(db, '帮团队做会议纪要的AI工具', { now }); const top = r.hits[0];
    expect(db.get<any>('SELECT name FROM products WHERE guid=?', [top.guid]).name).toBe('Fellow');
    expect(top.reasons.join(' ')).toMatch(/会议纪要/); expect(top.reasons).toContain('✓ 面向团队'); expect(top.hl.length).toBeGreaterThan(0);
  });
  it('快捷条件为硬筛选：开源 / 最近30天 / 有免费版 / 中文', () => {
    expect(names('video editor', { chips: ['opensource'] })).toEqual(['OpenCut']);
    expect(names('', { chips: ['recent'] }).sort()).toEqual(['CleanShot', 'Fellow', 'OpenCut', '豆包'].sort());
    expect(names('meeting', { chips: ['free'] })).toEqual(['Fellow']);
    expect(names('ai', { chips: ['chinese'] })).toEqual(['豆包']);
    const d = { row: { tags: '[]', launch_date: '2026-10-01', first_seen: '2026-10-01' }, zh: false } as any; expect(constraintOf(d, 'recent', now)).toBe(true);
  });
  it('结果少时标记 weak（触发联网搜索）；完全无关返回 0', () => { const r = search(db, 'quantum chromodynamics simulator', { now }); expect(r.total).toBe(0); expect(r.weak).toBe(true); });
  it('queryProducts：有关键词走引擎并附带 match，结构化条件仍生效；旧 LIKE 检索保留做基线', () => {
    const r: any = queryProducts(db, { q: '录屏' }); expect(r.items[0].name).toBe('CleanShot'); expect(r.items[0].match.reasons.length).toBeGreaterThan(0); expect(r.search.concepts[0].label).toBe('录屏');
    expect(queryProductsLegacy(db, { q: '录屏' }).total).toBe(0);
    const f: any = queryProducts(db, { q: 'meeting', filter: { type: 'cond', field: 'name', op: 'eq', value: 'Otter' } }); expect(f.items.map((x: any) => x.name)).toEqual(['Otter']);
    const s: any = queryProducts(db, { q: 'meeting', sort: 'name' }); expect(s.items.map((x: any) => x.name)).toEqual(['Fellow', 'Otter']);
  });
  it('索引随数据变更自动失效', () => { expect(names('zyxwvut')).toEqual([]); upsertProduct(db, { name: 'Zyxwvut', url: 'https://zyx.io' }); expect(names('zyxwvut')).toEqual(['Zyxwvut']); });
});
