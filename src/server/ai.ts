import { request, transportName } from './net';
import crypto from 'node:crypto';
import type { DB } from './db';
import { categoryName, CATEGORIES, classify, autoTags } from './taxonomy';
import { safeJson, memoByRev } from './util';
import { useFts, ftsByText } from './search/fts';
import { normalize, isGenericProductName, looksLikeAlternativesList } from './search/text';

export const DIM = 256;
const STOP = new Set('the a an and or of to for in on with your you is are it this that by from at as be we our its their can into all new app tool tools'.split(' '));
export function tokenize(text: string): string[] {
  const t = String(text || '').toLowerCase();
  const words = (t.match(/[a-z0-9][a-z0-9+#.-]*/g) || []).filter(w => w.length > 1 && !STOP.has(w));
  const cjk = (t.match(/[\u4e00-\u9fa5]+/g) || []).flatMap(s => { const o: string[] = []; for (let i = 0; i < s.length - 1; i++) o.push(s.slice(i, i + 2)); if (s.length === 1) o.push(s); return o; });
  return [...words, ...cjk];
}
/** 本地离线向量：特征哈希（词 + 中文二元组），L2 归一化 */
export function localEmbed(text: string): number[] {
  const v = new Float64Array(DIM);
  for (const tok of tokenize(text)) {
    const h = crypto.createHash('md5').update(tok).digest();
    const idx = h.readUInt32LE(0) % DIM; const sign = h[4] & 1 ? 1 : -1; v[idx] += sign;
  }
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return Array.from(v, x => +(x / n).toFixed(4));
}
export function cosine(a: number[], b: number[]) { let s = 0, na = 0, nb = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? s / Math.sqrt(na * nb) : 0; }

export interface AIConfig { apiKey: string; baseUrl: string; model: string; embedModel: string }
export function aiConfig(db?: DB): AIConfig {
  const g = (k: string, env: string, d: string) => (db?.getSetting(k) || process.env[env] || d);
  return { apiKey: g('ai.apiKey', 'OPENAI_API_KEY', ''), baseUrl: g('ai.baseUrl', 'OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, ''), model: g('ai.model', 'OPENAI_MODEL', 'gpt-4o-mini'), embedModel: g('ai.embedModel', 'OPENAI_EMBED_MODEL', '') };
}
export const aiEnabled = (db?: DB) => !!aiConfig(db).apiKey;

export async function chat(db: DB | undefined, system: string, user: string, json = false): Promise<string> {
  const c = aiConfig(db); if (!c.apiKey) throw new Error('NO_AI_KEY');
  const body = JSON.stringify({ model: c.model, temperature: 0.3, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...(json ? { response_format: { type: 'json_object' } } : {}) });
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + c.apiKey };
  // v1.9.1：桌面版走 Chromium 网络栈（跟随代理设置）；独立服务沿用 fetch
  if (transportName() === 'chromium') {
    const r = await request(c.baseUrl + '/chat/completions', { method: 'POST', raw: true, retries: 1, timeoutMs: 60000, intervalMs: 0, headers, body });
    if (r.status >= 400) throw new Error('AI 接口错误 ' + r.status + ': ' + r.text.slice(0, 200));
    const j: any = JSON.parse(r.text); return j.choices?.[0]?.message?.content || '';
  }
  const r = await fetch(c.baseUrl + '/chat/completions', { method: 'POST', headers, body, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error('AI 接口错误 ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j: any = await r.json(); return j.choices?.[0]?.message?.content || '';
}

// ---------- 产品总结 & 多维分析 ----------
export interface Analysis { mode: 'ai' | 'local'; summary: string; dimensions: { key: string; label: string; score: number; comment: string }[]; audience: string[]; features: string[]; business_model: string; competitors: string[]; }
const DIMS = [['innovation', '创新度'], ['market', '市场潜力'], ['maturity', '产品成熟度'], ['traction', '市场热度'], ['moat', '竞争壁垒'], ['monetization', '变现能力']];

export function localAnalysis(p: any, similar: any[] = []): Analysis {
  const text = [p.name, p.tagline, p.description].filter(Boolean).join('。');
  const tags: string[] = Array.isArray(p.tags) ? p.tags : safeJson(p.tags, []);
  const allTags = [...new Set([...tags, ...autoTags(text)])];
  const sentences = String(p.description || p.tagline || '').split(/(?<=[.!?。！？])\s*/).filter(s => s.trim().length > 8);
  const cat = categoryName(p.category || classify(text));
  const summary = `${p.name} 是一款「${cat}」类产品${p.tagline ? '：' + p.tagline.replace(/[。.]$/, '') : ''}。` + (sentences.slice(0, 2).join(' ') || '') + (p.launch_count > 1 ? ` 该产品已在 ${p.launch_count} 个来源/批次发布。` : '');
  const len = (p.description || '').length; const votes = p.votes || 0;
  const s = (x: number) => Math.max(1, Math.min(10, Math.round(x)));
  const scoreMap: Record<string, [number, string]> = {
    innovation: [s(4 + (allTags.includes('大语言模型') ? 2 : 0) + (allTags.includes('开源') ? 1 : 0) + (len > 200 ? 1 : 0)), allTags.includes('大语言模型') ? '结合大模型能力，具备一定新意' : '基于常规方案，创新点需进一步验证'],
    market: [s(5 + (['ai', 'productivity', 'dev', 'marketing'].some(k => (p.category || '').startsWith(k)) ? 2 : 0)), `所属「${cat}」赛道${['AI 人工智能', '效率工具', '开发者工具'].includes(cat) ? '需求旺盛、竞争激烈' : '相对细分'}`],
    maturity: [s(3 + (p.pricing ? 2 : 0) + (len > 150 ? 2 : 0) + (allTags.includes('Beta') || allTags.includes('预发布') ? -2 : 1)), allTags.includes('Beta') || allTags.includes('预发布') ? '处于早期/测试阶段' : '信息较完整，产品形态清晰'],
    traction: [s(2 + Math.log10(votes + 1) * 2.5 + (p.launch_count || 1)), votes ? `累计获得约 ${votes} 票/点赞` : '暂无公开热度数据'],
    moat: [s(4 + (allTags.includes('开源') ? 1 : 0) + (allTags.includes('API') ? 1 : 0)), similar.length >= 3 ? `库内至少有 ${similar.length} 款相似产品，差异化需加强` : '同类产品较少'],
    monetization: [s(3 + (allTags.some(t => ['订阅制', '付费', '免费增值', '一次性买断'].includes(t)) ? 4 : 0)), allTags.find(t => ['订阅制', '付费', '免费增值', '一次性买断', '免费', '开源'].includes(t)) || '未明确商业模式'],
  };
  return {
    mode: 'local', summary,
    dimensions: DIMS.map(([key, label]) => ({ key, label, score: scoreMap[key][0], comment: scoreMap[key][1] })),
    audience: allTags.filter(t => ['开发者', '设计师', '营销人员', '创业者', '学生', '企业', '个人用户', '创作者'].includes(t)).concat(allTags.some(t => ['开发者', '设计师', '营销人员', '创业者', '学生', '企业', '创作者'].includes(t)) ? [] : ['个人用户']),
    features: sentences.slice(0, 4).map(x => x.trim().slice(0, 120)),
    business_model: allTags.find(t => ['订阅制', '付费', '免费增值', '一次性买断', '免费', '开源'].includes(t)) || '未知',
    competitors: similar.slice(0, 5).map(x => x.name),
  };
}

export async function analyzeProduct(db: DB, p: any, similar: any[] = []): Promise<Analysis> {
  if (!aiEnabled(db)) return localAnalysis(p, similar);
  try {
    const sys = '你是资深产品分析师。只输出 JSON，中文。';
    const user = `请分析以下产品，输出 JSON：{"summary":"100-200字中文总结","dimensions":[{"key":"innovation|market|maturity|traction|moat|monetization","label":"中文名","score":1-10,"comment":"一句话"}],"audience":["目标用户"],"features":["核心功能"],"business_model":"商业模式","competitors":["竞品名"]}\n维度固定为：${DIMS.map(d => d[1]).join('、')}。\n产品：${JSON.stringify({ name: p.name, url: p.url, tagline: p.tagline, description: p.description, category: categoryName(p.category), tags: p.tags, pricing: p.pricing, votes: p.votes, launch_count: p.launch_count })}\n库内相似产品：${similar.slice(0, 5).map(s => s.name).join('、')}`;
    const j = JSON.parse(await chat(db, sys, user, true));
    return { mode: 'ai', summary: j.summary, dimensions: (j.dimensions || []).map((d: any, i: number) => ({ key: d.key || DIMS[i]?.[0], label: d.label || DIMS[i]?.[1], score: Number(d.score) || 5, comment: d.comment || '' })), audience: j.audience || [], features: j.features || [], business_model: j.business_model || '', competitors: j.competitors || [] };
  } catch (e) { const a = localAnalysis(p, similar); (a as any).error = String((e as Error).message); return a; }
}

// ---------- 相似产品 ----------
/** 向量存储：JSON 数组或 v1.5 的紧凑格式 q8:<base64 Int8>（大数据量下体积约 1/7） */
export function parseVec(raw: string | null | undefined): number[] {
  if (!raw) return []; if (raw.startsWith('q8:')) { const b = Buffer.from(raw.slice(3), 'base64'); const out = new Array(b.length); for (let i = 0; i < b.length; i++) out[i] = (b[i] > 127 ? b[i] - 256 : b[i]) / 127; return out; }
  return safeJson<number[]>(raw, []);
}
export function packVec(v: number[]): string { const b = Buffer.alloc(v.length); v.forEach((x, i) => b.writeInt8(Math.max(-127, Math.min(127, Math.round(x * 127))), i)); return 'q8:' + b.toString('base64'); }
const vecCache = new WeakMap<DB, Map<string, [string, number[]]>>();
function vecOf(db: DB, guid: string, raw: string): number[] {
  let m = vecCache.get(db); if (!m) { m = new Map(); vecCache.set(db, m); }
  const c = m.get(guid); if (c && c[0] === raw) return c[1];
  const v = parseVec(raw); m.set(guid, [raw, v]); return v;
}
const _simResultCache = new Map<string, { t: number; rev: number; v: any[] }>();
export function findSimilar(db: DB, opts: { guid?: string; text?: string; limit?: number }) {
  const lim0 = opts.limit || 10;
  const cacheKey = (opts.guid ? 'g:' + opts.guid : 't:' + (opts.text || '').slice(0, 120)) + ':' + lim0;
  const hit = _simResultCache.get(cacheKey);
  if (hit && hit.rev === db.rev && Date.now() - hit.t < 60_000) return hit.v;

  let qv: number[]; let base: any = null;
  if (opts.guid) { base = db.get<any>('SELECT * FROM products WHERE guid=?', [opts.guid]); if (!base) return []; qv = parseVec(base.embedding); if (!qv.length) qv = localEmbed([base.name, base.tagline, base.description].join(' ')); }
  else qv = localEmbed(opts.text || '');
  const baseTags = new Set<string>(base ? safeJson(base.tags, []) : []);
  const qCat = base?.category || (opts.text ? classify(opts.text) : null);
  const baseNameToks = new Set(tokenize([base?.name, base?.tagline].filter(Boolean).join(' ')).filter(t => t.length > 2));
  // alt_rel：明确「替代 base.name」的产品强加权
  const altBoost = new Map<string, number>();
  if (base?.name) {
    try {
      const sn = normalize(base.name).trim();
      for (const r of db.all<any>('SELECT product_guid g FROM alt_rel WHERE target = ?', [sn])) altBoost.set(r.g, 0.95);
    } catch { /* 旧库 */ }
  }
  const seedText = base ? [base.name, base.tagline, (base.description || '').slice(0, 300)].join(' ') : (opts.text || '');
  let rowids = useFts(db) ? ftsByText(db, seedText, 900) : undefined;
  // 确保 alt_rel 产品进入候选集
  if (rowids && altBoost.size) {
    const ids = [...altBoost.keys()];
    for (let i = 0; i < ids.length; i += 500) {
      const ch = ids.slice(i, i + 500);
      for (const r of db.all<any>(`SELECT rowid r FROM products WHERE guid IN (${ch.map(() => '?').join(',')})`, ch)) rowids.push(r.r);
    }
    rowids = [...new Set(rowids)];
  }
  const M = (rowids && rowids.length) ? simMatrix(db, rowids) : simMatrix(db);
  const top: { i: number; score: number }[] = []; const lim = opts.limit || 10;
  let qNorm = 0; for (let k = 0; k < qv.length; k++) qNorm += qv[k] * qv[k];
  for (let i = 0; i < M.guids.length; i++) {
    if (M.guids[i] === opts.guid) continue;
    const name = M.names[i];
    if (isGenericProductName(name)) continue;
    if (looksLikeAlternativesList(M.taglines[i] || '', '')) continue;
    const v = M.vecs[i]; let dot = 0, n2 = 0; const L = Math.min(v.length, qv.length);
    for (let k = 0; k < L; k++) { dot += v[k] * qv[k]; n2 += v[k] * v[k]; }
    const sim = n2 && qNorm ? dot / Math.sqrt(n2 * qNorm) : 0; const tags = M.tags[i];
    const tagOverlap = baseTags.size ? tags.filter(t => baseTags.has(t)).length / Math.max(baseTags.size, 1) : 0;
    const nameToks = tokenize([name, M.taglines[i]].filter(Boolean).join(' '));
    const nameOv = baseNameToks.size ? nameToks.filter(t => baseNameToks.has(t)).length / Math.max(baseNameToks.size, 1) : 0;
    const broadCat = qCat === 'ai' || qCat === 'other' || qCat === 'productivity';
    const catHit = qCat && M.cats[i] === qCat && qCat !== 'other' ? (broadCat ? 0.1 : 0.22) : 0;
    const alt = altBoost.get(M.guids[i]) || 0;
    const score = sim * 0.5 + catHit + tagOverlap * 0.12 + nameOv * 0.2 + alt * 0.45;
    // 有明确 alt_rel 时，纯向量噪声需额外信号才进入榜单
    if (!alt && altBoost.size >= 3 && nameOv < 0.08 && tagOverlap < 0.08 && sim < 0.35) continue;
    if (score <= 0.08 && !alt) continue;
    if (top.length < lim) { top.push({ i, score }); top.sort((x, y) => y.score - x.score); }
    else if (score > top[lim - 1].score) { top[lim - 1] = { i, score }; top.sort((x, y) => y.score - x.score); }
  }
  if (!top.length) return [];
  const guids = top.map(t => M.guids[t.i]);
  const scoreBy = new Map(top.map(t => [M.guids[t.i], t.score]));
  const rows = db.all<any>(`SELECT guid,name,tagline,url,domain,category,tags,logo_local,logo_url,votes,launch_count FROM products WHERE guid IN (${guids.map(() => '?').join(',')})`, guids);
  const by = new Map(rows.map((r: any) => [r.guid, r]));
  const out = guids.map(g => { const r = by.get(g); if (!r) return null; return { ...r, tags: safeJson(r.tags, []), score: +(scoreBy.get(g) || 0).toFixed(4) }; }).filter(Boolean);
  _simResultCache.set(cacheKey, { t: Date.now(), rev: db.rev, v: out as any[] });
  if (_simResultCache.size > 200) { const first = _simResultCache.keys().next().value; if (first != null) _simResultCache.delete(first); }
  return out;
}
type SimM = { rev: number; guids: string[]; cats: string[]; tags: string[][]; names: string[]; taglines: string[]; vecs: Float32Array[] };
const simCache = new WeakMap<DB, SimM>();
function simMatrix(db: DB, rowids?: number[]): SimM {
  const c = !rowids && simCache.get(db); if (c && c.rev === db.rev) return c;
  const m: SimM = { rev: db.rev, guids: [], cats: [], tags: [], names: [], taglines: [], vecs: [] };
  const SEL = 'SELECT guid,category,tags,embedding,name,tagline FROM products';
  const src: any[] = rowids ? [] : db.all<any>(SEL);
  if (rowids) for (let i = 0; i < rowids.length; i += 500) { const ch = rowids.slice(i, i + 500); src.push(...db.all<any>(`${SEL} WHERE rowid IN (${ch.map(() => '?').join(',')})`, ch)); }
  for (const r of src) {
    m.guids.push(r.guid); m.cats.push(r.category); m.tags.push(safeJson(r.tags, [])); m.names.push(r.name || ''); m.taglines.push(r.tagline || '');
    let v = vecOf(db, r.guid, r.embedding); if (!v.length) v = localEmbed([r.name, r.tagline].filter(Boolean).join(' ')); m.vecs.push(Float32Array.from(v));
  }
  if (!rowids) { vecCache.delete(db); simCache.set(db, m); } return m;
}

/** AI 面板：自然语言问答（检索增强） */
export async function askAI(db: DB, question: string, contextGuid?: string) {
  const hits = findSimilar(db, contextGuid ? { guid: contextGuid, limit: 8 } : { text: question, limit: 8 });
  if (!aiEnabled(db)) {
    return { mode: 'local', answer: hits.length ? `（离线模式）根据关键词语义匹配，为你找到 ${hits.length} 款相关产品，相似度最高的是「${hits[0].name}」。配置 AI Key 后可获得更智能的解答。` : '（离线模式）未找到相关产品，试试换个描述。', products: hits };
  }
  try {
    const ctx = hits.map((h, i) => `${i + 1}. ${h.name} - ${h.tagline || ''} [${categoryName(h.category)}]`).join('\n');
    const answer = await chat(db, '你是产品库助手，基于提供的产品列表用中文简洁回答，可推荐产品并说明理由。', `问题：${question}\n候选产品：\n${ctx}`);
    return { mode: 'ai', answer, products: hits };
  } catch (e) { return { mode: 'local', answer: 'AI 调用失败，已回退本地检索：' + (e as Error).message, products: hits }; }
}

/** 侧栏轻量统计：分类计数 + 热度标签近似，避免全表扫 tags / 重 JOIN */
export function navAnalytics(db: DB) {
  return memoByRev(db, 'navAnalytics', () => {
    const byCat = db.all<any>('SELECT category, COUNT(*) n FROM products GROUP BY category ORDER BY n DESC').map(r => ({ ...r, name: categoryName(r.category) }));
    const products = db.get<any>('SELECT COUNT(*) n FROM products')?.n || 0;
    const multi_launch = db.get<any>('SELECT COUNT(*) n FROM products WHERE launch_count>1')?.n || 0;
    // summarized 全表扫昂贵，侧栏不需要精确值；分析页 libraryAnalytics 再算
    const totals = { products, multi_launch, summarized: undefined as number | undefined };
    const tagCount = new Map<string, number>();
    for (const r of db.all<any>('SELECT tags FROM products WHERE votes >= 50 ORDER BY votes DESC LIMIT 20000'))
      for (const t of safeJson<string[]>(r.tags, [])) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, n]) => ({ name, n }));
    return { totals, byCat, tags };
  });
}
/** 全库多维统计分析（按 db.rev 缓存；标签全表扫只在版本变更后算一次） */
export function libraryAnalytics(db: DB) {
  return memoByRev(db, 'libraryAnalytics', () => {
    const byCat = db.all<any>('SELECT category, COUNT(*) n FROM products GROUP BY category ORDER BY n DESC').map(r => ({ ...r, name: categoryName(r.category) }));
    // 来源贡献：同时给出收录数 n、独有数 uniq（只被该来源收录）；因多数来源每次抓取上限 30 条，n 无区分度（v2 #32），
    // 改为按「与其他来源重复的产品数」排序——直接回答“哪些来源高度重叠、可以精简”，并返回达上限的来源数 capped
    let bySource: any[] = [];
    let srcStats: any = { total: 0, capped: 0 };
    try {
      // 轻量：按 sources.product_count 排序（抓取维护），避免对 product_versions 双重聚合
      const nv = db.get<any>('SELECT COUNT(*) c FROM product_versions')?.c || 0;
      if (nv <= 200_000) { // 小库：精确统计 n/uniq（同 1.8.2）；大库走下面的轻量路径
        bySource = db.all<any>(`SELECT s.guid, s.name, COUNT(DISTINCT v.product_guid) n, COUNT(DISTINCT CASE WHEN u.c=1 THEN v.product_guid END) uniq, COUNT(*) versions FROM product_versions v JOIN sources s ON s.guid=v.source_guid JOIN (SELECT product_guid, COUNT(DISTINCT source_guid) c FROM product_versions GROUP BY product_guid) u ON u.product_guid=v.product_guid GROUP BY s.guid ORDER BY (COUNT(DISTINCT v.product_guid) - COUNT(DISTINCT CASE WHEN u.c=1 THEN v.product_guid END)) DESC, n DESC, s.name LIMIT 15`);
        srcStats = db.get<any>(`SELECT COUNT(*) total, SUM(CASE WHEN n>=30 THEN 1 ELSE 0 END) capped FROM (SELECT COUNT(DISTINCT product_guid) n FROM product_versions WHERE source_guid IS NOT NULL GROUP BY source_guid)`) || srcStats;
      } else {
        bySource = db.all<any>(`SELECT guid, name, product_count n, 0 uniq, 0 versions FROM sources WHERE product_count > 0 ORDER BY product_count DESC, name LIMIT 15`);
        srcStats = db.get<any>(`SELECT COUNT(*) total, SUM(CASE WHEN product_count>=30 THEN 1 ELSE 0 END) capped FROM sources WHERE product_count > 0`) || srcStats;
      }
    } catch { /* */ }
    const byMonth = db.all<any>(`SELECT substr(launch_date,1,7) month, COUNT(*) n FROM products WHERE launch_date IS NOT NULL AND launch_date <> '' GROUP BY month ORDER BY month DESC LIMIT 12`).reverse();
    const tagCount = new Map<string, number>();
    // 全表扫 tags 在 140 万行上可达十余秒；分析页首次改为高票抽样 + 近期抽样
    for (const r of db.all<any>('SELECT tags FROM products WHERE votes >= 50 ORDER BY votes DESC LIMIT 20000'))
      for (const t of safeJson<string[]>(r.tags, [])) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    if (tagCount.size < 80) {
      for (const r of db.all<any>('SELECT tags FROM products ORDER BY updated_at DESC LIMIT 30000'))
        for (const t of safeJson<string[]>(r.tags, [])) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    }
    const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, n]) => ({ name, n }));
    const productsN = db.get<any>('SELECT COUNT(*) n FROM products')?.n || 0;
    const versionsN = db.get<any>('SELECT COUNT(*) n FROM product_versions')?.n || 0;
    const sourcesN = db.get<any>('SELECT COUNT(*) n FROM sources')?.n || 0;
    const sourcesOk = db.get<any>("SELECT COUNT(*) n FROM sources WHERE last_status='ok'")?.n || 0;
    const multiLaunch = db.get<any>('SELECT COUNT(*) n FROM products WHERE launch_count>1')?.n || 0;
    // ai_summary IS NOT NULL 全表扫可达数秒；分析页用抽样估计
    const sample = db.all<any>('SELECT ai_summary s FROM products WHERE votes>=1 ORDER BY votes DESC LIMIT 5000');
    const hit = sample.filter((r: any) => r.s).length;
    const summarizedEst = sample.length ? Math.round(hit / sample.length * productsN) : 0;
    const totals = { products: productsN, versions: versionsN, sources: sourcesN, sources_ok: sourcesOk, multi_launch: multiLaunch, summarized: summarizedEst };
    const top = db.all<any>('SELECT guid,name,votes,launch_count,category FROM products ORDER BY launch_count DESC, votes DESC LIMIT 10');
    return { totals, byCat, bySource, srcStats, byMonth, tags, top, categories: CATEGORIES.map(c => ({ id: c.id, name: c.name })) };
  });
}
