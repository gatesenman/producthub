/** v1.9.1 浏览器网页模式接口：桌面版由 Electron 主进程注册真实浏览器（BrowserWindow + 持久化会话）；独立服务下不可用。 */
import type { ProxyChoice } from './net';
export interface BrowserRenderOpts {
  url: string; partition: string; proxy: ProxyChoice; timeoutMs: number; waitSelector?: string; scrolls?: number; waitMs?: number;
  nextSelector?: string; pages?: number; script?: string; showOnChallenge?: boolean; challengeWaitMs?: number; label?: string;
}
export interface BrowserRenderResult { html: string; finalUrl: string; status: number; title: string; challenged: boolean; userSolved?: boolean; scriptItems?: any[] | null; pages: number; ms: number; log: string[] }
export interface BrowserHost {
  render(o: BrowserRenderOpts): Promise<BrowserRenderResult>;
  /** 打开可见的内置浏览器窗口（同一会话），用户可登录 / 手动完成验证；关闭窗口后 resolve */
  open(url: string, partition: string, proxy: ProxyChoice): Promise<{ closed: boolean; cookies: number }>;
  clear(partition: string): Promise<void>;
  partitions(): Promise<{ partition: string; cookies: number }[]>;
}
let host: BrowserHost | null = null;
export function setBrowserHost(h: BrowserHost | null) { host = h; }
export function browserHost() { return host; }
export function browserAvailable() { return !!host; }
export const SHARED_PARTITION = 'persist:ph-browser';
export const partitionFor = (session: 'shared' | 'isolated', guid: string) => session === 'isolated' ? 'persist:ph-src-' + guid.slice(0, 18) : SHARED_PARTITION;
