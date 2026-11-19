/**
 * Cloudflare / 挑战页 → 公开存档回退管道
 *
 * 原则：绝不绕过 CF 人机验证 / Turnstile / JS challenge / cf_clearance。
 * 仅走公开合法通道：官方/公开 API、RSS/Atom、sitemap（直连可用时）、
 * Wayback Machine（CDX / available + 快照）、Common Crawl（索引 + WARC 片段）、
 * 已验证第三方公开归档（如 Arctic Shift）、镜像站、站点自有导出。
 */
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { CHROME_UA } from './history';
import { request } from './net';

export type ArchiveChannel = 'direct' | 'wayback' | 'commoncrawl' | 'public-api' | 'sitemap' | 'third-party-archive';

export interface ArchiveProductCandidate {
  name: string;
  url: string;
  description?: string | null;
  tagline?: string | null;
  detailUrl?: string | null;
  source: string;
  channel: ArchiveChannel;
  evidence?: string;
}

export interface FetchProbe {
  url: string;
  status: number;
  size: number;
  challenged: boolean;
  reason?: string;
  head?: string;
}

export interface CdxHit {
  timestamp: string;
  original: string;
  statuscode?: string;
  mime?: string;
  filename?: string;
  offset?: string;
  length?: string;
  digest?: string;
  url?: string;
}

export interface ArchiveFetchResult {
  ok: boolean;
  channel: ArchiveChannel;
  url: string;
  finalUrl?: string;
  status: number;
  html: string;
  evidence: string;
}

const ARCHIVE_UA = 'Mozilla/5.0 (compatible; ProductHubArchive/1.8; +https://localhost) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36';

/** CF / 挑战 / 反爬页识别（含 IT桔子 412 文案常见形态） */
export function isChallengeHtml(html: string, status = 200): boolean {
  if (!html) return status === 403 || status === 412 || status === 429 || status === 503;
  const head = html.slice(0, 8000);
  if (/Just a moment|Checking your browser|Verifying (your )?Connection|cf-browser-verification|cf-challenge|cf-chl|challenge-platform|Attention Required|Enable JavaScript and cookies to continue|Security Checkpoint|Vercel Security Checkpoint|__cf_chl|cdn-cgi\/challenge|turnstile/i.test(head)) return true;
  if (status === 412 || status === 403) {
    if (/cloudflare|access denied|forbidden|anti.?bot|人机验证|访问过于频繁|安全验证/i.test(head)) return true;
    // 极短 403 正文（常见于 CF 空挡）
    if (html.trim().length < 80) return true;
  }
  if (status === 429 && /checkpoint|rate.?limit|too many/i.test(head)) return true;
  return false;
}

export function classifyBlock(status: number, html: string): string | null {
  if (isChallengeHtml(html, status)) {
    if (status === 412) return 'http-412-anti-crawl';
    if (status === 429) return 'rate-limit-or-checkpoint';
    if (/Just a moment/i.test(html)) return 'cloudflare-just-a-moment';
    if (/Checking your browser/i.test(html)) return 'browser-check-challenge';
    if (/Verifying/i.test(html)) return 'connection-verification';
    return 'challenge-or-waf';
  }
  if (status === 0) return 'connection-failed';
  if (status >= 400) return `http-${status}`;
  return null;
}

async function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

