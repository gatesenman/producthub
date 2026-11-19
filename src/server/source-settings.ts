/** v1.9.1 每源抓取设置（只存本地库，增量包不下发也不覆盖） */
import type { DB } from './db';
import { now } from './db';
import { safeJson, hostOf } from './util';
import type { ProxyChoice, FailKind } from './net';
import { builtinFor } from './browser-rules';
import type { FieldRule } from './crawler';

export type CrawlMethod = 'auto' | 'api' | 'rss' | 'sitemap' | 'html' | 'browser' | 'archive';
export const METHODS: CrawlMethod[] = ['auto', 'api', 'rss', 'sitemap', 'html', 'browser', 'archive'];
export const METHOD_LABEL: Record<CrawlMethod, string> = { auto: '自动（按顺序回退）', api: '官方 API', rss: 'RSS / Atom', sitemap: 'Sitemap', html: '静态页面', browser: '浏览器网页', archive: '公开存档（Wayback / Common Crawl）' };
export interface BrowserRule {
  waitSelector?: string; itemSelector?: string; fields?: Record<string, FieldRule>; script?: string;
  scrolls?: number; nextSelector?: string; waitMs?: number; keepDetailAsUrl?: boolean; followDetail?: boolean;
}
export interface SourceSettings {
  method: CrawlMethod; proxy: ProxyChoice; entryUrl: string; entryUrls: string[]; apiUrl: string; apiKey: string; apiKeyHeader: string; jsonPath: string; rssUrl: string; sitemapUrl: string;
  maxItems: number; maxPages: number; intervalMs: number | null; timeoutMs: number | null;
  session: 'shared' | 'isolated'; showOnChallenge: boolean; archiveFallback: boolean; requireExternalUrl: boolean;
  browser: BrowserRule;
}
export const DEFAULT_SOURCE: SourceSettings = { method: 'auto', proxy: 'inherit', entryUrl: '', entryUrls: [], apiUrl: '', apiKey: '', apiKeyHeader: '', jsonPath: '', rssUrl: '', sitemapUrl: '', maxItems: 60, maxPages: 3, intervalMs: null, timeoutMs: null, session: 'shared', showOnChallenge: true, archiveFallback: true, requireExternalUrl: false, browser: { scrolls: 3, waitMs: 2500 } };
export const SOURCE_SETTINGS_SCHEMA = `CREATE TABLE IF NOT EXISTS source_settings (guid TEXT PRIMARY KEY, settings_json TEXT, ok_count INTEGER DEFAULT 0, fail_count INTEGER DEFAULT 0, consecutive_fail INTEGER DEFAULT 0, last_kind TEXT, last_method TEXT, last_message TEXT, last_ms INTEGER, last_items INTEGER, updated_at TEXT);`;
export function ensureSourceSettings(db: DB) { db.run(SOURCE_SETTINGS_SCHEMA); }

