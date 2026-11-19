/**
 * v1.9.1 抓取流水线：按每源设置选择抓取方式；「自动」按顺序回退：
 *   官方 API → RSS → 静态页面（含 RSS 发现 / JSON-LD / 启发式） → 浏览器网页（桌面版）→ Sitemap → 公开存档（Wayback / Common Crawl）
 * 失败归类（net.ts FailKind）并写入 sources.last_error（普通中文）与 source_settings 统计。
 * 不做任何挑战绕过 / 指纹伪造；遇到人机验证时由用户在可见窗口里自己处理，否则走公开存档。
 */
import type { DB } from './db';
import { now } from './db';
import { runRule, parseDetail, pool, isLikelyProduct, type CrawlItem, type CrawlRule, type Fetcher, defaultFetcher } from './crawler';
import { upsertProduct, type ProductInput } from './products';
import { cacheImage } from './images';
import { hostOf, safeJson } from './util';
import { request, CrawlError, classifyFailure, failLabel, kindOfStatus, type FailKind } from './net';
import { effectiveSettings, recordOutcome, ensureSourceSettings, type CrawlMethod, type SourceSettings } from './source-settings';
import { expandUrl, archiveKindFor } from './browser-rules';
import { browserHost, partitionFor } from './browser';
import { waybackAvailable, fetchWaybackSnapshot, stripWaybackToolbar, unwrapWaybackHref, commonCrawlQuery, fetchCommonCrawlRecord, parseProductsFromArchive } from './archive-fallback';

export interface Attempt { method: CrawlMethod; ok: boolean; count: number; kind?: FailKind; message?: string; ms: number; url?: string }
export interface CollectResult { items: CrawlItem[]; method: CrawlMethod | null; attempts: Attempt[]; rule: CrawlRule | null; kind: FailKind | null; message: string | null }

export function makeFetcher(s: SourceSettings): Fetcher {
  return async (url, o) => { const r = await request(url, { proxy: s.proxy, timeoutMs: s.timeoutMs ?? undefined, intervalMs: s.intervalMs ?? undefined, headers: o?.headers }); return { status: r.status, text: r.text, contentType: r.contentType, finalUrl: r.finalUrl }; };
}
const looksJsApp = (html: string) => { const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); return body.length < 1500 || /<div id="(root|app|__next|__nuxt)"[^>]*>\s*<\/div>|window\.__NUXT__|__NEXT_DATA__|ng-version|data-reactroot/i.test(html) && body.length < 4000; };

/** 自动模式的方法顺序（按设置可用性过滤） */
export function methodChain(s: SourceSettings, rule: CrawlRule | null, browserOk: boolean): CrawlMethod[] {
  if (s.method !== 'auto') { const m: CrawlMethod[] = [s.method]; if (s.archiveFallback && s.method !== 'archive') m.push('archive'); return m; }
  const out: CrawlMethod[] = [];
  if (s.apiUrl || rule?.mode === 'json') out.push('api');
  if (s.rssUrl || rule?.mode === 'rss') out.push('rss');
  out.push('html'); if (browserOk) out.push('browser'); out.push('sitemap'); if (s.archiveFallback) out.push('archive');
  return out;
}
/** 某次失败后是否值得继续尝试下一个方法 */
const skipAfter = (kind: FailKind | undefined, next: CrawlMethod) => (kind === 'dns' && (next === 'browser' || next === 'sitemap'));