export async function httpGet(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; retries?: number; acceptIdentity?: boolean } = {},
): Promise<{ status: number; body: Buffer; text: string; finalUrl: string; headers: Headers }> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const retries = opts.retries ?? 2;
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      const headers: Record<string, string> = {
        'user-agent': ARCHIVE_UA,
        accept: 'text/html,application/xhtml+xml,application/json,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        ...(opts.acceptIdentity ? { 'accept-encoding': 'identity' } : {}),
        ...(opts.headers || {}),
      };
      // v1.9.1：走统一网络层（代理 / 限速）；存档站单独限速，避免 429
      const rr = await request(url, { headers, timeoutMs, retries: Math.min(retries, 2), raw: true, intervalMs: 1200, maxBytes: 30_000_000 });
      const r = { status: rr.status, url: rr.finalUrl, headers: new Headers(Object.entries(rr.headers).filter(([k]) => !/^:/.test(k)) as [string, string][]) };
      let body = rr.body;
      const ce = '';
      try {
        if (ce.includes('br') || body.slice(0, 4).equals(Buffer.from([0xce, 0xb2, 0xcf, 0x81]))) {
          // brotli rare; magic check soft
        }
        // zstd magic 28 b5 2f fd — Node 22 may lack zstd; prefer identity
        if (body.length >= 4 && body[0] === 0x28 && body[1] === 0xb5 && body[2] === 0x2f && body[3] === 0xfd) {
          // leave as-is; caller should refetch with identity
        } else if (ce.includes('gzip') || (body[0] === 0x1f && body[1] === 0x8b)) {
          body = gunzipSync(body);
        }
      } catch { /* keep raw */ }
      const text = body.toString('utf8');
      return { status: r.status, body, text, finalUrl: r.url || url, headers: r.headers };
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(1500 * (i + 1));
    }
  }
  throw lastErr || new Error('httpGet failed: ' + url);
}

/** 直连探测：是否被 CF/挑战拦住 */
export async function probeDirect(urls: string[], timeoutMs = 25_000): Promise<FetchProbe[]> {
  const out: FetchProbe[] = [];
  for (const url of urls) {
    try {
      const r = await httpGet(url, { timeoutMs, retries: 1, acceptIdentity: true });
      const challenged = isChallengeHtml(r.text, r.status) || !(r.status >= 200 && r.status < 400);
      out.push({
        url, status: r.status, size: r.body.length, challenged,
        reason: classifyBlock(r.status, r.text) || undefined,
        head: r.text.slice(0, 180).replace(/\s+/g, ' '),
      });
    } catch (e: any) {
      out.push({ url, status: 0, size: 0, challenged: true, reason: 'connection-failed:' + String(e?.message || e).slice(0, 120) });
    }
  }
  return out;
}

/** Wayback CDX（JSON 行或数组） */
export async function waybackCdx(params: {
  url: string; limit?: number; from?: string; to?: string; filterStatus?: string; collapse?: string; timeoutMs?: number;
}): Promise<{ hits: CdxHit[]; evidence: string }> {
  const q = new URL('https://web.archive.org/cdx/search/cdx');
  q.searchParams.set('url', params.url);
  q.searchParams.set('output', 'json');
  q.searchParams.set('fl', 'timestamp,original,statuscode,mime');
  q.searchParams.set('limit', String(params.limit ?? 20));
  if (params.from) q.searchParams.set('from', params.from);
  if (params.to) q.searchParams.set('to', params.to);
  if (params.filterStatus) q.searchParams.set('filter', `statuscode:${params.filterStatus}`);
  else q.searchParams.set('filter', 'statuscode:200');
  if (params.collapse) q.searchParams.set('collapse', params.collapse);
  try {
    const r = await httpGet(q.toString(), { timeoutMs: params.timeoutMs ?? 90_000, retries: 2, acceptIdentity: true });
    if (r.status !== 200) return { hits: [], evidence: `wayback-cdx HTTP ${r.status} size=${r.body.length}` };
    if (/Temporarily Offline|503/i.test(r.text.slice(0, 500))) return { hits: [], evidence: 'wayback-cdx temporarily offline' };
    let rows: any[] = [];
    try { rows = JSON.parse(r.text); } catch { return { hits: [], evidence: 'wayback-cdx non-json' }; }
    if (!Array.isArray(rows) || rows.length < 2) return { hits: [], evidence: `wayback-cdx empty (${r.body.length}b)` };
    const header = rows[0].map((x: string) => String(x).toLowerCase());
    const hits: CdxHit[] = [];
    for (const row of rows.slice(1)) {
      const o: any = {};
      header.forEach((h: string, i: number) => { o[h] = row[i]; });
      hits.push({ timestamp: o.timestamp, original: o.original, statuscode: o.statuscode, mime: o.mime });
    }
    return { hits, evidence: `wayback-cdx ${hits.length} hits` };
  } catch (e: any) {
    return { hits: [], evidence: 'wayback-cdx error: ' + String(e?.message || e).slice(0, 160) };
  }
}

