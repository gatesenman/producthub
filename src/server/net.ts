/**
 * v1.9.1 统一网络层：代理（跟随系统 / 手动 HTTP·SOCKS5 / 不用）、超时、重试退避、并发、按站点限速、User-Agent。
 * - 桌面版：Electron 主进程注册 Chromium 网络栈传输（session.fetch），真正跟随系统代理 / PAC / 手动代理。
 * - 独立服务 / 测试：Node http(s) + https-proxy-agent / socks-proxy-agent；“跟随系统”读取 HTTPS_PROXY 等环境变量。
 * 只走公开通道：不做任何挑战绕过、指纹伪造。
 */
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

export type ProxyMode = 'system' | 'manual' | 'none';
export interface NetConfig { proxyMode: ProxyMode; proxyUrl: string; timeoutMs: number; retries: number; concurrency: number; intervalMs: number; userAgent: string }
export const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 ProductHub/1.9';
export const DEFAULT_NET: NetConfig = { proxyMode: 'system', proxyUrl: '', timeoutMs: 25_000, retries: 2, concurrency: 4, intervalMs: 800, userAgent: '' };
/** 单次请求的代理选择：inherit=按全局；direct=本源不走代理；proxy=强制走代理（全局为“不用”时按系统） */
export type ProxyChoice = 'inherit' | 'direct' | 'proxy';
export interface ReqOpts { headers?: Record<string, string>; timeoutMs?: number; retries?: number; proxy?: ProxyChoice; intervalMs?: number; method?: string; body?: string | Buffer; maxBytes?: number; noRetryOn?: number[]; /** 不因 HTTP 状态抛错（仍对 429/5xx 重试） */ raw?: boolean }
export interface RawResponse { status: number; headers: Record<string, string>; body: Buffer; finalUrl: string }
export interface NetResponse extends RawResponse { text: string; contentType: string; attempts: number; ms: number }
/** 传输层：按“解析后的代理”发请求（不含重试/限速） */
export type Transport = (url: string, o: { method: string; body?: string | Buffer; headers: Record<string, string>; timeoutMs: number; proxy: ResolvedProxy; maxBytes: number }) => Promise<RawResponse>;
export type ResolvedProxy = { kind: 'system' } | { kind: 'direct' } | { kind: 'manual'; url: string };

