import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { request, configureNet, setTransport, parseProxyUrl, resolveProxy, classifyFailure, isChallenge, failLabel, CrawlError, retryAfterMs, testConnectivity, DEFAULT_NET, type Transport } from '../../src/server/net';

const servers: http.Server[] = [];
const listen = (s: http.Server) => new Promise<number>(ok => { servers.push(s); s.listen(0, '127.0.0.1', () => ok((s.address() as any).port)); });
afterAll(() => { for (const s of servers) s.close(); setTransport(null); configureNet(DEFAULT_NET); });
beforeEach(() => { setTransport(null); configureNet({ ...DEFAULT_NET, intervalMs: 0, retries: 2, timeoutMs: 3000 }); });

describe('代理设置', () => {
  it('解析手动代理地址：省略协议按 http；支持 socks5；缺端口报中文错误', () => {
    expect(parseProxyUrl('127.0.0.1:7897')).toEqual({ ok: true, url: 'http://127.0.0.1:7897' });
    expect(parseProxyUrl('socks5://127.0.0.1:7898')).toEqual({ ok: true, url: 'socks5://127.0.0.1:7898' });
    const bad = parseProxyUrl('127.0.0.1'); expect(bad.ok).toBe(false); expect((bad as any).error).toContain('端口');
    expect(parseProxyUrl('ftp://1.2.3.4:21').ok).toBe(false);
  });
  it('解析每源代理选择：继承 / 直连 / 强制代理', () => {
    expect(resolveProxy('inherit', { ...DEFAULT_NET, proxyMode: 'system' })).toEqual({ kind: 'system' });
    expect(resolveProxy('inherit', { ...DEFAULT_NET, proxyMode: 'manual', proxyUrl: '127.0.0.1:7897' })).toEqual({ kind: 'manual', url: 'http://127.0.0.1:7897' });
    expect(resolveProxy('direct', { ...DEFAULT_NET, proxyMode: 'manual', proxyUrl: '127.0.0.1:7897' })).toEqual({ kind: 'direct' });
    expect(resolveProxy('inherit', { ...DEFAULT_NET, proxyMode: 'none' })).toEqual({ kind: 'direct' });
    expect(resolveProxy('proxy', { ...DEFAULT_NET, proxyMode: 'none' })).toEqual({ kind: 'system' });
  });
  it('手动 HTTP 代理：Node 传输真正经过代理；改成“不用代理”后直连', async () => {
    const target = await listen(http.createServer((_q, r) => { r.end('<html>target</html>'); }));
    let viaProxy = 0;
    const proxy = await listen(http.createServer((q, r) => { viaProxy++; const u = new URL(q.url!); const up = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: q.method, headers: q.headers }, ur => { r.writeHead(ur.statusCode!, ur.headers); ur.pipe(r); }); q.pipe(up); }));
    configureNet({ proxyMode: 'manual', proxyUrl: `127.0.0.1:${proxy}`, intervalMs: 0 });
    const a = await request(`http://127.0.0.1:${target}/x`); expect(a.text).toContain('target'); expect(viaProxy).toBe(1);
    configureNet({ proxyMode: 'none' }); await request(`http://127.0.0.1:${target}/y`); expect(viaProxy).toBe(1);
    // 每源强制直连
    configureNet({ proxyMode: 'manual', proxyUrl: `127.0.0.1:${proxy}` }); await request(`http://127.0.0.1:${target}/z`, { proxy: 'direct' }); expect(viaProxy).toBe(1);
  });
  it('代理连不上 → 归类为 proxy/network，提示检查代理', async () => {
    const dead = await new Promise<number>(ok => { const s = net.createServer(); s.listen(0, () => { const p = (s.address() as any).port; s.close(() => ok(p)); }); });
    configureNet({ proxyMode: 'manual', proxyUrl: `127.0.0.1:${dead}`, retries: 0 });
    const e = await request('http://example.invalid/').catch(x => x); expect(e).toBeInstanceOf(CrawlError); expect(['proxy', 'network']).toContain(e.kind);
  });
});