/** Wayback available API（比 CDX 更稳） */
export async function waybackAvailable(url: string, timeoutMs = 30_000): Promise<{ snapshotUrl: string | null; timestamp: string | null; evidence: string }> {
  try {
    let r = await httpGet(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { timeoutMs, retries: 1 });
    if (r.status === 429) {
      await sleep(4000);
      r = await httpGet(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { timeoutMs, retries: 1 });
    }
    if (r.status !== 200) return { snapshotUrl: null, timestamp: null, evidence: `wayback-available HTTP ${r.status}` };
    const j = JSON.parse(r.text);
    const closest = j?.archived_snapshots?.closest;
    if (closest?.available && closest?.url) {
      return { snapshotUrl: String(closest.url).replace(/^http:/, 'https:'), timestamp: closest.timestamp || null, evidence: `wayback-available ${closest.timestamp} status=${closest.status}` };
    }
    return { snapshotUrl: null, timestamp: null, evidence: 'wayback-available no snapshot' };
  } catch (e: any) {
    return { snapshotUrl: null, timestamp: null, evidence: 'wayback-available error: ' + String(e?.message || e).slice(0, 120) };
  }
}

/** 拉 Wayback 快照 HTML（优先 identity，避免 zstd/id_ 二进制） */
export async function fetchWaybackSnapshot(snapshotOrTsAndUrl: { snapshotUrl?: string; timestamp?: string; original?: string }, timeoutMs = 90_000): Promise<ArchiveFetchResult> {
  let url = snapshotOrTsAndUrl.snapshotUrl || '';
  if (!url && snapshotOrTsAndUrl.timestamp && snapshotOrTsAndUrl.original) {
    url = `https://web.archive.org/web/${snapshotOrTsAndUrl.timestamp}/${snapshotOrTsAndUrl.original}`;
  }
  if (!url) return { ok: false, channel: 'wayback', url: '', status: 0, html: '', evidence: 'no snapshot url' };
  // 去掉 id_ 以免拿压缩体；改成普通回放页
  url = url.replace(/\/web\/(\d+)id_\//, '/web/$1/');
  try {
    const r = await httpGet(url, { timeoutMs, retries: 2, acceptIdentity: true });
    const html = stripWaybackToolbar(r.text);
    const ok = r.status >= 200 && r.status < 400 && html.length > 500 && !isChallengeHtml(html, r.status);
    return {
      ok, channel: 'wayback', url, finalUrl: r.finalUrl, status: r.status, html: ok ? html : r.text,
      evidence: `wayback-snapshot HTTP ${r.status} size=${r.body.length}${ok ? '' : ' (empty/challenge)'}`,
    };
  } catch (e: any) {
    return { ok: false, channel: 'wayback', url, status: 0, html: '', evidence: 'wayback-snapshot error: ' + String(e?.message || e).slice(0, 160) };
  }
}

export function stripWaybackToolbar(html: string): string {
  return html
    .replace(/<!-- BEGIN WAYBACK TOOLBAR INSERT -->[\s\S]*?<!-- END WAYBACK TOOLBAR INSERT -->/i, '')
    .replace(/<script[^>]+web-static\.archive\.org[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]+_static\/js\/(?:bundle-playback|wombat)[^>]*>[\s\S]*?<\/script>/gi, '');
}

/** Common Crawl：读 collinfo，按新→旧尝试索引 */
let _ccIndexes: { id: string; cdx: string }[] | null = null;
export async function listCommonCrawlIndexes(timeoutMs = 45_000): Promise<{ id: string; cdx: string }[]> {
  if (_ccIndexes) return _ccIndexes;
  const r = await httpGet('https://index.commoncrawl.org/collinfo.json', { timeoutMs, retries: 2 });
  if (r.status !== 200) throw new Error('CC collinfo HTTP ' + r.status);
  const arr = JSON.parse(r.text) as any[];
  _ccIndexes = arr.map(x => ({ id: x.id, cdx: x['cdx-api'] || `https://index.commoncrawl.org/${x.id}-index` }));
  return _ccIndexes!;
}

export async function commonCrawlQuery(urlPattern: string, opts: { limit?: number; maxIndexes?: number; timeoutMs?: number } = {}): Promise<{ hits: CdxHit[]; evidence: string; indexId?: string }> {
  const limit = opts.limit ?? 10;
  const maxIndexes = opts.maxIndexes ?? 6;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const evidence: string[] = [];
  let indexes: { id: string; cdx: string }[] = [];
  try {
    const all = await listCommonCrawlIndexes();
    // 取最近若干 + 中段 + 更早（如 2024），避免只打到持续 504 的新索引
    const picks: { id: string; cdx: string }[] = [];
    const take = (arr: typeof all, n: number) => { for (const x of arr) { if (picks.length >= maxIndexes) break; if (!picks.find(p => p.id === x.id)) picks.push(x); } };
    take(all.slice(0, 3), 3);
    take(all.slice(8, 12), 2);
    take(all.filter(x => /2024|2025/.test(x.id)).slice(0, 4), 4);
    indexes = picks.slice(0, maxIndexes);
  } catch (e: any) { return { hits: [], evidence: 'cc-collinfo failed: ' + String(e?.message || e).slice(0, 120) }; }

  for (const idx of indexes) {
    const q = `${idx.cdx}?url=${encodeURIComponent(urlPattern)}&output=json&limit=${limit}&filter=status:200`;
    try {
      const r = await httpGet(q, { timeoutMs, retries: 1 });
      evidence.push(`${idx.id}→HTTP ${r.status}/${r.body.length}b`);
      if (r.status === 404) continue;
      if (r.status === 504 || r.status === 503) { await sleep(2000); continue; }
      if (r.status !== 200) continue;
      const hits: CdxHit[] = [];
      for (const line of r.text.split(/\n+/)) {
        const t = line.trim(); if (!t.startsWith('{')) continue;
        try {
          const j = JSON.parse(t);
          hits.push({
            timestamp: j.timestamp, original: j.url || j.original, statuscode: String(j.status || j.statuscode || ''),
            mime: j.mime, filename: j.filename, offset: String(j.offset ?? ''), length: String(j.length ?? ''), digest: j.digest, url: j.url,
          });
        } catch { /* */ }
      }
      if (hits.length) return { hits, evidence: evidence.join('; '), indexId: idx.id };
    } catch (e: any) {
      evidence.push(`${idx.id}→err ${String(e?.message || e).slice(0, 60)}`);
    }
  }
  return { hits: [], evidence: 'cc-query miss: ' + evidence.join('; ') };
}

/** 从 Common Crawl WARC.gz 按 offset/length 拉单条记录并抽出 HTML */
export async function fetchCommonCrawlRecord(hit: CdxHit, timeoutMs = 120_000): Promise<ArchiveFetchResult> {
  if (!hit.filename || hit.offset == null || hit.length == null) {
    return { ok: false, channel: 'commoncrawl', url: hit.original || '', status: 0, html: '', evidence: 'cc-record missing filename/offset/length' };
  }
  const offset = parseInt(String(hit.offset), 10);
  const length = parseInt(String(hit.length), 10);
  const end = offset + length - 1;
  const url = `https://data.commoncrawl.org/${hit.filename}`;
  try {
    const r = await httpGet(url, {
      timeoutMs, retries: 2,
      headers: { Range: `bytes=${offset}-${end}`, 'user-agent': ARCHIVE_UA },
    });
    if (!(r.status === 200 || r.status === 206)) {
      return { ok: false, channel: 'commoncrawl', url: hit.original || url, status: r.status, html: '', evidence: `cc-warc HTTP ${r.status}` };
    }
    let raw = r.body;
    // Record itself is gzip-compressed
    try { raw = gunzipSync(raw); } catch { /* maybe already inflated */ }
    const text = raw.toString('utf8');
    const sep = text.indexOf('\r\n\r\n');
    // WARC header then HTTP header then body
    let html = '';
    if (sep >= 0) {
      const afterWarc = text.slice(sep + 4);
      const sep2 = afterWarc.indexOf('\r\n\r\n');
      html = sep2 >= 0 ? afterWarc.slice(sep2 + 4) : afterWarc;
    } else {
      html = text;
    }
    // trim trailing WARC padding
    const htmlEnd = html.search(/\r?\nWARC\/1\./);
    if (htmlEnd > 0) html = html.slice(0, htmlEnd);
    const ok = html.length > 400 && !isChallengeHtml(html, 200);
    return {
      ok, channel: 'commoncrawl', url: hit.original || url, status: ok ? 200 : 0, html: ok ? html : html.slice(0, 2000),
      evidence: `cc-warc ${hit.filename?.split('/').pop()} @${offset} len=${html.length} ok=${ok}`,
    };
  } catch (e: any) {
    return { ok: false, channel: 'commoncrawl', url: hit.original || url, status: 0, html: '', evidence: 'cc-warc error: ' + String(e?.message || e).slice(0, 160) };
  }
}

/** 解码基础 HTML 实体 */
function dec(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

const NOISE = /^(see project|home|about|login|sign ?up|blog|help|create|join|for vendors|compare|categories|privacy|terms|contact|download|next|previous|more|alternatives|official partner)$/i;

/** Wayback 回放会把链接改写成 /web/TS/https://host/... —— 解析前还原 */
export function unwrapWaybackHref(href: string): string {
  const m = href.match(/\/web\/\d+(?:id_)?\/(https?:\/\/[^"'\s]+)/i);
  if (m) return m[1];
  const m2 = href.match(/\/web\/\d+(?:id_)?\/(https?:\/)?\/*([^"'\s]+)/i);
  if (m2 && m2[2] && !m2[2].startsWith('web/')) {
    const rest = m2[2];
    if (/^https?:\/\//i.test(rest)) return rest;
  }
  return href;
}

function slugToName(slug: string): string {
  return decodeURIComponent(slug)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

function anchorText(inner: string): string {
  return dec(inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

/** SourceForge 目录页：/projects/{slug}/ （兼容 Wayback 改写与 ?source=directory） */
export function parseSourceForgeDirectory(html: string, pageUrl = 'https://sourceforge.net/directory/'): ArchiveProductCandidate[] {
  const out: ArchiveProductCandidate[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href="([^"]*?\/projects\/([a-zA-Z0-9._+-]+)\/?[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = unwrapWaybackHref(m[1]);
    const slug = m[2];
    if (/\/(reviews|files|stats|mirror)\b/i.test(href)) continue;
    let name = anchorText(m[3]);
    name = name.replace(/^find out more about\s+/i, '').replace(/^see project$/i, '').trim();
    if (!name || NOISE.test(name) || name.length < 2 || name.length > 100) {
      const titleM = m[0].match(/\btitle="([^"]{2,100})"/i);
      name = titleM ? dec(titleM[1]).replace(/^find out more about\s+/i, '').trim() : '';
    }
    if (!name || NOISE.test(name) || name.length < 2) name = slugToName(slug.replace(/\.mirror$/i, ''));
    if (!name || NOISE.test(name)) continue;
    const detail = `https://sourceforge.net/projects/${slug}/`;
    if (seen.has(slug)) {
      // 同一 slug 多次出现时保留更像产品名的文本
      const prev = out.find(x => x.detailUrl === detail);
      if (prev && name.length > prev.name.length && !/^see /i.test(name)) prev.name = name;
      continue;
    }
    seen.add(slug);
    out.push({ name, url: detail, detailUrl: detail, description: null, source: 'SourceForge', channel: 'wayback', evidence: pageUrl });
  }
  for (const sm of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(sm[1]);
      const visit = (o: any) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach(visit);
        if (o['@graph']) visit(o['@graph']);
        if (o['@type'] === 'ItemList' && o.itemListElement) {
          for (const el of [].concat(o.itemListElement)) {
            const it: any = (el as any).item || el;
            const name = String(it?.name || '').trim();
            const u = String(it?.url || (el as any).url || '');
            const slug = u.match(/\/projects\/([a-zA-Z0-9._+-]+)/)?.[1];
            if (!name || !slug || seen.has(slug) || NOISE.test(name)) continue;
            seen.add(slug);
            out.push({ name, url: `https://sourceforge.net/projects/${slug}/`, detailUrl: `https://sourceforge.net/projects/${slug}/`, source: 'SourceForge', channel: 'wayback', evidence: 'jsonld' });
          }
        }
      };
      visit(j);
    } catch { /* */ }
  }
  return out;
}

/** AlternativeTo：/software/{slug}/（兼容 Wayback 绝对回放链接） */
export function parseAlternativeTo(html: string, pageUrl = 'https://alternativeto.net/'): ArchiveProductCandidate[] {
  const out: ArchiveProductCandidate[] = [];
  const seen = new Set<string>();
  const re = /href="([^"]*?\/software\/([a-zA-Z0-9._+-]+)(?:\/about)?\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const slug = m[2];
    if (/^(browse|category|tag|about|login|platform|feature|license|interest)$/i.test(slug)) continue;
    let name = anchorText(m[3]);
    if (!name || NOISE.test(name) || name.length < 2 || name.length > 80) name = slugToName(slug);
    if (NOISE.test(name) || seen.has(slug)) continue;
    seen.add(slug);
    const detail = `https://alternativeto.net/software/${slug}/`;
    out.push({ name, url: detail, detailUrl: detail, source: 'AlternativeTo', channel: 'wayback', evidence: pageUrl });
  }
  return out;
}

/** SaaSHub：产品详情路径（过滤 best-* 清单与 *-alternatives） */
export function parseSaaSHub(html: string, pageUrl = 'https://saashub.com/'): ArchiveProductCandidate[] {
  const out: ArchiveProductCandidate[] = [];
  const seen = new Set<string>();
  const BAD = /^(app|apps|categories|category|compare|alternatives|about|blog|login|signup|register|pricing|features|privacy|terms|search|tags|collections|vendors|submit|api|startups|newsletter|experts|community|eu|featured-products|status|opensearch\.xml|robots\.txt|favicon)$/i;
  const re = /href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = unwrapWaybackHref(m[1]).split('#')[0].split('?')[0];
    const mm = href.match(/^https?:\/\/(?:www\.)?saashub\.com\/(?:app\/)?([a-zA-Z0-9][a-zA-Z0-9._+-]{1,60})\/?$/i)
      || href.match(/^\/(?:app\/)?([a-zA-Z0-9][a-zA-Z0-9._+-]{1,60})\/?$/i);
    if (!mm) continue;
    const slug = mm[1];
    if (BAD.test(slug) || /^best-/i.test(slug) || /-alternatives$/i.test(slug) || /-status$/i.test(slug) || /\.(xml|txt|json|css|js)$/i.test(slug)) continue;
    if (seen.has(slug.toLowerCase())) continue;
    seen.add(slug.toLowerCase());
    const detail = `https://www.saashub.com/${slug}`;
    out.push({ name: slugToName(slug), url: detail, detailUrl: detail, source: 'SaaSHub', channel: 'wayback', evidence: pageUrl });
  }
  return out;
}

/** F6S 公司页（若归档有） */
export function parseF6S(html: string, pageUrl = 'https://www.f6s.com/companies'): ArchiveProductCandidate[] {
  const out: ArchiveProductCandidate[] = [];
  const seen = new Set<string>();
  const re = /href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const BAD = /^(companies|about|login|signup|jobs|blog|programs|city|investors|home|search|terms|privacy)$/i;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = unwrapWaybackHref(m[1]);
    const mm = href.match(/f6s\.com\/([a-zA-Z0-9._+-]+)\/?$/i);
    if (!mm) continue;
    const slug = mm[1];
    if (BAD.test(slug) || slug.includes('.')) continue;
    let name = anchorText(m[2]);
    if (!name || NOISE.test(name) || name.length < 2 || name.length > 80) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name, url: `https://www.f6s.com/${slug}`, detailUrl: `https://www.f6s.com/${slug}`, source: 'F6S', channel: 'wayback', evidence: pageUrl });
  }
  return out;
}

