/** v1.9.1 内置来源的抓取方式与浏览器模式规则（按站点）。用户在「来源设置」里的修改优先于这里。 */
import { hostOf } from './util';
import type { SourceSettings } from './source-settings';
import type { SiteKind } from './archive-fallback';

type B = Partial<SourceSettings>;
const today = '{yyyy}/{m}/{d}';
export const BUILTIN: { match: RegExp; s: B; archiveKind?: SiteKind; note?: string }[] = [
  { match: /(^|\.)producthunt\.com$/, note: 'Cloudflare 防护：用内置浏览器打开真实页面（首页 + 当日 All 榜单）',
    s: { method: 'browser', entryUrls: ['https://www.producthunt.com/', `https://www.producthunt.com/leaderboard/daily/${today}/all`], maxItems: 120,
      browser: { waitSelector: 'section[data-container]', itemSelector: 'section[data-container]', scrolls: 6, waitMs: 3000, keepDetailAsUrl: true, followDetail: false,
        fields: { name: { selector: 'a[href^="/products/"]' }, url: { selector: 'a[href^="/products/"]', attr: 'href' }, tagline: { selector: 'span.text-secondary' }, image: { selector: 'img', attr: 'src' }, votes: { selector: 'button[data-test="vote-button"] p' } } } } },
  { match: /(^|\.)reddit\.com$/, note: '改走 RSS；只收带外部产品链接的帖子', s: { method: 'rss', rssUrl: '{url}/new/.rss', requireExternalUrl: true, maxItems: 50, intervalMs: 3000 } },
  { match: /^github\.com$/, s: { method: 'html', browser: { keepDetailAsUrl: true, followDetail: false } } },
  { match: /^news\.ycombinator\.com$/, note: '改走 HN 官方 Algolia API', s: { method: 'api', apiUrl: 'https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=60', jsonPath: 'hits' } },
  { match: /(^|\.)sourceforge\.net$/, archiveKind: 'sourceforge', s: { entryUrl: 'https://sourceforge.net/directory/', browser: { waitSelector: 'li.result-heading, .result-heading-texts' } } },
  { match: /(^|\.)alternativeto\.net$/, archiveKind: 'alternativeto', s: {} },
  { match: /(^|\.)saashub\.com$/, archiveKind: 'saashub', s: {} },
  { match: /(^|\.)f6s\.com$/, archiveKind: 'f6s', s: { entryUrl: 'https://www.f6s.com/companies' } },
  { match: /(^|\.)itjuzi\.com$/, note: '需登录：在内置浏览器里登录后用同一会话抓取', s: { method: 'browser', session: 'isolated' } },
  { match: /(^|\.)(geekpark\.net|technode\.com|geekwire\.com|nextbigwhat\.com|yourstory\.com|e27\.co|eu-startups\.com|36kr\.com|techcrunch\.com|venturebeat\.com)$/, note: '媒体站：只收带外部产品链接的条目', s: { requireExternalUrl: true } },
];
/** GitHub 入口特殊处理：trending 用静态规则，stars 搜索改走官方 API */
export function builtinFor(url: string): B {
  const h = (hostOf(url) || '').replace(/^www\./, ''); let out: B = {};
  for (const b of BUILTIN) if (b.match.test(h)) out = { ...out, ...b.s };
  if (h === 'github.com') {
    if (/\/search/.test(url)) out = { ...out, method: 'api', apiUrl: 'https://api.github.com/search/repositories?q=stars:%3E2000+pushed:%3E{ymd-30}&sort=stars&order=desc&per_page=50', jsonPath: 'items' };
    else if (/\/trending/.test(url)) out = { ...out, method: 'html' };
  }
  return out;
}
export function builtinNote(url: string): string | null { const h = (hostOf(url) || '').replace(/^www\./, ''); return BUILTIN.find(b => b.match.test(h))?.note || null; }
export function archiveKindFor(url: string): SiteKind { const h = (hostOf(url) || '').replace(/^www\./, ''); return BUILTIN.find(b => b.match.test(h) && b.archiveKind)?.archiveKind || 'generic'; }
/** 入口 URL 模板：{url} {yyyy} {m} {d} {mm} {dd} {ymd-N}（N 天前的 YYYY-MM-DD） */
export function expandUrl(t: string, srcUrl: string, d = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  // PH 榜单按美西时间切日：用 UTC-8 的日期
  const pt = new Date(d.getTime() - 8 * 3600_000);
  return t.replace(/\{url\}/g, srcUrl.replace(/\/$/, '')).replace(/\{yyyy\}/g, String(pt.getUTCFullYear())).replace(/\{m\}/g, String(pt.getUTCMonth() + 1)).replace(/\{d\}/g, String(pt.getUTCDate()))
    .replace(/\{mm\}/g, p2(pt.getUTCMonth() + 1)).replace(/\{dd\}/g, p2(pt.getUTCDate()))
    .replace(/\{ymd-(\d+)\}/g, (_m, n) => new Date(d.getTime() - +n * 86400_000).toISOString().slice(0, 10));
}