export async function collect(db: DB, src: any, o: { fetcher?: Fetcher; log?: (s: string) => void; method?: CrawlMethod; maxItems?: number; test?: boolean } = {}): Promise<CollectResult> {
  const s = effectiveSettings(db, src); if (o.method) s.method = o.method;
  const log = o.log || (() => {}); const rule0 = safeJson<CrawlRule | null>(src.rule_json, null);
  const fetcher = o.fetcher || makeFetcher(s); const host = browserHost();
  const maxItems = o.maxItems || s.maxItems || 60;
  const entry = (s.entryUrl ? expandUrl(s.entryUrl, src.url) : '') || rule0?.listUrl || src.url;
  // 注入的 fetcher（测试夹具 / 离线回放）不访问真实的公开存档，除非显式选择存档方式
  const chain = methodChain(s, rule0, !!host).filter(m => !(o.fetcher && m === 'archive' && s.method !== 'archive'));
  const attempts: Attempt[] = []; let lastKind: FailKind | undefined; let browserErr = '';
  const common = { followDetail: !o.test && (rule0?.followDetail ?? true), maxItems, requireExternalUrl: s.requireExternalUrl, keepDetailAsUrl: !!s.browser.keepDetailAsUrl } as Partial<CrawlRule>;
  for (const m of chain) {
    if (attempts.length && skipAfter(lastKind, m)) { attempts.push({ method: m, ok: false, count: 0, kind: lastKind, message: '跳过：' + failLabel(lastKind), ms: 0 }); continue; }
    const t0 = Date.now(); let url = entry;
    try {
      let items: CrawlItem[] = []; let rule: CrawlRule | null = null;
      if (m === 'api') {
        url = expandUrl(s.apiUrl || rule0?.listUrl || entry, src.url).replace(/\{apiKey\}/g, encodeURIComponent(s.apiKey || ''));
        const headers: Record<string, string> = { accept: 'application/json' }; if (s.apiKey && !/\{apiKey\}/.test(s.apiUrl)) headers[s.apiKeyHeader || 'authorization'] = s.apiKeyHeader ? s.apiKey : 'Bearer ' + s.apiKey;
        const r = await runRule({ ...(rule0?.mode === 'json' ? rule0 : {}), mode: 'json', listUrl: url, jsonPath: s.jsonPath || rule0?.jsonPath, headers, ...common, followDetail: false } as CrawlRule, src.url, fetcher, log); items = r.items; rule = r.rule;
      } else if (m === 'rss') {
        url = expandUrl(s.rssUrl || rule0?.listUrl || entry, src.url);
        const r = await runRule({ ...(rule0?.mode === 'rss' ? rule0 : {}), mode: 'rss', listUrl: url, ...common } as CrawlRule, src.url, fetcher, log); items = r.items; rule = r.rule;
      } else if (m === 'html') {
        const base: CrawlRule = rule0 && rule0.mode !== 'json' && rule0.mode !== 'rss' ? rule0 : { mode: 'auto' };
        let html = ''; const spy: Fetcher = async (u, x) => { const r = await fetcher(u, x); if (u === url) html = r.text; return r; };
        const r = await runRule({ ...base, listUrl: url, ...common } as CrawlRule, src.url, spy, log); items = r.items; rule = r.rule;
        if (!items.length && html && looksJsApp(html)) throw new CrawlError('js_required', '页面靠 JS 渲染，静态抓取拿不到列表', { url });
      } else if (m === 'browser') {
        if (!host) throw new CrawlError('browser_unavailable', failLabel('browser_unavailable'));
        const urls = (s.entryUrls.length ? s.entryUrls : [s.entryUrl || src.url]).map(u => expandUrl(u, src.url)).slice(0, o.test ? 2 : s.maxPages);
        const b = s.browser; const seen = new Set<string>(); let challenged = false; browserErr = '';
        for (const u of urls) {
          url = u; log('浏览器打开 ' + u);
          const res = await host.render({ url: u, partition: partitionFor(s.session, src.guid), proxy: s.proxy, timeoutMs: s.timeoutMs || 45_000, waitSelector: b.waitSelector, scrolls: b.scrolls, waitMs: b.waitMs, nextSelector: b.nextSelector, pages: b.nextSelector ? Math.min(s.maxPages, 5) : 1, script: b.script, showOnChallenge: s.showOnChallenge && !o.test, label: src.name });
          if (res.challenged) { challenged = true; log('浏览器遇到人机验证' + (res.userSolved === false ? '，未在等待时间内完成' : '')); continue; }
          if (res.status >= 400 && res.status !== 0) { lastKind = kindOfStatus(res.status); browserErr = `浏览器打开返回 HTTP ${res.status}`; continue; }
          let got: CrawlItem[] = [];
          if (res.scriptItems?.length) got = res.scriptItems.map((x: any) => ({ name: String(x.name || ''), detailUrl: x.url || x.detailUrl || null, url: null, tagline: x.tagline || null, description: x.description || null, image: x.image || null, votes: x.votes ?? null }));
          else {
            const rendered: Fetcher = async (q, x) => q === u ? { status: 200, text: res.html, contentType: 'text/html', finalUrl: res.finalUrl || u } : fetcher(q, x);
            const br: CrawlRule = b.itemSelector ? { mode: 'html', itemSelector: b.itemSelector, fields: b.fields as any } : rule0 && rule0.mode === 'html' ? rule0 : { mode: 'auto', noFeeds: true };
            const r = await runRule({ ...br, listUrl: u, ...common, followDetail: !o.test && (b.followDetail ?? true), noFeeds: true } as CrawlRule, src.url, rendered, log); got = r.items; rule = r.rule;
          }
          for (const it of got) { const k = (it.name + '|' + (it.detailUrl || it.url || '')).toLowerCase(); if (!seen.has(k)) { seen.add(k); items.push(it); } }
          if (items.length >= maxItems) break;
        }
        items = items.slice(0, maxItems);
        if (!items.length && challenged) throw new CrawlError('challenge', '浏览器打开后仍是人机验证页', { url });
        if (!items.length && browserErr) throw new CrawlError(lastKind || 'forbidden', browserErr, { url });
      } else if (m === 'sitemap') {
        items = await fromSitemap(src, s, fetcher, maxItems, o.test); url = s.sitemapUrl || new URL('/sitemap.xml', entry).toString();
      } else if (m === 'archive') {
        const r = await archiveLock(() => fromArchive(src, entry, s.browser.itemSelector ? { mode: 'html', itemSelector: s.browser.itemSelector, fields: s.browser.fields as any } : rule0, common, log)); items = r.items.slice(0, maxItems); url = r.url || entry;
      }
      items = items.filter(isLikelyProduct);
      const ms = Date.now() - t0;
      if (items.length) { attempts.push({ method: m, ok: true, count: items.length, ms, url }); return { items, method: m, attempts, rule, kind: null, message: null }; }
      lastKind = lastKind && m === 'browser' ? lastKind : 'empty'; attempts.push({ method: m, ok: false, count: 0, kind: lastKind, message: failLabel(lastKind), ms, url });
    } catch (e: any) {
      lastKind = classifyFailure(e); attempts.push({ method: m, ok: false, count: 0, kind: lastKind, message: String(e?.message || e).slice(0, 200), ms: Date.now() - t0, url });
      log(`${m} 失败：${failLabel(lastKind)}`);
    }
  }
  // 汇总失败原因：优先报告“最根本”的那个（第一个非 empty / browser_unavailable 的错误）
  const pri = attempts.find(a => a.kind && !['empty', 'browser_unavailable'].includes(a.kind)) || attempts[attempts.length - 1];
  return { items: [], method: null, attempts, rule: null, kind: pri?.kind || 'empty', message: pri ? `${failLabel(pri.kind)}${pri.kind === 'challenge' || pri.kind === 'forbidden' ? '；公开存档也没取到' : ''}${pri.message && pri.message !== failLabel(pri.kind) ? '｜' + pri.message.slice(0, 120) : ''}` : '没有可用的抓取方式' };
}