export type SiteKind = 'sourceforge' | 'alternativeto' | 'saashub' | 'f6s' | 'generic';

export function parseProductsFromArchive(kind: SiteKind, html: string, pageUrl: string, channel: ArchiveChannel = 'wayback'): ArchiveProductCandidate[] {
  let items: ArchiveProductCandidate[] = [];
  if (kind === 'sourceforge') items = parseSourceForgeDirectory(html, pageUrl);
  else if (kind === 'alternativeto') items = parseAlternativeTo(html, pageUrl);
  else if (kind === 'saashub') items = parseSaaSHub(html, pageUrl);
  else if (kind === 'f6s') items = parseF6S(html, pageUrl);
  else {
    // generic: software/product/project path heuristics
    items = [
      ...parseSourceForgeDirectory(html, pageUrl),
      ...parseAlternativeTo(html, pageUrl),
      ...parseSaaSHub(html, pageUrl),
    ];
  }
  return items.map(i => ({ ...i, channel }));
}

/**
 * 统一入口：直连探测 → 若挑战则 Wayback available/CDX → Common Crawl。
 * 返回产品候选 + 通道证据（不做任何挑战绕过）。
 */
export async function resolveViaPublicArchives(opts: {
  name: string;
  kind: SiteKind;
  directUrls: string[];
  archiveUrls: string[]; // paths to look up in wayback/CC
  ccPatterns?: string[];
  log?: (s: string) => void;
}): Promise<{
  challenged: boolean;
  probes: FetchProbe[];
  items: ArchiveProductCandidate[];
  channelsUsed: ArchiveChannel[];
  evidence: string[];
}> {
  const log = opts.log || (() => {});
  const evidence: string[] = [];
  const channelsUsed: ArchiveChannel[] = [];
  const items: ArchiveProductCandidate[] = [];
  const seen = new Set<string>();

  const add = (arr: ArchiveProductCandidate[]) => {
    for (const it of arr) {
      const k = (it.name + '|' + it.url).toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(it);
    }
  };

  log(`probe direct ${opts.name}`);
  const probes = await probeDirect(opts.directUrls);
  for (const p of probes) evidence.push(`direct ${p.url} → HTTP ${p.status} ${p.reason || ''}`.trim());
  const anyOpen = probes.some(p => !p.challenged && p.status >= 200 && p.status < 400 && p.size > 500);
  const challenged = !anyOpen;

  // 若直连可用且非挑战，调用方也可自行抓；这里仍尝试存档作增量补充
  if (anyOpen) {
    channelsUsed.push('direct');
    // 尝试用直连 HTML（重新拉第一个通的）
    const open = probes.find(p => !p.challenged)!;
    try {
      const r = await httpGet(open.url, { timeoutMs: 45_000, acceptIdentity: true, retries: 1 });
      if (!isChallengeHtml(r.text, r.status)) {
        add(parseProductsFromArchive(opts.kind, r.text, open.url, 'direct'));
        evidence.push(`direct-parse ${open.url} → ${items.length} candidates`);
      }
    } catch (e: any) {
      evidence.push('direct-parse fail: ' + String(e?.message || e).slice(0, 80));
    }
  }

  // Wayback available for each archive URL
  log(`wayback available ${opts.name}`);
  for (const u of opts.archiveUrls) {
    await sleep(600);
    const av = await waybackAvailable(u);
    evidence.push(`${u}: ${av.evidence}`);
    if (!av.snapshotUrl) continue;
    const snap = await fetchWaybackSnapshot({ snapshotUrl: av.snapshotUrl });
    evidence.push(snap.evidence);
    if (snap.ok) {
      channelsUsed.push('wayback');
      add(parseProductsFromArchive(opts.kind, snap.html, u, 'wayback'));
    }
  }

  // Common Crawl：Wayback 已够用时只补 1 次精确查询，避免通配 504 拖死
  const patterns = opts.ccPatterns || opts.archiveUrls.map(u => {
    try { const x = new URL(u.startsWith('http') ? u : 'https://' + u); return x.origin + x.pathname; } catch { return u; }
  });
  const needCc = items.length < 15;
  if (needCc) {
    log(`common crawl ${opts.name}`);
    for (const pat of patterns.slice(0, 2)) {
      const urlPat = pat.startsWith('http') ? pat : (pat.includes('*') ? pat : `https://${pat.replace(/^\/*/, '')}`);
      const q = await commonCrawlQuery(urlPat, { limit: 4, maxIndexes: 4 });
      evidence.push(q.evidence + (q.indexId ? ` [${q.indexId}]` : ''));
      for (const hit of q.hits.slice(0, 1)) {
        const rec = await fetchCommonCrawlRecord(hit);
        evidence.push(rec.evidence);
        if (rec.ok) {
          channelsUsed.push('commoncrawl');
          add(parseProductsFromArchive(opts.kind, rec.html, hit.original || pat, 'commoncrawl'));
        }
      }
    }
  } else {
    evidence.push('commoncrawl skipped (wayback/direct already yielded enough candidates)');
  }

  return {
    challenged,
    probes,
    items,
    channelsUsed: [...new Set(channelsUsed)],
    evidence,
  };
}