describe('超时 / 重试 / 退避 / 并发', () => {
  it('429 读取 Retry-After 后重试成功', async () => {
    let n = 0; const t: Transport = async (): Promise<any> => (++n === 1 ? { status: 429, headers: { 'retry-after': '0' }, body: Buffer.from('slow down'), finalUrl: 'u' } : { status: 200, headers: {}, body: Buffer.from('ok'), finalUrl: 'u' });
    setTransport(t); const r = await request('https://a.test/'); expect(r.text).toBe('ok'); expect(r.attempts).toBe(2);
  });
  it('超时可重试，重试次数用尽后归类为 timeout', async () => {
    let n = 0; setTransport(async () => { n++; throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); });
    configureNet({ retries: 1 }); const e = await request('https://b.test/').catch(x => x); expect(e.kind).toBe('timeout'); expect(n).toBe(2); expect(e.message).toContain('超时');
  });
  it('Cloudflare 挑战页不重试，直接归类为 challenge', async () => {
    let n = 0; setTransport(async () => { n++; return { status: 403, headers: { 'cf-mitigated': 'challenge', server: 'cloudflare' }, body: Buffer.from('<title>Just a moment...</title>'), finalUrl: 'u' }; });
    const e = await request('https://c.test/').catch(x => x); expect(e.kind).toBe('challenge'); expect(n).toBe(1);
  });
  it('404 不重试；5xx 重试', async () => {
    let n = 0; setTransport(async () => { n++; return { status: 404, headers: {}, body: Buffer.from('nf'), finalUrl: 'u' }; });
    expect((await request('https://d.test/').catch(x => x)).kind).toBe('not_found'); expect(n).toBe(1);
    n = 0; setTransport(async () => { n++; return { status: n < 2 ? 503 : 200, headers: {}, body: Buffer.from('x'), finalUrl: 'u' }; });
    expect((await request('https://e.test/')).status).toBe(200); expect(n).toBe(2);
  });
  it('并发上限生效；同站点请求间隔生效', async () => {
    let cur = 0, peak = 0; setTransport(async () => { cur++; peak = Math.max(peak, cur); await new Promise(r => setTimeout(r, 30)); cur--; return { status: 200, headers: {}, body: Buffer.from('ok'), finalUrl: 'u' }; });
    configureNet({ concurrency: 2, intervalMs: 0 }); await Promise.all(Array.from({ length: 8 }, (_, i) => request('https://p' + i + '.test/'))); expect(peak).toBe(2);
    configureNet({ concurrency: 4, intervalMs: 120 }); const t = Date.now(); await Promise.all([1, 2, 3].map(() => request('https://same.test/'))); expect(Date.now() - t).toBeGreaterThanOrEqual(220);
  });
  it('Retry-After 解析', () => { expect(retryAfterMs({ 'retry-after': '3' })).toBe(3000); expect(retryAfterMs({})).toBeNull(); expect(retryAfterMs({ 'retry-after': '9999' })).toBe(60000); });
});

describe('失败分类（普通中文）', () => {
  it('Node / Chromium 错误码 → 分类', () => {
    expect(classifyFailure({ message: 'fetch failed', cause: { code: 'ENOTFOUND' } })).toBe('dns');
    expect(classifyFailure(new Error('net::ERR_NAME_NOT_RESOLVED'))).toBe('dns');
    expect(classifyFailure(new Error('net::ERR_CONNECTION_RESET'))).toBe('network');
    expect(classifyFailure(new Error('fetch failed'))).toBe('network');
    expect(classifyFailure(new Error('The operation was aborted due to timeout'))).toBe('timeout');
    expect(classifyFailure(new Error('net::ERR_PROXY_CONNECTION_FAILED'))).toBe('proxy');
    expect(classifyFailure(new Error('net::ERR_CERT_AUTHORITY_INVALID'))).toBe('tls');
    expect(classifyFailure(new Error('HTTP 403'))).toBe('forbidden'); expect(classifyFailure(new Error('HTTP 429'))).toBe('rate_limited'); expect(classifyFailure(new Error('HTTP 404'))).toBe('not_found');
    expect(classifyFailure(new Error('HTTP 412'))).toBe('forbidden'); expect(classifyFailure(new TypeError('x is undefined'))).toBe('code');
  });
  it('人机验证识别', () => {
    expect(isChallenge(403, { 'cf-mitigated': 'challenge' }, '')).toBe(true);
    expect(isChallenge(403, { server: 'cloudflare' }, '<title>Just a moment...</title>')).toBe(true);
    expect(isChallenge(403, { server: 'nginx' }, '<h1>403 Forbidden</h1>')).toBe(false);
    expect(isChallenge(200, {}, '<html>normal page with products</html>')).toBe(false);
  });
  it('中文提示', () => { expect(failLabel('network')).toContain('可能需要代理'); expect(failLabel('rate_limited')).toContain('限流'); expect(failLabel('challenge')).toContain('人机验证'); });
  it('测试连通：分别报告每个地址', async () => {
    setTransport(async (u): Promise<any> => u.includes("bad") ? Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED')) : u.includes('cf') ? { status: 403, headers: { 'cf-mitigated': 'challenge' }, body: Buffer.from(''), finalUrl: u } : { status: 200, headers: {}, body: Buffer.from('ok'), finalUrl: u });
    const r = await testConnectivity(['https://ok.test/', 'https://bad.test/', 'https://cf.test/']);
    expect(r.results.map(x => [x.ok, x.kind || null])).toEqual([[true, null], [false, 'dns'], [true, 'challenge']]);
  });
});
