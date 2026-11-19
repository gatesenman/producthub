/**
 * v1.9.1 桌面版：Chromium 网络栈传输 + 内置浏览器（真实页面渲染）。
 * - 网络请求走 session.fetch：真正跟随系统代理 / PAC，或手动 HTTP / SOCKS5 代理，或直连。
 * - 浏览器模式：独立持久化会话（partition，保留 Cookie / 登录态）；隐藏窗口渲染、等待 JS、自动滚动 / 翻页。
 * - 遇到人机验证：先等页面自己的校验跑完；仍未通过就弹出可见窗口让用户自己处理，处理完继续，否则交给公开存档。
 * - 不做任何指纹伪造 / 反检测 / 自动破解验证码。
 */
import { BrowserWindow, session, type Session } from 'electron';
import crypto from 'node:crypto';
import { setTransport, getNetConfig, resolveProxy, type Transport, type ResolvedProxy, type ProxyChoice } from '../src/server/net';
import { setBrowserHost, type BrowserHost, type BrowserRenderOpts, type BrowserRenderResult } from '../src/server/browser';

const proxyConfig = (p: ResolvedProxy): Electron.ProxyConfig => p.kind === 'system' ? { mode: 'system' } : p.kind === 'direct' ? { mode: 'direct' } : { mode: 'fixed_servers', proxyRules: p.url.replace(/^socks5h:/, 'socks5:').replace(/^socks:/, 'socks5:'), proxyBypassRules: '<local>' };
const applied = new WeakMap<Session, string>();
async function applyProxy(ses: Session, p: ResolvedProxy) { const k = JSON.stringify(p); if (applied.get(ses) === k) return; await ses.setProxy(proxyConfig(p)); await ses.closeAllConnections?.(); applied.set(ses, k); }
const ua = (ses: Session) => { const u = getNetConfig().userAgent; if (u && ses.getUserAgent() !== u) ses.setUserAgent(u); };

/** 请求用的内存会话（按代理方案各一个，互不影响） */
const netSessions = new Map<string, Session>();
function netSession(p: ResolvedProxy) { const k = JSON.stringify(p); let s = netSessions.get(k); if (!s) { s = session.fromPartition('ph-net-' + crypto.createHash('sha1').update(k).digest('hex').slice(0, 10)); netSessions.set(k, s); } return s; }

export const chromiumTransport: Transport = async (url, o) => {
  const ses = netSession(o.proxy); await applyProxy(ses, o.proxy);
  const { 'accept-encoding': _ae, ...headers } = o.headers;
  const r = await ses.fetch(url, { method: o.method, headers, body: o.body as any, redirect: 'follow', signal: AbortSignal.timeout(o.timeoutMs), bypassCustomProtocolHandlers: true } as any);
  const ab = Buffer.from(await r.arrayBuffer()); const h: Record<string, string> = {}; r.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
  return { status: r.status, headers: h, body: ab.length > o.maxBytes ? ab.subarray(0, o.maxBytes) : ab, finalUrl: r.url || url };
};

/** 调试：设置 PH_BROWSER_SHOTS=目录 时保存渲染截图 */
async function shot(win: BrowserWindow, tag: string) { const dir = process.env.PH_BROWSER_SHOTS; if (!dir || win.isDestroyed()) return; try { const fs = await import('node:fs'); fs.mkdirSync(dir, { recursive: true }); const img = await win.webContents.capturePage(); const h = (() => { try { return new URL(win.webContents.getURL()).host; } catch { return 'page'; } })(); fs.writeFileSync(`${dir}/${h}-${tag}-${Date.now()}.png`, img.toPNG()); } catch { /* */ } }
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const CHALLENGE_JS = `(() => { const t = document.title || ''; const b = document.body ? document.body.innerText.slice(0, 4000) : '';
  const sel = document.querySelector('#challenge-form, #challenge-running, #cf-challenge-running, .cf-turnstile, iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"], #px-captcha, iframe[src*="captcha-delivery"]');
  return { title: t, len: b.length, ch: !!sel || /^(Just a moment|Attention Required|请稍候|Security Checkpoint)/i.test(t) || /Performing security verification/i.test(b) && b.length < 3000 || /Verify you are human|Checking your browser|Checking if the site connection is secure|请完成安全验证|人机验证|滑动验证/i.test(b) && b.length < 3000 }; })()`;
let queue: Promise<any> = Promise.resolve();
const known = new Set<string>();

async function partitionSession(partition: string, proxy: ProxyChoice) { const ses = session.fromPartition(partition); known.add(partition); await applyProxy(ses, resolveProxy(proxy)); ua(ses); return ses; }