export const CF_PRIORITY_TARGETS: {
  name: string; kind: SiteKind; seqHint?: number;
  directUrls: string[]; archiveUrls: string[]; ccPatterns?: string[];
}[] = [
  {
    name: 'SourceForge', kind: 'sourceforge',
    directUrls: [
      'https://sourceforge.net/directory/',
      'https://sourceforge.net/rest/p/',
      'https://sourceforge.net/directory/?sort=update',
    ],
    archiveUrls: [
      'sourceforge.net/directory/',
      'sourceforge.net/directory/?page=2',
      'sourceforge.net/directory/?page=3',
      'sourceforge.net/directory/?sort=update',
      'sourceforge.net/directory/communications/',
      'sourceforge.net/directory/games/',
      'sourceforge.net/directory/graphics/',
      'sourceforge.net/directory/development/',
      'sourceforge.net/directory/audio-video/',
      'sourceforge.net/directory/business-enterprise/',
      'sourceforge.net/directory/home-education/',
      'sourceforge.net/directory/science-engineering/',
      'sourceforge.net/directory/security-utilities/',
      'sourceforge.net/directory/system-administration/',
    ],
    ccPatterns: ['https://sourceforge.net/directory/', 'sourceforge.net/directory/*'],
  },
  {
    name: 'AlternativeTo', kind: 'alternativeto',
    directUrls: ['https://alternativeto.net/', 'https://alternativeto.net/sitemap.xml'],
    archiveUrls: ['alternativeto.net/', 'alternativeto.net/software/'],
    ccPatterns: ['https://alternativeto.net/', 'alternativeto.net/software/*'],
  },
  {
    name: 'SaaSHub', kind: 'saashub',
    directUrls: ['https://saashub.com/', 'https://www.saashub.com/', 'https://saashub.com/sitemap.xml'],
    archiveUrls: ['saashub.com/', 'www.saashub.com/'],
    ccPatterns: ['https://www.saashub.com/', 'https://saashub.com/'],
  },
  {
    name: 'F6S', kind: 'f6s',
    directUrls: ['https://www.f6s.com/companies', 'https://f6s.com/companies', 'https://www.f6s.com/sitemap.xml'],
    archiveUrls: ['www.f6s.com/companies', 'f6s.com/companies'],
    ccPatterns: ['https://www.f6s.com/companies'],
  },
];