let cfg: NetConfig = { ...DEFAULT_NET };
let transport: Transport | null = null;
export function getNetConfig(): NetConfig { return { ...cfg }; }
export function configureNet(c: Partial<NetConfig>) { cfg = normalizeNet({ ...cfg, ...c }); sem.setMax(cfg.concurrency); }
export function setTransport(t: Transport | null) { transport = t; }
export function transportName() { return transport ? 'chromium' : 'node'; }
export function normalizeNet(c: Partial<NetConfig>): NetConfig {
  const n = (v: any, d: number, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
  const mode = (['system', 'manual', 'none'] as const).includes(c.proxyMode as any) ? c.proxyMode as ProxyMode : 'system';
  return { proxyMode: mode, proxyUrl: String(c.proxyUrl || '').trim(), timeoutMs: n(c.timeoutMs, DEFAULT_NET.timeoutMs, 3000, 180_000), retries: n(c.retries, DEFAULT_NET.retries, 0, 6), concurrency: n(c.concurrency, DEFAULT_NET.concurrency, 1, 16), intervalMs: n(c.intervalMs, DEFAULT_NET.intervalMs, 0, 60_000), userAgent: String(c.userAgent || '').trim() };
}
/** 校验手动代理地址：http://host:port、https://、socks5://、socks5h://、socks4://；允许省略协议（按 http） */
export function parseProxyUrl(s: string): { ok: true; url: string } | { ok: false; error: string } {
  let t = String(s || '').trim(); if (!t) return { ok: false, error: '请填写代理地址，例如 127.0.0.1:7897 或 socks5://127.0.0.1:7898' };
  if (!/^[a-z0-9]+:\/\//i.test(t)) t = 'http://' + t;
  try { const u = new URL(t); if (!/^(https?|socks5h?|socks4a?|socks):$/.test(u.protocol)) return { ok: false, error: '代理只支持 http / https / socks5 / socks4' }; if (!u.hostname || !u.port) return { ok: false, error: '代理地址需包含主机和端口，例如 127.0.0.1:7897' }; return { ok: true, url: u.toString().replace(/\/$/, '') }; }
  catch { return { ok: false, error: '代理地址格式不对，例如 127.0.0.1:7897' }; }
}
export function resolveProxy(choice: ProxyChoice = 'inherit', c: NetConfig = cfg): ResolvedProxy {
  if (choice === 'direct') return { kind: 'direct' };
  if (c.proxyMode === 'manual') { const p = parseProxyUrl(c.proxyUrl); if (p.ok) return { kind: 'manual', url: p.url }; return { kind: 'system' }; }
  if (c.proxyMode === 'none') return choice === 'proxy' ? { kind: 'system' } : { kind: 'direct' };
  return { kind: 'system' };
}

// ---------- 失败分类 ----------
export type FailKind = 'network' | 'dns' | 'timeout' | 'tls' | 'proxy' | 'challenge' | 'forbidden' | 'rate_limited' | 'not_found' | 'server' | 'js_required' | 'empty' | 'browser_unavailable' | 'code';
export const FAIL_LABEL: Record<FailKind, string> = {
  network: '网络连不上，可能需要代理', dns: '域名解析失败：网站可能已关闭，或需要代理', timeout: '连接超时：可能需要代理，或调大超时', tls: '安全连接（证书/TLS）失败',
  proxy: '代理连不上：请检查代理地址，或代理软件是否开着', challenge: '网站有人机验证（Cloudflare 等）：已改走浏览器模式 / 公开存档', forbidden: '网站拒绝访问（403 / 4xx 反爬）',
  rate_limited: '被限流，稍后自动重试', not_found: '入口页面不存在（404），请修改入口 URL', server: '网站服务器出错（5xx），稍后重试',
  js_required: '页面靠 JS 加载，需用浏览器模式', empty: '页面打开了，但没识别到产品：可换浏览器模式或填写选择器', browser_unavailable: '浏览器模式只在桌面版可用', code: '程序异常',
};
export class CrawlError extends Error {
  kind: FailKind; status?: number; url?: string;
  constructor(kind: FailKind, message: string, extra: { status?: number; url?: string } = {}) { super(message); this.kind = kind; this.status = extra.status; this.url = extra.url; this.name = 'CrawlError'; }
}
const CHALLENGE_RE = /Just a moment|Checking your browser|Verifying (you are human|your connection)|cf-browser-verification|cf-chl|challenge-platform|__cf_chl|cdn-cgi\/challenge|Attention Required|Enable JavaScript and cookies to continue|Security Checkpoint|captcha-delivery|datadome|px-captcha|hcaptcha\.com\/1\/api|g-recaptcha|人机验证|安全验证|滑动验证/i;
export function isChallenge(status: number, headers: Record<string, string>, text: string): boolean {
  if ((headers['cf-mitigated'] || '').includes('challenge')) return true;
  if (status === 403 || status === 412 || status === 429 || status === 503) return CHALLENGE_RE.test(text.slice(0, 20000)) || (/cloudflare/i.test(headers.server || '') && status !== 429);
  return status < 300 && text.length < 30000 && /Just a moment|cf-chl|challenge-platform|Checking your browser/i.test(text.slice(0, 20000));
}
/** 把 HTTP 状态 / 异常 归类为 FailKind */
export function classifyFailure(e: any): FailKind {
  if (e instanceof CrawlError) return e.kind;
  if (e?.kind && FAIL_LABEL[e.kind as FailKind]) return e.kind;
  const s = [e?.code, e?.cause?.code, e?.message, e?.cause?.message, e?.name].filter(Boolean).join(' ');
  if (/ERR_PROXY|ERR_TUNNEL|ERR_SOCKS|proxy|Socks/i.test(s)) return 'proxy';
  if (/TOO_MANY_REDIRECTS|ERR_INVALID_RESPONSE|ERR_HTTP2/i.test(s)) return 'server';
  if (/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|getaddrinfo/i.test(s)) return 'dns';
  if (/timeout|timed out|ETIMEDOUT|ERR_TIMED_OUT|UND_ERR_CONNECT_TIMEOUT|aborted due to timeout|TimeoutError/i.test(s)) return 'timeout';
  if (/CERT|SSL|TLS|ERR_SSL|self.signed|unable to verify|ERR_CERT/i.test(s)) return 'tls';
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE|socket hang up|fetch failed|ERR_CONNECTION|ERR_NETWORK|ERR_INTERNET_DISCONNECTED|ERR_ADDRESS_UNREACHABLE|ERR_EMPTY_RESPONSE|other side closed|net::/i.test(s)) return 'network';
  const m = String(e?.message || '').match(/HTTP (\d{3})/); if (m) return kindOfStatus(+m[1]);
  return 'code';
}
export function kindOfStatus(st: number): FailKind { return st === 429 ? 'rate_limited' : st === 404 || st === 410 ? 'not_found' : st >= 500 ? 'server' : st >= 400 ? 'forbidden' : 'code'; }
export function failLabel(kind: FailKind | string | null | undefined, extra = ''): string { const l = FAIL_LABEL[(kind || 'code') as FailKind] || String(kind); return extra ? `${l}（${extra}）` : l; }
const RETRYABLE: FailKind[] = ['timeout', 'network', 'rate_limited', 'server', 'proxy'];

// ---------- 并发与限速 ----------
class Sem { private n = 0; private q: (() => void)[] = []; constructor(private max: number) {} setMax(m: number) { this.max = m; this.pump(); }
  async acquire() { if (this.n < this.max) { this.n++; return; } await new Promise<void>(r => this.q.push(r)); }
  release() { this.n--; this.pump(); } private pump() { while (this.q.length && this.n < this.max) { this.n++; this.q.shift()!(); } } }
const sem = new Sem(DEFAULT_NET.concurrency);
const lastHit = new Map<string, number>();
async function throttle(host: string, gap: number) {
  if (gap <= 0) return; const t = lastHit.get(host) || 0; const wait = t + gap - Date.now(); lastHit.set(host, Math.max(Date.now(), t + gap));
  if (wait > 0) await sleep(wait);
}
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export function retryAfterMs(h: Record<string, string>): number | null { const v = h['retry-after']; if (!v) return null; const s = Number(v); if (Number.isFinite(s)) return Math.min(60_000, s * 1000); const d = Date.parse(v); return Number.isFinite(d) ? Math.min(60_000, Math.max(0, d - Date.now())) : null; }
export function backoffMs(attempt: number, base = 1000) { return Math.min(30_000, base * 2 ** attempt) + Math.floor(Math.random() * 300); }

const ARCHIVE_HOST = /(^|\.)(archive\.org|commoncrawl\.org)(:\d+)?$/i;
/** 统一请求：限速 → 并发 → 传输 → 失败分类 → 可重试错误指数退避（429 读 Retry-After） */
export async function request(url: string, o: ReqOpts = {}): Promise<NetResponse> {
  const c = cfg; const t0 = Date.now(); const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  const retries = o.retries ?? c.retries; const timeoutMs = o.timeoutMs ?? c.timeoutMs; const proxy = resolveProxy(o.proxy, c);
  const headers = { 'user-agent': c.userAgent || DEFAULT_UA, accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8', ...(o.headers || {}) };
  let last: any; let attempt = 0;
  for (; attempt <= retries; attempt++) {
    await throttle(host, o.intervalMs ?? c.intervalMs);
    await sem.acquire();
    let r: RawResponse | null = null;
    // 公开存档站对部分 Chromium 请求回 5xx：第二次起改用 Node 传输（仍走所配代理）
    const tp = transport && attempt > 0 && ARCHIVE_HOST.test(host) && last?.status >= 500 ? nodeTransport : (transport || nodeTransport);
    try { r = await tp(url, { method: o.method || 'GET', body: o.body, headers, timeoutMs, proxy, maxBytes: o.maxBytes ?? 6_000_000 }); }
    catch (e) { last = e; } finally { sem.release(); }
    if (r) {
      const text = decodeText(r.body, r.headers['content-type'] || '');
      if (r.status < 400 || (o.noRetryOn || []).includes(r.status)) return { ...r, text, contentType: r.headers['content-type'] || '', attempts: attempt + 1, ms: Date.now() - t0 };
      const resp = { ...r, text, contentType: r.headers['content-type'] || '', attempts: attempt + 1, ms: Date.now() - t0 };
      if (o.raw && (!RETRYABLE.includes(kindOfStatus(r.status)) || attempt >= retries)) return resp;
      last = { status: r.status };
      if (isChallenge(r.status, r.headers, text)) throw Object.assign(new CrawlError('challenge', `HTTP ${r.status} 人机验证`, { status: r.status, url }), { response: { ...r, text } });
      const kind = kindOfStatus(r.status);
      last = Object.assign(new CrawlError(kind, `HTTP ${r.status}`, { status: r.status, url }), { response: { ...r, text } });
      if (!RETRYABLE.includes(kind) || attempt >= retries) throw last;
      await sleep(retryAfterMs(r.headers) ?? backoffMs(attempt)); continue;
    }
    const kind = classifyFailure(last);
    if (!RETRYABLE.includes(kind) || attempt >= retries) break;
    await sleep(backoffMs(attempt, 700));
  }
  const kind = classifyFailure(last);
  throw new CrawlError(kind, `${failLabel(kind)}：${String(last?.cause?.code || last?.code || last?.message || last).slice(0, 120)}`, { url });
}
function decodeText(b: Buffer, ct: string): string {
  const cs = (ct.match(/charset=([\w-]+)/i)?.[1] || '').toLowerCase();
  if (cs && cs !== 'utf-8' && cs !== 'utf8') { try { return new TextDecoder(cs).decode(b); } catch { /* */ } }
  const s = b.toString('utf8'); if (!cs) { const m = s.slice(0, 2000).match(/<meta[^>]+charset=["']?([\w-]+)/i); if (m && !/utf-?8/i.test(m[1])) { try { return new TextDecoder(m[1].toLowerCase()).decode(b); } catch { /* */ } } }
  return s;
}

// ---------- Node 传输（独立服务 / 测试 / 无 Electron） ----------
function envProxy(url: string): string | null {
  const e = process.env; const isHttps = url.startsWith('https:'); const v = (isHttps ? e.HTTPS_PROXY || e.https_proxy : e.HTTP_PROXY || e.http_proxy) || e.ALL_PROXY || e.all_proxy;
  const no = (e.NO_PROXY || e.no_proxy || '').split(',').map(s => s.trim()).filter(Boolean); const h = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (no.some(n => n === '*' || h === n.replace(/^\./, '') || h.endsWith(n.startsWith('.') ? n : '.' + n))) return null;
  return v || null;
}
const agentCache = new Map<string, any>();
function agentFor(proxyUrl: string, https_: boolean) {
  const k = proxyUrl + '|' + https_; let a = agentCache.get(k); if (a) return a;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (/^socks/i.test(proxyUrl)) { const { SocksProxyAgent } = require('socks-proxy-agent'); a = new SocksProxyAgent(proxyUrl); }
  else if (https_) { const { HttpsProxyAgent } = require('https-proxy-agent'); a = new HttpsProxyAgent(proxyUrl); }
  else { const { HttpProxyAgent } = require('http-proxy-agent'); a = new HttpProxyAgent(proxyUrl); }
  agentCache.set(k, a); return a;
}
export const nodeTransport: Transport = (url, o) => new Promise<RawResponse>((resolve, reject) => {
  let hops = 0; const deadline = Date.now() + o.timeoutMs;
  const go = (u: string) => {
    let U: URL; try { U = new URL(u); } catch { return reject(new CrawlError('code', '网址无效：' + u)); }
    const isHttps = U.protocol === 'https:'; const lib = isHttps ? https : http;
    const pu = o.proxy.kind === 'manual' ? o.proxy.url : o.proxy.kind === 'system' ? envProxy(u) : null;
    const agent = pu ? agentFor(pu, isHttps) : undefined;
    const req = lib.request(U, { method: o.method, headers: { ...o.headers, 'accept-encoding': 'gzip, deflate, br' }, agent, timeout: Math.max(1000, deadline - Date.now()) }, res => {
      const st = res.statusCode || 0; const loc = res.headers.location;
      if (st >= 300 && st < 400 && loc && hops++ < 6) { res.resume(); return go(new URL(loc, u).toString()); }
      const enc = String(res.headers['content-encoding'] || ''); let stream: NodeJS.ReadableStream = res;
      if (/br/.test(enc)) stream = res.pipe(zlib.createBrotliDecompress()); else if (/gzip/.test(enc)) stream = res.pipe(zlib.createGunzip()); else if (/deflate/.test(enc)) stream = res.pipe(zlib.createInflate());
      const chunks: Buffer[] = []; let n = 0;
      stream.on('data', (d: Buffer) => { n += d.length; if (n <= o.maxBytes) chunks.push(d); else { (res as any).destroy(); } });
      const done = () => { const h: Record<string, string> = {}; for (const [k, v] of Object.entries(res.headers)) h[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v ?? ''); resolve({ status: st, headers: h, body: Buffer.concat(chunks), finalUrl: u }); };
      stream.on('end', done); stream.on('close', () => { if (n > o.maxBytes) done(); }); stream.on('error', (e: any) => (n > o.maxBytes ? done() : reject(e)));
    });
    req.on('timeout', () => { req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); });
    req.on('error', reject); if (o.body != null && hops === 0) req.write(o.body); req.end();
  };
  go(url);
});

/** 测试连通：返回每个地址的状态与失败分类（设置页「测试连通」按钮） */
export async function testConnectivity(urls: string[], choice: ProxyChoice = 'inherit') {
  const out: { url: string; ok: boolean; status?: number; ms: number; kind?: FailKind; message?: string }[] = [];
  await Promise.all(urls.map(async url => { const t = Date.now(); try { const r = await request(url, { retries: 0, proxy: choice, timeoutMs: Math.min(cfg.timeoutMs, 15000), intervalMs: 0, maxBytes: 200_000 }); out.push({ url, ok: true, status: r.status, ms: Date.now() - t }); }
    catch (e: any) { const k = classifyFailure(e); out.push({ url, ok: k === 'challenge', status: e.status, ms: Date.now() - t, kind: k, message: k === 'challenge' ? '能连上（该站有人机验证）' : failLabel(k) }); } }));
  return { proxy: resolveProxy(choice), transport: transportName(), results: urls.map(u => out.find(x => x.url === u)!) };
}