function clampInt(v: any, d: number | null, lo: number, hi: number) { if (v === null || v === '' || v === undefined) return d; const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d; }
export function normalizeSettings(p: any): Partial<SourceSettings> {
  const o: any = {}; if (!p || typeof p !== 'object') return o;
  if (METHODS.includes(p.method)) o.method = p.method;
  if (['inherit', 'direct', 'proxy'].includes(p.proxy)) o.proxy = p.proxy;
  for (const k of ['entryUrl', 'apiUrl', 'apiKey', 'apiKeyHeader', 'jsonPath', 'rssUrl', 'sitemapUrl']) if (k in p) o[k] = String(p[k] ?? '').trim().slice(0, 2000);
  if ('entryUrls' in p) o.entryUrls = (Array.isArray(p.entryUrls) ? p.entryUrls : String(p.entryUrls || '').split(/\n/)).map((s: any) => String(s).trim()).filter(Boolean).slice(0, 20);
  if ('maxItems' in p) o.maxItems = clampInt(p.maxItems, 60, 1, 2000); if ('maxPages' in p) o.maxPages = clampInt(p.maxPages, 3, 1, 50);
  if ('intervalMs' in p) o.intervalMs = clampInt(p.intervalMs, null, 0, 120_000); if ('timeoutMs' in p) o.timeoutMs = clampInt(p.timeoutMs, null, 3000, 300_000);
  if (['shared', 'isolated'].includes(p.session)) o.session = p.session;
  for (const k of ['showOnChallenge', 'archiveFallback', 'requireExternalUrl']) if (k in p) o[k] = !!p[k];
  if (p.browser && typeof p.browser === 'object') { const b = p.browser; const r: BrowserRule = {};
    for (const k of ['waitSelector', 'itemSelector', 'script', 'nextSelector'] as const) if (b[k]) r[k] = String(b[k]).slice(0, 20000);
    if (b.fields && typeof b.fields === 'object') r.fields = b.fields;
    if ('scrolls' in b) r.scrolls = clampInt(b.scrolls, 3, 0, 60) as number; if ('waitMs' in b) r.waitMs = clampInt(b.waitMs, 2500, 0, 60_000) as number;
    for (const k of ['keepDetailAsUrl', 'followDetail'] as const) if (k in b) r[k] = !!b[k];
    o.browser = r; }
  return o;
}
export function savedSettings(db: DB, guid: string): Partial<SourceSettings> { return safeJson(db.get<any>('SELECT settings_json FROM source_settings WHERE guid=?', [guid])?.settings_json, {}); }
/** 生效设置 = 默认 ⊕ 内置（按站点） ⊕ 用户保存 */
export function effectiveSettings(db: DB, src: { guid: string; url: string }): SourceSettings {
  const b = builtinFor(src.url); const u = savedSettings(db, src.guid);
  return { ...DEFAULT_SOURCE, ...b, ...u, browser: { ...DEFAULT_SOURCE.browser, ...(b.browser || {}), ...(u.browser || {}) } } as SourceSettings;
}
export function saveSettings(db: DB, guid: string, patch: any): SourceSettings {
  ensureSourceSettings(db); const cur = savedSettings(db, guid); const n = normalizeSettings(patch);
  if (patch && patch.apiKey === undefined) delete (n as any).apiKey; // 未改动的 Key 保留
  const next = { ...cur, ...n, ...(n.browser ? { browser: { ...(cur.browser || {}), ...n.browser } } : {}) };
  db.run('INSERT INTO source_settings(guid,settings_json,updated_at) VALUES(?,?,?) ON CONFLICT(guid) DO UPDATE SET settings_json=excluded.settings_json, updated_at=excluded.updated_at', [guid, JSON.stringify(next), now()]);
  const src = db.get<any>('SELECT guid,url FROM sources WHERE guid=?', [guid]); return effectiveSettings(db, src || { guid, url: '' });
}
export function resetSettings(db: DB, guid: string) { db.run('UPDATE source_settings SET settings_json=NULL WHERE guid=?', [guid]); }
export function recordOutcome(db: DB, guid: string, o: { ok: boolean; kind?: FailKind | null; method?: string; message?: string | null; ms?: number; items?: number }) {
  ensureSourceSettings(db);
  db.run(`INSERT INTO source_settings(guid,ok_count,fail_count,consecutive_fail,last_kind,last_method,last_message,last_ms,last_items,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(guid) DO UPDATE SET ok_count=ok_count+excluded.ok_count, fail_count=fail_count+excluded.fail_count, consecutive_fail=CASE WHEN excluded.ok_count=1 THEN 0 ELSE consecutive_fail+1 END, last_kind=excluded.last_kind, last_method=excluded.last_method, last_message=excluded.last_message, last_ms=excluded.last_ms, last_items=excluded.last_items, updated_at=excluded.updated_at`,
    [guid, o.ok ? 1 : 0, o.ok ? 0 : 1, o.ok ? 0 : 1, o.kind || null, o.method || null, o.message || null, o.ms ?? null, o.items ?? null, now()]);
}
/** 给界面的公开视图：API Key 只显示是否已设置 */
export function publicSettings(s: SourceSettings) { const { apiKey, ...rest } = s; return { ...rest, apiKeySet: !!apiKey, apiKeyMasked: apiKey ? apiKey.slice(0, 3) + '****' + apiKey.slice(-2) : '' }; }
export function hostKey(url: string) { return (hostOf(url) || '').replace(/^www\./, ''); }