async function renderOnce(o: BrowserRenderOpts): Promise<BrowserRenderResult> {
  const t0 = Date.now(); const log: string[] = []; await partitionSession(o.partition, o.proxy);
  const win = new BrowserWindow({ show: false, width: 1366, height: 900, paintWhenInitiallyHidden: true, title: '统一产品库 · 内置浏览器', autoHideMenuBar: true,
    webPreferences: { partition: o.partition, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.setAudioMuted(true);
  let status = 0; win.webContents.on('did-navigate', (_e, _u, code) => { status = code || status; });
  const js = <T = any>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
  try {
    try { await Promise.race([win.loadURL(o.url), sleep(o.timeoutMs).then(() => { throw Object.assign(new Error('页面加载超时'), { code: 'ETIMEDOUT' }); })]); }
    catch (e: any) { if (/ERR_ABORTED/.test(String(e?.message)) && status) { /* 页面内跳转，继续 */ } else if (!status || /ETIMEDOUT/.test(e?.code)) throw e; }
    // 人机验证：先给页面自己的校验时间（真实浏览器会自行完成非交互校验），仍未通过再请用户处理
    let ch = await js<any>(CHALLENGE_JS).catch(() => ({ ch: false }));
    for (let i = 0; ch.ch && i < 10; i++) { await sleep(2000); ch = await js<any>(CHALLENGE_JS).catch(() => ({ ch: false })); }
    let userSolved: boolean | undefined;
    if (ch.ch && o.showOnChallenge) {
      log.push('需要人工验证，弹出窗口'); win.setTitle(`请在此窗口完成验证：${o.label || ''}（完成后自动继续，关闭窗口则改走公开存档）`); win.show(); win.focus();
      const until = Date.now() + (o.challengeWaitMs || 180_000); let closed = false; win.once('close', e => { closed = true; e.preventDefault(); win.hide(); });
      while (Date.now() < until && !closed) { await sleep(1500); ch = await js<any>(CHALLENGE_JS).catch(() => ({ ch: true })); if (!ch.ch) break; }
      userSolved = !ch.ch; if (!win.isDestroyed()) win.hide();
    }
    await shot(win, ch.ch ? 'challenge' : 'loaded');
    if (ch.ch) return { html: '', finalUrl: win.webContents.getURL(), status, title: ch.title || '', challenged: true, userSolved, pages: 0, ms: Date.now() - t0, log };
    // 等待内容：waitSelector 出现 或 waitMs
    const wait = o.waitMs ?? 2500;
    if (o.waitSelector) { const until = Date.now() + wait + 12_000; while (Date.now() < until) { if (await js<boolean>(`!!document.querySelector(${JSON.stringify(o.waitSelector)})`).catch(() => false)) break; await sleep(400); } }
    else await sleep(wait);
    const htmls: string[] = []; let pages = 0;
    for (let p = 0; p < Math.max(1, o.pages || 1); p++) {
      for (let i = 0; i < (o.scrolls ?? 3); i++) { await js('window.scrollBy(0, Math.max(window.innerHeight * 2, 1200)); true').catch(() => {}); await sleep(1100); }
      pages++;
      if (!o.nextSelector || p + 1 >= (o.pages || 1)) break;
      const clicked = await js<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(o.nextSelector)}); if (!el) return false; el.scrollIntoView(); el.click(); return true; })()`).catch(() => false);
      if (!clicked) break; htmls.push(await js<string>('document.documentElement.outerHTML')); await sleep(Math.max(1500, wait));
    }
    let scriptItems: any[] | null = null;
    if (o.script) { try { const r = await js<any>(`(async () => { ${o.script}\n })()`); if (Array.isArray(r)) scriptItems = r.slice(0, 2000); else log.push('提取脚本没有返回数组'); } catch (e) { log.push('提取脚本出错：' + (e as Error).message); } }
    const html = await js<string>('document.documentElement.outerHTML'); await shot(win, 'final');
    return { html: htmls.length ? htmls.join('\n') + '\n' + html : html, finalUrl: win.webContents.getURL(), status: status || 200, title: win.getTitle(), challenged: false, userSolved, scriptItems, pages, ms: Date.now() - t0, log };
  } finally { if (!win.isDestroyed()) win.destroy(); }
}

const host: BrowserHost = {
  render(o) { const p = queue.then(() => renderOnce(o)); queue = p.catch(() => {}); return p; },
  async open(url, partition, proxy) {
    await partitionSession(partition, proxy);
    const win = new BrowserWindow({ width: 1280, height: 860, title: '统一产品库 · 内置浏览器（登录 / 验证后关闭窗口即可）', autoHideMenuBar: true, webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.webContents.setWindowOpenHandler(({ url: u }) => { win.loadURL(u); return { action: 'deny' }; });
    await win.loadURL(url).catch(() => {});
    await new Promise<void>(r => win.once('closed', () => r()));
    const cookies = await session.fromPartition(partition).cookies.get({}); return { closed: true, cookies: cookies.length };
  },
  async clear(partition) { await session.fromPartition(partition).clearStorageData(); },
  async partitions() { const out: { partition: string; cookies: number }[] = []; for (const p of known) out.push({ partition: p, cookies: (await session.fromPartition(p).cookies.get({})).length }); return out; },
};

export function installBrowserHost() { setTransport(chromiumTransport); setBrowserHost(host); known.add('persist:ph-browser'); }