/** 公开存档串行访问，避免多源并发把 Wayback 打到 429 */
let archiveQ: Promise<any> = Promise.resolve();
function archiveLock<T>(fn: () => Promise<T>): Promise<T> { const p = archiveQ.then(fn, fn); archiveQ = p.catch(() => {}); return p; }

/** Sitemap：只取像产品详情页的地址，名字取自 slug，少量详情页补全 */
const PRODUCT_PATH = /\/(tools?|products?|apps?|software|ai|startups?|companies|company|listing|item|p|s|projects?|alternatives?)\/[^/?#]{2,80}\/?$/i;
async function fromSitemap(src: any, s: SourceSettings, fetcher: Fetcher, maxItems: number, test?: boolean): Promise<CrawlItem[]> {
  const root = s.sitemapUrl || new URL('/sitemap.xml', src.url).toString(); const locs: string[] = [];
  const read = async (u: string, depth: number) => {
    const r = await fetcher(u); const xs = [...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1].replace(/&amp;/g, '&'));
    if (/<sitemapindex/i.test(r.text) && depth < 2) { const kids = xs.filter(x => /tool|product|app|software|startup|compan|listing|item|project/i.test(x)).slice(0, 3); for (const k of (kids.length ? kids : xs.slice(0, 2))) { try { await read(k, depth + 1); } catch { /* */ } if (locs.length > maxItems * 5) break; } }
    else locs.push(...xs);
  };
  await read(root, 0);
  const picked = [...new Set(locs.filter(u => PRODUCT_PATH.test(new URL(u).pathname)))].slice(-maxItems);
  const items: CrawlItem[] = picked.map(u => { const slug = decodeURIComponent(new URL(u).pathname.replace(/\/$/, '').split('/').pop() || ''); return { name: slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim(), detailUrl: u, url: null }; }).filter(i => i.name.length >= 2);
  if (!test) await pool(items.slice(0, 25), 3, async it => { try { const d = await fetcher(it.detailUrl!); const x = parseDetail(d.text, d.finalUrl); if (x.name) it.name = x.name; it.url = x.url || null; it.description = x.description || null; it.image = x.image || null; } catch { /* */ } });
  return items;
}

