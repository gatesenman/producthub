import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DB, now } from './db';
import { queryProducts, FIELDS, OPS } from './filter';
import { getProduct, upsertProduct, updateProduct, deleteProduct, mergeProducts, findDuplicateCandidates, hydrate } from './products';
import { analyzeProduct, findSimilar, askAI, libraryAnalytics, navAnalytics, aiEnabled, aiConfig } from './ai';
import { listSources, upsertSource, updateSource, deleteSource, importSourcesCsv } from './sources';
import { crawlSource, generateRule, runRule, Fetcher } from './crawler';
import { exportProducts, importProducts } from './importexport';
import { CATEGORIES, TAG_GROUPS } from './taxonomy';
import { Scheduler } from './scheduler';
import { MIME } from './images';
import { sourceGuid, normalizeUrl, memoByRev } from './util';
import { homeData, buildReport } from './home';

export interface ServerOptions { db: DB; dataDir: string; uiDir?: string; readOnly?: boolean; fetcher?: Fetcher; scheduler?: boolean; noWarm?: boolean }
export { VERSION } from './version';
import { VERSION } from './version';
import { parseRule, parseWithLLM, type Parsed } from './search/nlq';
import { webSearch, ingestWebItems } from './websearch';
import { EnrichQueue } from './enrich';
import { compareProducts, compareExport } from './compare';
import { chat } from './ai';
import { buildIndex } from './search/engine';
import { useFts } from './search/fts';
import { deltaStatus, resolveDeltaUrl, checkDelta, DeltaError } from './delta';
import { DeltaJobs } from './delta-job';
import { configureNet, getNetConfig, normalizeNet, parseProxyUrl, testConnectivity, transportName, failLabel, FAIL_LABEL, DEFAULT_UA } from './net';
import { ensureSourceSettings, effectiveSettings, saveSettings, resetSettings, publicSettings, savedSettings, METHODS, METHOD_LABEL } from './source-settings';
import { closeStaleRuns } from './crawl-pipeline';
import { browserHost, browserAvailable, partitionFor, SHARED_PARTITION } from './browser';
import { builtinNote } from './browser-rules';

/** 从本地库读取网络设置并生效 */
export function loadNetSettings(db: DB) { const j = (() => { try { return JSON.parse(db.getSetting('net.config', '{}')); } catch { return {}; } })(); configureNet(normalizeNet(j)); }

