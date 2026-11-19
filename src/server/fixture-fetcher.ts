/** 仅供 E2E / 演示：用本地样本代替真实网络（--web-fixtures <dir>），保证联网搜索与补齐的测试可重复 */
import fs from 'node:fs';
import path from 'node:path';
import type { Fetcher } from './crawler';
export function fixtureFetcher(dir: string): Fetcher {
  const rd = (n: string) => fs.readFileSync(path.join(dir, n), 'utf8');
  return async (url) => {
    const ok = (text: string, type = 'text/html') => ({ status: 200, text, contentType: type, finalUrl: url });
    await new Promise(r => setTimeout(r, 150));
    if (url.includes('duckduckgo.com')) return ok(rd('ddg-ok.html'));
    if (url.includes('bing.com')) throw new Error('fetch failed（样本模式：模拟 Bing 不可用）');
    if (url.includes('api.github.com')) return ok('{"items":[{"name":"meetnote","html_url":"https://github.com/demo/meetnote","homepage":"","description":"Open-source AI meeting notes and minutes","stargazers_count":1234,"created_at":"2026-09-20T00:00:00Z"}]}', 'application/json');
    if (url.includes('hn.algolia.com')) return ok('{"hits":[]}', 'application/json');
    if (/\/pricing/.test(url)) return ok(rd('site-pricing.html'));
    return ok(rd('site-home.html'));
  };
}