/** 公开存档：Wayback 最近快照 → Common Crawl；链接还原成原站地址，不访问被拦的原站详情页 */
async function fromArchive(src: any, entry: string, rule0: CrawlRule | null, common: Partial<CrawlRule>, log: (s: string) => void): Promise<{ items: CrawlItem[]; url: string | null }> {
  const kind = archiveKindFor(src.url); const tries: { html: string; url: string; ch: string }[] = [];
  // Wayback 对 www / 结尾斜杠敏感：依次试几个写法
  const variants = [...new Set([entry, (() => { try { const u = new URL(entry); if (!u.hostname.startsWith('www.')) u.hostname = 'www.' + u.hostname; return u.toString(); } catch { return entry; } })(), entry.replace(/\/?$/, '/')])];
  let av = await waybackAvailable(variants[0], 30_000);
  for (const v of variants.slice(1)) { if (av.snapshotUrl) break; log('公开存档 ' + av.evidence + '，换写法 ' + v); av = await waybackAvailable(v, 30_000); }
  if (av.snapshotUrl) {
    let snap = await fetchWaybackSnapshot({ snapshotUrl: av.snapshotUrl }, 60_000);
    // 回放页被限流时改取原始快照（id_，不改写链接）
    if (!snap.ok && av.timestamp) { const raw = av.snapshotUrl.replace(/^http:/, 'https:').replace(/\/web\/(\d+)\//, '/web/$1id_/'); try { const r = await request(raw, { raw: true, retries: 2, timeoutMs: 60_000, intervalMs: 1500, maxBytes: 30_000_000 }); log(`公开存档原始快照 HTTP ${r.status} ${r.text.length}B ${r.status >= 400 ? r.text.slice(0, 300).replace(/\s+/g, " ") : ""}`); if (r.status < 400 && r.text.length > 500) snap = { ...snap, ok: true, html: r.text }; } catch (e) { log('公开存档原始快照失败：' + (e as Error).message); } }
    log('公开存档 ' + snap.evidence); if (snap.ok) tries.push({ html: stripWaybackToolbar(snap.html), url: entry, ch: 'wayback ' + av.timestamp });
  } else log('公开存档 ' + av.evidence);
  const parse = async (html0: string, url: string) => {
    // 还原 Wayback 改写的链接（/web/TS/https://… → https://…），再按原站解析
    const html = unwrapArchiveLinks(html0, url);
    if (kind !== 'generic') { const c = parseProductsFromArchive(kind, html, url, 'wayback'); if (c.length) return c.map(x => ({ name: x.name, url: x.url || null, detailUrl: x.url || null, tagline: (x as any).tagline || null, description: (x as any).description || null } as CrawlItem)); }
    const fx: Fetcher = async q => { if (q === url) return { status: 200, text: html, contentType: 'text/html', finalUrl: url }; throw new CrawlError('code', '存档模式不访问原站'); };
    const r = await runRule({ ...(rule0 && rule0.mode === 'html' ? rule0 : { mode: 'auto' }), listUrl: url, ...common, followDetail: false, noFeeds: true } as CrawlRule, src.url, fx, log);
    return r.items.map(i => ({ ...i, detailUrl: i.detailUrl ? unwrapWaybackHref(i.detailUrl) : null, url: i.url ? unwrapWaybackHref(i.url) : null }));
  };
  for (const t of tries) { const items = await parse(t.html, t.url); log(`公开存档 ${t.ch}：${items.length} 条`); if (items.length) return { items, url: t.url }; }
  try {
    const q = await commonCrawlQuery(entry, { limit: 3, maxIndexes: 2, timeoutMs: 30_000 });
    for (const hit of q.hits.slice(0, 1)) { const rec = await fetchCommonCrawlRecord(hit, 60_000); if (rec.ok) { const items = await parse(rec.html, entry); log(`Common Crawl：${items.length} 条`); if (items.length) return { items, url: entry }; } }
  } catch (e) { log('Common Crawl 失败：' + (e as Error).message); }
  if (!tries.length && /HTTP 429/.test(av.evidence)) throw new CrawlError('rate_limited', '公开存档（Wayback）限流，稍后重试');
  if (!tries.length && !av.snapshotUrl) throw new CrawlError('empty', '公开存档里没有这个页面的快照');
  return { items: [], url: null };
}

export function unwrapArchiveLinks(html: string, pageUrl?: string): string {
  const h = pageUrl ? (hostOf(pageUrl) || '').replace(/^www\./, '') : '';
  const out = html.replace(/(href|src|srcset)=(["'])(?:https?:\/\/web\.archive\.org)?\/web\/\d+(?:[a-z]{2}_)?\/(https?:\/\/)?/gi, (_m, a, q, p) => `${a}=${q}${p || 'https://'}`);
  // 原站内链还原为相对路径，便于沿用按 href^="/…" 写的选择器
  return h ? out.replace(new RegExp(`(href)=(["'])https?:\\/\\/(?:www\\.)?${h.replace(/\./g, '\\.')}(?=/)`, 'gi'), '$1=$2') : out;
}

/** 抓取单个来源并入库（增量：按内容哈希判断新增/更新）。dryRun=单源测试，不入库 */
export async function crawlSource(db: DB, guid: string, opts: { fetcher?: Fetcher; imageDir?: string; log?: (s: string) => void; dryRun?: boolean; method?: CrawlMethod; maxItems?: number } = {}) {
  ensureSourceSettings(db);
  const src = db.get<any>('SELECT * FROM sources WHERE guid=?', [guid]); if (!src) throw new Error('来源不存在');
  const t0 = Date.now(); let runId: number | null = null;
  if (!opts.dryRun) { db.run('INSERT INTO crawl_runs(source_guid,started_at,status) VALUES(?,?,?)', [guid, now(), 'running']); runId = db.get<any>('SELECT MAX(id) id FROM crawl_runs').id; }
  try {
    const res = await collect(db, src, { fetcher: opts.fetcher, log: opts.log, method: opts.method, maxItems: opts.maxItems, test: opts.dryRun });
    const ms = Date.now() - t0;
    if (opts.dryRun) {
      recordOutcome(db, guid, { ok: !!res.items.length, kind: res.kind, method: res.method || undefined, message: res.message, ms, items: res.items.length });
      return { test: true, ok: !!res.items.length, found: res.items.length, method: res.method, attempts: res.attempts, kind: res.kind, reason: res.message, sample: res.items.slice(0, 10), ms };
    }
    if (!res.items.length) {
      const msg = `[${res.kind}] ${res.message}`;
      db.run('UPDATE sources SET last_crawl_at=?, last_status=?, last_error=? WHERE guid=?', [now(), res.kind === 'empty' ? 'empty' : 'error', res.kind === 'empty' ? msg : msg, guid]);
      db.run('UPDATE crawl_runs SET finished_at=?, status=?, error=? WHERE id=?', [now(), res.kind === 'empty' ? 'empty' : 'error', msg + ' · ' + res.attempts.map(a => `${a.method}:${a.ok ? a.count : a.kind}`).join(' → '), runId]);
      recordOutcome(db, guid, { ok: false, kind: res.kind, message: res.message, ms, items: 0 });
      return { found: 0, inserted: 0, updated: 0, error: res.kind === 'empty' ? undefined : res.message || '失败', kind: res.kind, attempts: res.attempts };
    }
    let inserted = 0, updated = 0;
    const results = db.tx(() => res.items.map(it => {
      const input: ProductInput = { name: it.name, url: it.url, tagline: it.tagline, description: it.description, logo_url: it.image, votes: it.votes, launch_date: it.date };
      const r = upsertProduct(db, input, { sourceGuid: guid, origin: 'crawl', versionLabel: src.name });
      if (r.status === 'inserted') inserted++; else if (r.status === 'updated' || r.newVersion) updated++;
      return { ...r, image: it.image };
    }));
    if (opts.imageDir) await pool(results.filter(r => r.image), 4, async r => { const f = await cacheImage(r.image!, opts.imageDir!); if (f) db.run('UPDATE products SET logo_local=? WHERE guid=? AND logo_local IS NULL', [f, r.guid]); });
    const pc = db.get<any>('SELECT COUNT(DISTINCT product_guid) c FROM product_versions WHERE source_guid=?', [guid]).c;
    const saveRule = !src.rule_json && res.rule && (res.method === 'html') && res.rule.mode !== 'auto' ? JSON.stringify(res.rule) : null;
    db.run('UPDATE sources SET last_crawl_at=?, last_status=?, last_error=NULL, product_count=?, rule_json=COALESCE(rule_json, ?), updated_at=? WHERE guid=?', [now(), 'ok', pc, saveRule, now(), guid]);
    db.run('UPDATE crawl_runs SET finished_at=?, status=?, found=?, inserted=?, updated=?, error=? WHERE id=?', [now(), 'ok', res.items.length, inserted, updated, res.method !== 'html' ? '方式：' + res.method + (res.attempts.length > 1 ? ' · ' + res.attempts.map(a => `${a.method}:${a.ok ? a.count : a.kind}`).join(' → ') : '') : null, runId]);
    recordOutcome(db, guid, { ok: true, method: res.method || undefined, ms, items: res.items.length });
    return { found: res.items.length, inserted, updated, rule: res.rule, method: res.method, attempts: res.attempts };
  } catch (e) {
    const kind = classifyFailure(e); const msg = `[${kind}] ${String((e as Error).message || e).slice(0, 300)}`;
    db.run('UPDATE sources SET last_crawl_at=?, last_status=?, last_error=? WHERE guid=?', [now(), 'error', msg, guid]);
    if (runId) db.run('UPDATE crawl_runs SET finished_at=?, status=?, error=? WHERE id=?', [now(), 'error', msg, runId]);
    recordOutcome(db, guid, { ok: false, kind, message: msg, ms: Date.now() - t0 });
    return { found: 0, inserted: 0, updated: 0, error: msg, kind };
  }
}
/** 启动时把上次异常退出遗留的 running 记录收尾 */
export function closeStaleRuns(db: DB) { db.run("UPDATE crawl_runs SET status='error', finished_at=?, error='[code] 上次抓取时程序退出，已中断' WHERE status='running'", [now()]); }
/** 失败原因 kind：兼容旧库里的英文错误文本 */
export function kindOfError(lastStatus: string | null, lastError: string | null): FailKind | null {
  if (lastStatus === 'ok' || (!lastError && lastStatus !== 'error')) return lastStatus === 'empty' ? 'empty' : null;
  const m = String(lastError || '').match(/^\[(\w+)\]/); if (m) return m[1] as FailKind;
  return classifyFailure({ message: lastError || '' });
}
export { hostOf };