export function createApp(o: ServerOptions) {
  const { db } = o; const imageDir = path.join(o.dataDir, 'images');
  ensureSourceSettings(db); loadNetSettings(db); if (!o.readOnly) closeStaleRuns(db);
  const scheduler = new Scheduler(db, imageDir); if (o.scheduler && !o.readOnly) scheduler.start();
  type H = (req: http.IncomingMessage, m: RegExpMatchArray, url: URL, body: () => Promise<Buffer>) => Promise<any> | any;
  const routes: [string, RegExp, H, boolean?][] = [];
  const r = (method: string, p: string, h: H, safeInReadOnly = false) => routes.push([method, new RegExp('^' + p.replace(/:(\w+)/g, '([^/]+)') + '$'), h, safeInReadOnly]);
  const json = async (b: () => Promise<Buffer>) => { const t = (await b()).toString(); return t ? JSON.parse(t) : {}; };

  r('GET', '/api/meta', () => ({ version: VERSION, readOnly: !!o.readOnly, aiEnabled: aiEnabled(db), aiModel: aiConfig(db).model, categories: CATEGORIES.map(({ keywords, ...c }) => c), tagGroups: TAG_GROUPS, fields: FIELDS, ops: OPS }));
  r('GET', '/api/facets', () => memoByRev(db, 'facets', () => ({ regions: [...new Set(db.all<any>("SELECT region FROM sources WHERE region IS NOT NULL AND region<>''").flatMap(r => String(r.region).split(/[\/、,，]/).map((x: string) => x.trim()).filter(Boolean)))].sort(), sources: db.all('SELECT guid, name, COALESCE(product_count,0) product_count FROM sources ORDER BY product_count DESC, name') })));
  r('GET', '/api/status', () => ({ ...memoByRev(db, 'statusCounts', () => db.get<any>("SELECT (SELECT COUNT(*) FROM products) products, (SELECT COUNT(*) FROM sources) sources, (SELECT COUNT(*) FROM sources WHERE enabled=1) enabled, (SELECT MAX(finished_at) FROM crawl_runs) last_sync, (SELECT COUNT(*) FROM sources WHERE enabled=1 AND last_status='error') errors, (SELECT COUNT(*) FROM favorites) favorites")), scheduler: scheduler.status(), aiEnabled: aiEnabled(db) }));
  r('PUT', '/api/favorites/:guid', (_q, m) => { db.run('INSERT OR IGNORE INTO favorites(product_guid,created_at) VALUES(?,?)', [m[1], now()]); return { favorite: true }; });
  r('DELETE', '/api/favorites/:guid', (_q, m) => { db.run('DELETE FROM favorites WHERE product_guid=?', [m[1]]); return { favorite: false }; });
  r('GET', '/api/home', () => homeData(db));
  r('GET', '/api/report', (_q, _m, u) => { const f = u.searchParams.get('format') === 'md' ? 'md' : 'html'; const body = buildReport(db, f, u.searchParams.get('category') || undefined); return { __raw: body, mime: f === 'md' ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8', filename: `产品库报告-${new Date().toISOString().slice(0, 10)}.${f}` }; });
  r('GET', '/api/products', (_q, _m, u) => queryProducts(db, { q: u.searchParams.get('q') || undefined, category: u.searchParams.get('category') || undefined, sort: u.searchParams.get('sort') || undefined, page: +(u.searchParams.get('page') || 1), pageSize: +(u.searchParams.get('pageSize') || 50), filter: u.searchParams.get('filter') ? JSON.parse(u.searchParams.get('filter')!) : null }));
  const parseQ = async (q: string, useAI = true): Promise<Parsed> => (useAI && aiEnabled(db) ? parseWithLLM(q, (sys, u) => chat(db, sys, u, true)) : parseRule(q));
  r('POST', '/api/products/query', async (_q, _m, _u, b) => { const body = await json(b); if (body.q && String(body.q).trim() && !body.parsed) body.parsed = await parseQ(String(body.q), body.ai !== false); return queryProducts(db, body); }, true);
  // v1.4 联网搜索
  const webTerms = (p: Parsed) => { const zh = p.keywords.join(' ') || p.raw; const en = p.concepts.map(c => c.alts.find(a => /^[\x20-\x7e]+$/.test(a.text) && a.text.length > 1)?.text).filter(Boolean).join(' '); return { zh, en: en || zh, terms: p.concepts.flatMap(c => c.alts.map(a => a.text)) }; };
  r('POST', '/api/websearch', async (_q, _m, _u, b) => { const body = await json(b); const q = String(body.q || '').trim(); if (!q) return err(400, '请输入搜索内容'); const p = await parseQ(q, body.ai !== false); const w = webTerms(p); return webSearch(db, q, { webQuery: w.zh, enQuery: w.en, terms: w.terms, fetcher: o.fetcher, providers: body.providers }); }, true);
  r('POST', '/api/websearch/ingest', async (_q, _m, _u, b) => { const body = await json(b); const items = Array.isArray(body.items) ? body.items.slice(0, 50) : []; if (!items.length) return err(400, '没有要入库的结果'); const res = ingestWebItems(db, items); if (body.enrich !== false) enrichQ.add(res.map(x => x.guid)); return { items: res }; });
  // v1.4 自动补齐
  const enrichQ = new EnrichQueue(db, o.fetcher);
  r('POST', '/api/enrich', async (_q, _m, _u, b) => { const body = await json(b); const g = (Array.isArray(body.guids) ? body.guids : []).filter((x: any) => typeof x === 'string').slice(0, 500); if (!g.length) return err(400, '请选择要补齐的产品'); return enrichQ.add(g); });
  r('GET', '/api/enrich/status', () => ({ ...enrichQ.status(), ...memoByRev(db, 'enrichCounts', () => db.get<any>("SELECT SUM(enrich_status='ok') enriched, SUM(enrich_status LIKE 'error%') errors, COUNT(*) products FROM products") || { enriched: 0, errors: 0, products: 0 }) }), true);
  // v1.4 对比
  const guidsOf = (u: URL) => (u.searchParams.get('guids') || '').split(',').map(s => s.trim()).filter(Boolean);
  r('GET', '/api/compare', (_q, _m, u) => { try { return compareProducts(db, guidsOf(u)); } catch (e: any) { return err(400, e.message); } }, true);
  r('GET', '/api/compare/export', (_q, _m, u) => { try { const f = u.searchParams.get('format') === 'md' ? 'md' : 'xlsx'; const out = compareExport(db, guidsOf(u), f); return { __raw: out.body, mime: out.mime, filename: `产品对比-${new Date().toISOString().slice(0, 10)}.${out.ext}` }; } catch (e: any) { return err(400, e.message); } }, true);
  r('GET', '/api/products/:guid', (_q, m) => getProduct(db, m[1]) || err(404, '产品不存在'));
  r('POST', '/api/products', async (_q, _m, _u, b) => { const p = await json(b); const res = upsertProduct(db, p, { origin: 'manual', versionLabel: p.version_label || '手动添加' }); if (p.notes || p.category) updateProduct(db, res.guid, { ...(p.category ? { category: p.category } : {}), ...(p.notes ? { notes: p.notes } : {}) }); return { ...res, product: getProduct(db, res.guid) }; });
  r('PATCH', '/api/products/:guid', async (_q, m, _u, b) => updateProduct(db, m[1], await json(b)));
  // 批量操作：关注/取消关注/加标签/移除标签/删除（列表多选）
  r('POST', '/api/products/batch', async (_q, _m, _u, b) => {
    const { guids, action, tag } = await json(b); if (!Array.isArray(guids) || !guids.length) return err(400, '未选择产品'); if (guids.length > 5000) return err(400, '一次最多 5000 个');
    if (!['favorite', 'unfavorite', 'tag', 'untag', 'delete'].includes(action)) return err(400, '未知操作'); if ((action === 'tag' || action === 'untag') && !tag) return err(400, '缺少标签');
    let n = 0; db.tx(() => { for (const g of guids) { const p = getProduct(db, String(g)); if (!p) continue; n++;
      if (action === 'favorite') db.run('INSERT OR IGNORE INTO favorites(product_guid,created_at) VALUES(?,?)', [g, now()]);
      else if (action === 'unfavorite') db.run('DELETE FROM favorites WHERE product_guid=?', [g]);
      else if (action === 'tag' || action === 'untag') { const tags: string[] = p.tags || []; const next = action === 'tag' ? [...new Set([...tags, tag])] : tags.filter(t => t !== tag); db.run('UPDATE products SET tags=? WHERE guid=?', [JSON.stringify(next), g]); }
      else if (action === 'delete') { db.run('DELETE FROM favorites WHERE product_guid=?', [g]); db.run('DELETE FROM product_versions WHERE product_guid=?', [g]); db.run('DELETE FROM products WHERE guid=?', [g]); } } });
    return { ok: true, count: n };
  });
  r('DELETE', '/api/products/:guid', (_q, m) => { deleteProduct(db, m[1]); return { ok: true }; });
  r('POST', '/api/products/:guid/analyze', async (_q, m) => {
    const p = getProduct(db, m[1]); if (!p) return err(404, '产品不存在');
    const a = await analyzeProduct(db, p, findSimilar(db, { guid: m[1], limit: 5 }));
    db.run('UPDATE products SET ai_summary=?, ai_analysis=?, updated_at=? WHERE guid=?', [a.summary, JSON.stringify(a), now(), m[1]]); return getProduct(db, m[1]);
  });
  r('POST', '/api/analyze-batch', async (_q, _m, _u, b) => { const { limit = 20 } = await json(b); const rows = db.all<any>('SELECT guid FROM products WHERE ai_summary IS NULL LIMIT ?', [limit]); for (const x of rows) { const p = getProduct(db, x.guid); const a = await analyzeProduct(db, p, findSimilar(db, { guid: x.guid, limit: 5 })); db.run('UPDATE products SET ai_summary=?, ai_analysis=? WHERE guid=?', [a.summary, JSON.stringify(a), x.guid]); } return { analyzed: rows.length }; });
  r('GET', '/api/products/:guid/similar', (_q, m, u) => findSimilar(db, { guid: m[1], limit: +(u.searchParams.get('limit') || 10) }));
  r('POST', '/api/ai/ask', async (_q, _m, _u, b) => { const { question, guid } = await json(b); return askAI(db, String(question || ''), guid); }, true);
  r('POST', '/api/ai/similar-text', async (_q, _m, _u, b) => findSimilar(db, { text: (await json(b)).text, limit: 12 }), true);
  r('GET', '/api/duplicates', () => findDuplicateCandidates(db).map(g => g.map((x: any) => hydrate(db.get('SELECT * FROM products WHERE guid=?', [x.guid])))));
  r('POST', '/api/products/merge', async (_q, _m, _u, b) => { const { into, from } = await json(b); return mergeProducts(db, into, from); });
  r('GET', '/api/nav-stats', () => navAnalytics(db), true);
  r('GET', '/api/analytics', () => libraryAnalytics(db), true);
  r('GET', '/api/sources', () => listSources(db));
  r('POST', '/api/sources', async (_q, _m, _u, b) => { const s = await json(b); upsertSource(db, s); return db.get('SELECT * FROM sources WHERE guid=?', [sourceGuid(normalizeUrl(s.url)!)]); });
  r('POST', '/api/sources/import', async (_q, _m, _u, b) => importSourcesCsv(db, (await b()).toString()));
  r('PATCH', '/api/sources/:guid', async (_q, m, _u, b) => updateSource(db, m[1], await json(b)));
  r('DELETE', '/api/sources/:guid', (_q, m) => { deleteSource(db, m[1]); return { ok: true }; });
  r('POST', '/api/sources/:guid/crawl', async (_q, m) => { if (scheduler.running && scheduler.job && !scheduler.job.finishedAt) return err(409, '批量抓取进行中，请稍后'); const res = await crawlSource(db, m[1], { fetcher: o.fetcher, imageDir }); db.saveNow(); return res; });
  r('GET', '/api/sources/:guid/runs', (_q, m) => db.all('SELECT * FROM crawl_runs WHERE source_guid=? ORDER BY id DESC LIMIT 30', [m[1]]));
  r('POST', '/api/rules/generate', async (_q, _m, _u, b) => { const { url, hint } = await json(b); return generateRule(db, url, hint || '', o.fetcher); });
  r('POST', '/api/rules/test', async (_q, _m, _u, b) => { const { rule, url } = await json(b); const res = await runRule({ ...rule, followDetail: false }, url, o.fetcher); return { count: res.items.length, items: res.items.slice(0, 20), rule: res.rule }; });
  r('GET', '/api/crawl/runs', () => db.all('SELECT c.*, s.name source_name FROM crawl_runs c LEFT JOIN sources s ON s.guid=c.source_guid ORDER BY c.id DESC LIMIT 100'));
  // —— v1.9.1 网络与代理 ——
  r('GET', '/api/net', () => ({ config: getNetConfig(), defaultUserAgent: DEFAULT_UA, transport: transportName(), browser: browserAvailable(), failKinds: FAIL_LABEL, methods: METHODS.map(m => ({ value: m, label: METHOD_LABEL[m] })) }));
  r('POST', '/api/net', async (_q, _m, _u, b) => { const body = await json(b); const c = normalizeNet({ ...getNetConfig(), ...body });
    if (c.proxyMode === 'manual') { const p = parseProxyUrl(c.proxyUrl); if (!p.ok) return err(400, p.error); c.proxyUrl = p.url; }
    db.setSetting('net.config', JSON.stringify(c)); configureNet(c); return { ok: true, config: getNetConfig() }; });
  r('POST', '/api/net/test', async (_q, _m, _u, b) => { const body = await json(b); const prev = getNetConfig();
    if (body.config) { const c = normalizeNet({ ...prev, ...body.config }); if (c.proxyMode === 'manual') { const p = parseProxyUrl(c.proxyUrl); if (!p.ok) return err(400, p.error); c.proxyUrl = p.url; } configureNet(c); }
    try { const urls = Array.isArray(body.urls) && body.urls.length ? body.urls.slice(0, 10) : ['https://www.baidu.com/', 'https://github.com/', 'https://www.producthunt.com/', 'https://www.reddit.com/', 'https://web.archive.org/']; return await testConnectivity(urls); }
    finally { if (body.config) configureNet(prev); } });
  // —— v1.9.1 每源设置 / 单源测试 / 只重试失败 / 批量 ——
  r('GET', '/api/sources/:guid/settings', (_q, m) => { const src = db.get<any>('SELECT * FROM sources WHERE guid=?', [m[1]]); if (!src) return err(404, '来源不存在'); const ss = db.get<any>('SELECT * FROM source_settings WHERE guid=?', [m[1]]) || {};
    return { settings: publicSettings(effectiveSettings(db, src)), custom: Object.keys(savedSettings(db, m[1])), note: builtinNote(src.url), stats: { ok: ss.ok_count || 0, fail: ss.fail_count || 0, consecutive_fail: ss.consecutive_fail || 0, last_kind: ss.last_kind, last_label: ss.last_kind ? failLabel(ss.last_kind) : null, last_method: ss.last_method, last_message: ss.last_message, last_ms: ss.last_ms }, source: { guid: src.guid, name: src.name, url: src.url, enabled: src.enabled, interval_min: src.interval_min, last_status: src.last_status, last_error: src.last_error, last_crawl_at: src.last_crawl_at }, partition: partitionFor(effectiveSettings(db, src).session, src.guid) }; });
  r('PUT', '/api/sources/:guid/settings', async (_q, m, _u, b) => { const body = await json(b); if (!db.get('SELECT 1 FROM sources WHERE guid=?', [m[1]])) return err(404, '来源不存在');
    if ('enabled' in body || 'interval_min' in body) updateSource(db, m[1], { ...('enabled' in body ? { enabled: body.enabled ? 1 : 0 } : {}), ...('interval_min' in body ? { interval_min: Math.max(0, +body.interval_min || 0) } : {}) });
    return publicSettings(saveSettings(db, m[1], body.settings || {})); });
  r('DELETE', '/api/sources/:guid/settings', (_q, m) => { resetSettings(db, m[1]); return { ok: true }; });
  r('POST', '/api/sources/:guid/test', async (_q, m, _u, b) => { const body = await json(b); const lines: string[] = []; const res: any = await crawlSource(db, m[1], { fetcher: o.fetcher, dryRun: true, method: body.method && METHODS.includes(body.method) ? body.method : undefined, maxItems: 20, log: (x: string) => { if (lines.length < 80) lines.push(String(x).slice(0, 300)); } } as any); return { ...res, log: lines }; });
  r('POST', '/api/sources/retry-failed', async (_q, _m, _u, b) => { const body = await json(b); const kinds: string[] = Array.isArray(body.kinds) ? body.kinds : [];
    const rows = listSources(db).filter((x: any) => x.enabled && x.last_status === 'error' && (!kinds.length || kinds.includes(x.fail_kind)));
    if (!rows.length) return { total: 0, message: '没有失败的来源' }; try { return scheduler.runList(rows.slice(0, Math.min(500, +body.limit || 500)).map((x: any) => x.guid), 'retry'); } catch (e: any) { return err(409, e.message); } });
  r('POST', '/api/sources/batch', async (_q, _m, _u, b) => { const { guids, action, value } = await json(b); if (!Array.isArray(guids) || !guids.length) return err(400, '未选择来源');
    let n = 0; db.tx(() => { for (const g of guids.slice(0, 2000)) { if (!db.get('SELECT 1 FROM sources WHERE guid=?', [g])) continue; n++;
      if (action === 'enable' || action === 'disable') db.run('UPDATE sources SET enabled=?, updated_at=? WHERE guid=?', [action === 'enable' ? 1 : 0, now(), g]);
      else if (action === 'method' && METHODS.includes(value)) saveSettings(db, g, { method: value });
      else if (action === 'proxy' && ['inherit', 'direct', 'proxy'].includes(value)) saveSettings(db, g, { proxy: value });
      else if (action === 'interval') db.run('UPDATE sources SET interval_min=? WHERE guid=?', [Math.max(0, +value || 0), g]); } });
    return { ok: true, count: n }; });
  r('POST', '/api/sources/batch-crawl', async (_q, _m, _u, b) => { const { guids } = await json(b); if (!Array.isArray(guids) || !guids.length) return err(400, '未选择来源'); try { return scheduler.runList(guids.slice(0, 500), 'batch'); } catch (e: any) { return err(409, e.message); } });
  // —— v1.9.1 内置浏览器（持久化会话：用户自己登录 / 自己完成验证后，抓取共用该会话） ——
  r('GET', '/api/browser', async () => ({ available: browserAvailable(), shared: SHARED_PARTITION, sessions: browserHost() ? await browserHost()!.partitions() : [] }));
  r('POST', '/api/browser/open', async (_q, _m, _u, b) => { const { url, guid } = await json(b); const h = browserHost(); if (!h) return err(400, '内置浏览器只在桌面版可用');
    let partition = SHARED_PARTITION, proxy: any = 'inherit', target = String(url || '');
    if (guid) { const src = db.get<any>('SELECT * FROM sources WHERE guid=?', [guid]); if (!src) return err(404, '来源不存在'); const s = effectiveSettings(db, src); partition = partitionFor(s.session, guid); proxy = s.proxy; target = target || s.entryUrl || src.url; }
    if (!/^https?:\/\//.test(target)) return err(400, '请输入 http(s) 网址');
    h.open(target, partition, proxy).catch(() => {}); return { ok: true, partition }; });
  r('POST', '/api/browser/clear', async (_q, _m, _u, b) => { const { partition } = await json(b); const h = browserHost(); if (!h) return err(400, '内置浏览器只在桌面版可用'); if (!/^persist:ph-/.test(String(partition || ''))) return err(400, '会话名无效'); await h.clear(partition); return { ok: true }; });
  r('GET', '/api/scheduler', () => scheduler.status());
  r('POST', '/api/scheduler', async (_q, _m, _u, b) => { const s = await json(b); if ('enabled' in s) db.setSetting('scheduler.enabled', s.enabled ? '1' : '0'); if (s.batch) db.setSetting('scheduler.batch', String(s.batch)); return scheduler.status(); });
  r('POST', '/api/scheduler/run', async (_q, _m, _u, b) => { const { limit } = await json(b); return scheduler.tick(limit || undefined); });
  r('GET', '/api/filters', () => db.all('SELECT * FROM saved_filters ORDER BY id DESC').map((f: any) => ({ ...f, filter: JSON.parse(f.filter_json) })));
  r('POST', '/api/filters', async (_q, _m, _u, b) => { const { name, filter } = await json(b); db.run('INSERT INTO saved_filters(name,filter_json,created_at) VALUES(?,?,?)', [name, JSON.stringify(filter), now()]); return { ok: true }; });
  r('DELETE', '/api/filters/:id', (_q, m) => { db.run('DELETE FROM saved_filters WHERE id=?', [+m[1]]); return { ok: true }; });
  r('GET', '/api/settings', () => { const c = aiConfig(db); return { 'ai.baseUrl': c.baseUrl, 'ai.model': c.model, 'ai.apiKeySet': !!c.apiKey, 'ai.apiKeyMasked': c.apiKey ? c.apiKey.slice(0, 3) + '****' + c.apiKey.slice(-4) : '', 'scheduler.enabled': db.getSetting('scheduler.enabled', '1'), 'scheduler.batch': db.getSetting('scheduler.batch', '5'), 'delta.updateUrl': db.getSetting('delta.updateUrl', process.env.PH_DELTA_URL || ''), dataDir: o.dataDir, 'app.onboardStep': db.getSetting('app.onboardStep', ''), 'app.onboarded': db.getSetting('app.onboarded', ''), delta: deltaStatus(db, o.dataDir) }; });
  r('POST', '/api/settings', async (_q, _m, _u, b) => { const s = await json(b);
    // 服务端校验，与界面内联校验一致
    if ('scheduler.batch' in s && !(Number(s['scheduler.batch']) >= 1 && Number(s['scheduler.batch']) <= 50)) return err(400, '每批来源数需在 1–50 之间');
    if ('ai.baseUrl' in s && !/^https?:\/\/[^\s]+$/.test(String(s['ai.baseUrl']))) return err(400, 'Base URL 需以 http:// 或 https:// 开头');
    if ('delta.updateUrl' in s && String(s['delta.updateUrl']).trim() && !/^(https?:\/\/|file:\/\/|\/|[A-Za-z]:[\\/])/.test(String(s['delta.updateUrl']).trim())) return err(400, '增量更新地址需为 http(s) URL、file:// 或本地路径');
    for (const k of ['app.onboarded', 'app.onboardStep', 'ai.baseUrl', 'ai.model', 'ai.apiKey', 'ai.embedModel', 'scheduler.batch', 'scheduler.enabled', 'delta.updateUrl', 'delta.autoCheck']) if (k in s) db.setSetting(k, String(s[k])); db.saveNow(); return { ok: true }; });
  // —— 增量更新（v1.9：序号链 + 校验和 + 断点续传 + 后台线程合并） ——
  let schedWasOn = false;
  const deltaJobs = new DeltaJobs(db, o.dataDir, {
    before: async () => { schedWasOn = !!(scheduler as any).timer; scheduler.stop(); for (let i = 0; i < 600 && scheduler.running; i++) await new Promise(r => setTimeout(r, 100)); },
    after: () => { if (schedWasOn && o.scheduler && !o.readOnly) scheduler.start(); },
  });
  const deltaErr = (e: any) => err(e?.code === 'busy' ? 409 : 400, String(e?.message || e));
  const saveCheck = (c: any) => { db.setSetting('delta.lastCheckAt', c.checkedAt); db.setSetting('delta.lastCheck', JSON.stringify({ ...c, plan: (c.plan || []).map((p: any) => ({ from_seq: p.from_seq, to_seq: p.to_seq, size: p.size, products: p.products })) })); };
  r('GET', '/api/delta/status', () => ({ ...deltaStatus(db, o.dataDir), job: deltaJobs.status() }), true);
  r('GET', '/api/delta/job', () => deltaJobs.status() || { state: 'idle' }, true);
  r('POST', '/api/delta/check', async (_q, _m, _u, b) => {
    const body = await json(b); const url = resolveDeltaUrl(db, body.url);
    if (!url) return err(400, '未配置增量更新地址。请在设置中填写增量更新地址（index.json 或 .phdelta.json.gz），或设置环境变量 PH_DELTA_URL');
    try { const c = await checkDelta(db, url); saveCheck(c); return c; } catch (e) { return deltaErr(e); }
  }, true);
  r('POST', '/api/delta/update', async (_q, _m, _u, b) => {
    const body = await json(b); const url = resolveDeltaUrl(db, body.url);
    if (!url) return err(400, '未配置增量更新地址');
    try { return deltaJobs.startUpdate(url); } catch (e) { return deltaErr(e); }
  });
  r('POST', '/api/delta/apply', async (_q, _m, u, b) => {
    const src = u.searchParams.get('source') || 'body'; const wait = u.searchParams.get('wait') !== '0';
    try {
      let job;
      if (src === 'url') { const body = await json(b); const url = resolveDeltaUrl(db, body.url); if (!url) return err(400, '未配置增量更新地址'); job = deltaJobs.startUpdate(url); }
      else if (src === 'file') { const body = await json(b); const fp = String(body.path || ''); if (!fp || !fs.existsSync(fp)) return err(400, '本地文件不存在'); job = deltaJobs.startApplyFile(fp); }
      else {
        const buf = await b(); if (!buf.length) return err(400, '请上传增量包（.phdelta.json / .json.gz）或使用 ?source=url');
        const dir = path.join(o.dataDir, 'delta-cache'); fs.mkdirSync(dir, { recursive: true }); const fp = path.join(dir, `upload-${Date.now()}.phdelta`); fs.writeFileSync(fp, buf);
        job = deltaJobs.startApplyFile(fp, true);
      }
      if (!wait) return job;
      const j = await deltaJobs.wait();
      if (j.state === 'error') return err(400, j.error?.message || '合并失败');
      const r0: any = j.results[j.results.length - 1] || {}; const sum = (k: string) => j.results.reduce((a: number, r: any) => a + (r[k] || 0), 0);
      return { ...r0, inserted: sum('inserted'), updated: sum('updated'), unchanged: sum('unchanged'), deleted: sum('deleted'), product_count_before: j.product_count_before, product_count_after: j.product_count_after, job: j };
    } catch (e) { return deltaErr(e); }
  });
  // 自动检查更新（只检查不自动合并）：启动后延迟 + 每 6 小时。句柄交给 close() 清理。
  const timers: NodeJS.Timeout[] = [];
  const track = (t: NodeJS.Timeout) => { timers.push(t); return t; };
  if (!o.readOnly) {
    const auto = async () => { try { if (db.getSetting('delta.autoCheck', '1') === '0' || deltaJobs.running) return; const url = resolveDeltaUrl(db); if (!url) return; try { saveCheck(await checkDelta(db, url)); } catch (e) { db.setSetting('delta.lastCheckAt', new Date().toISOString()); db.setSetting('delta.lastCheck', JSON.stringify({ error: String((e as Error).message), checkedAt: new Date().toISOString() })); } } catch { /* 退出后库已关闭 */ } };
    const t1 = track(setTimeout(auto, +(process.env.PH_DELTA_AUTOCHECK_DELAY || 60_000))); const t2 = track(setInterval(auto, 6 * 3600_000)); t1.unref?.(); t2.unref?.();
  }
  const stopTimers = () => { for (const t of timers) { clearTimeout(t); clearInterval(t); } timers.length = 0; };

  r('GET', '/api/export', (_q, _m, u) => { const f = (u.searchParams.get('format') || 'json') as any; const filter = u.searchParams.get('filter'); const out = exportProducts(db, f, { q: u.searchParams.get('q') || undefined, category: u.searchParams.get('category') || undefined, filter: filter ? JSON.parse(filter) : null }); return { __raw: out.body, mime: out.mime, filename: `products-${new Date().toISOString().slice(0, 10)}.${out.ext}` }; });
  r('POST', '/api/import', async (_q, _m, u, b) => importProducts(db, (u.searchParams.get('format') || 'json') as any, await b()));

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url || '/', 'http://local');
    const send = (code: number, body: any, type = 'application/json; charset=utf-8', extra: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const [method, re, h, safe] of routes) {
          const m = url.pathname.match(re); if (!m || method !== req.method) continue;
          if (o.readOnly && method !== 'GET' && !safe) return send(403, { error: '预览站点为只读模式' });
          const body = () => new Promise<Buffer>((ok, bad) => { const c: Buffer[] = []; req.on('data', d => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', bad); });
          const out = await h(req, m, url, body);
          if (out && out.__err) return send(out.__err, { error: out.message });
          if (out && out.__raw !== undefined) return send(200, out.__raw, out.mime, { 'content-disposition': `attachment; filename="${String(out.filename).replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(out.filename)}` });
          return send(200, out ?? null);
        }
        return send(404, { error: 'Not found' });
      }
      if (url.pathname.startsWith('/images/')) {
        const f = path.basename(url.pathname); const p = path.join(imageDir, f);
        if (fs.existsSync(p)) return send(200, fs.readFileSync(p), MIME[path.extname(f)] || 'application/octet-stream', { 'cache-control': 'max-age=31536000' });
        return send(404, 'not found', 'text/plain');
      }
      if (o.uiDir) {
        let p = path.join(o.uiDir, path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
        if (!p.startsWith(o.uiDir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(o.uiDir, 'index.html');
        const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
        return send(200, fs.readFileSync(p), types[path.extname(p)] || 'application/octet-stream');
      }
      send(404, 'not found', 'text/plain');
    } catch (e) { send(500, { error: String((e as Error).message || e) }); }
  };
  return { handler, scheduler, stopTimers };
}
function err(code: number, message: string) { return { __err: code, message }; }

export async function startServer(o: ServerOptions & { port?: number; host?: string }) {
  const app = createApp(o); const server = http.createServer(app.handler);
  await new Promise<void>(ok => server.listen(o.port ?? 0, o.host || '127.0.0.1', ok));
  const port = (server.address() as any).port;
  // 大数据量：启动后后台预热搜索索引与相似度矩阵，首个查询无需等待
  let warmTimer: NodeJS.Timeout | undefined;
  if (!o.noWarm) warmTimer = setTimeout(() => { try {
    // 大库走 FTS 候选召回，跳过全量内存倒排（避免数分钟冷启动与数 GB RSS）
    if (useFts(o.db)) { console.log('[warm] FTS 已启用，跳过全量内存索引'); return; }
    const t = Date.now(); buildIndex(o.db); console.log(`[warm] 索引就绪 ${Date.now() - t}ms`);
  } catch { /* ignore */ } }, 1500);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    app.scheduler.stop();
    app.stopTimers();
    if (warmTimer) { clearTimeout(warmTimer); warmTimer = undefined; }
    await app.scheduler.drain(5_000);
    try { o.db.saveNow(); } catch { /* */ }
    try { o.db.close(); } catch { /* */ }
    await Promise.race([
      new Promise<void>(ok => { if (!server.listening) return ok(); try { (server as any).closeAllConnections?.(); } catch { /* */ } server.close(() => ok()); }),
      new Promise<void>(ok => setTimeout(ok, 3_000)),
    ]);
  };
  return { server, port, url: `http://${o.host && o.host !== '0.0.0.0' ? o.host : '127.0.0.1'}:${port}`, scheduler: app.scheduler, close };
}
