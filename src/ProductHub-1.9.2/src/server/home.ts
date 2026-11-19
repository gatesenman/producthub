import type { DB } from './db';
import { hydrateList, LIST_COLS, LIST_COLS_BASE, LIST_FAV } from './products';
import { categoryName } from './taxonomy';
import { VERSION } from './version';
import { memoByRev } from './util';

/** 首页「今日新增」数据：以最近一个有收录的日期为“最新一天”（离线种子数据时也有内容） */
export function homeData(db: DB) {
  return memoByRev(db, 'homeData', () => homeDataUncached(db));
}
function homeDataUncached(db: DB) {
  const today = new Date().toISOString().slice(0, 10);
  // 基线：首次统计时库内已有的数据视为「预置/历史数据」，之后同步进来的才算「新增」
  let cutoff = db.getSetting('home.cutoff', '');
  if (!cutoff) { cutoff = db.get<any>('SELECT MAX(first_seen) t FROM products')?.t || '0'; try { db.setSetting('home.cutoff', cutoff); } catch { /* 并行抓取占锁时跳过持久化 */ } }
  const newToday = db.get<any>('SELECT COUNT(*) n FROM products WHERE first_seen > ? AND substr(first_seen,1,10)=?', [cutoff, today]).n;
  const new7d = db.get<any>("SELECT COUNT(*) n FROM products WHERE first_seen > ? AND substr(first_seen,1,10) > date(?, '-7 days')", [cutoff, today]).n;
  const newAll = db.get<any>('SELECT COUNT(*) n FROM products WHERE first_seen > ?', [cutoff]).n;
  const mode = newAll ? 'new' : 'recent';
  // 列表瘦身；recent 用 launch_date 索引，避免 substr() 毁掉索引
  const items = (mode === 'new'
    ? db.all(`SELECT ${LIST_COLS}, ${LIST_FAV} FROM products WHERE first_seen > ? ORDER BY first_seen DESC, launch_count DESC LIMIT 12`, [cutoff])
    : db.all(`SELECT ${LIST_COLS}, ${LIST_FAV} FROM products ORDER BY launch_date DESC, first_seen DESC LIMIT 12`)).map(hydrateList);
  const lastLaunch = db.get<any>('SELECT substr(MAX(launch_date),1,10) d FROM products')?.d || today;
  // 近窗聚合改为「按索引取最近 N 条再分组」，避免大库上 launch_date 范围 GROUP BY 全扫
  const recent = db.all<any>("SELECT substr(launch_date,1,10) d, category FROM products WHERE launch_date IS NOT NULL AND launch_date<>'' ORDER BY launch_date DESC, first_seen DESC LIMIT 4000");
  const trendMap = new Map<string, number>(); const catMap = new Map<string, number>();
  const day7 = (() => { try { const d = new Date(lastLaunch); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); } catch { return '0'; } })();
  for (const r of recent) { trendMap.set(r.d, (trendMap.get(r.d) || 0) + 1); if (r.d >= day7) catMap.set(r.category, (catMap.get(r.category) || 0) + 1); }
  const trend = [...trendMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-14).map(([d, n]) => ({ d, n }));
  const cats = [...catMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([category, n]) => ({ category, n, name: categoryName(category) }));
  const favCols = LIST_COLS_BASE.split(',').map(c => 'p.' + c).join(',') + ",(p.ai_summary IS NOT NULL AND p.ai_summary<>'') AS has_summary";
  const favUpdates = db.all(`SELECT ${favCols}, 1 AS favorite, MAX(v.created_at) changed_at FROM favorites f JOIN products p ON p.guid=f.product_guid JOIN product_versions v ON v.product_guid=p.guid WHERE v.created_at > f.created_at GROUP BY p.guid ORDER BY changed_at DESC LIMIT 8`).map(hydrateList);
  const favCount = db.get<any>('SELECT COUNT(*) n FROM favorites').n;
  const errors = db.all<any>("SELECT guid, name, last_error, last_crawl_at FROM sources WHERE enabled=1 AND last_status='error' ORDER BY last_crawl_at DESC LIMIT 5");
  const src = db.get<any>("SELECT COUNT(*) total, SUM(enabled=1) enabled, SUM(last_status='error' AND enabled=1) errors, SUM(last_crawl_at IS NULL AND enabled=1) never FROM sources");
  const lastSync = db.get<any>('SELECT MAX(finished_at) t FROM crawl_runs')?.t || null;
  const total = db.get<any>('SELECT COUNT(*) n FROM products').n;
  return { today, cutoff, mode, newToday, new7d, newAll, total, items, lastLaunch, trend, cats, favUpdates, favCount, errors, sources: src, lastSync };
}

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** 一键生成可分享的分析报告（HTML 或 Markdown） */
export function buildReport(db: DB, format: 'html' | 'md', category?: string) {
  const w = category ? 'WHERE category=?' : ''; const p = category ? [category] : [];
  const t = db.get<any>(`SELECT COUNT(*) n, SUM(launch_count>1) multi, SUM(ai_summary IS NOT NULL) ai FROM products ${w}`, p);
  const cats = db.all<any>(`SELECT category, COUNT(*) n FROM products ${w} GROUP BY category ORDER BY n DESC LIMIT 12`, p);
  const top = db.all<any>(`SELECT name, url, tagline, launch_count, votes, category FROM products ${w} ORDER BY launch_count DESC, votes DESC LIMIT 20`, p);
  const h = homeData(db); const title = `统一产品库分析报告${category ? ' · ' + categoryName(category) : ''}`; const date = new Date().toLocaleString('zh-CN', { hour12: false });
  if (format === 'md') return [`# ${title}`, `生成时间：${date}`, '', `- 产品总数：${t.n}`, `- 多次发布：${t.multi}`, `- 已 AI 总结：${t.ai}`, `- 近 7 天新增：${h.new7d}`, '', '## 分类分布', '| 分类 | 产品数 |', '|---|---|', ...cats.map(c => `| ${categoryName(c.category)} | ${c.n} |`), '', '## 热门产品 Top 20', '| # | 产品 | 分类 | 发布次数 | 票数 | 简介 |', '|---|---|---|---|---|---|', ...top.map((x, i) => `| ${i + 1} | [${x.name}](${x.url || ''}) | ${categoryName(x.category)} | ${x.launch_count} | ${x.votes || 0} | ${String(x.tagline || '').replace(/\|/g, '/')} |`), ''].join('\n');
  const max = Math.max(1, ...cats.map(c => c.n));
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei UI","Noto Sans SC",sans-serif;color:#18181b;max-width:960px;margin:40px auto;padding:0 24px}h1{font-size:22px;margin:0}h2{font-size:16px;margin-top:32px;border-bottom:1px solid #e4e4e7;padding-bottom:6px}.muted{color:#71717a;font-size:12px}.kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}.kpi div{border:1px solid #e4e4e7;border-radius:8px;padding:12px}.kpi b{display:block;font-size:22px;font-variant-numeric:tabular-nums}table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #f4f4f5}th{color:#71717a;font-weight:500}.bar{height:8px;background:#6366f1;border-radius:4px}th{white-space:nowrap}table.top td{white-space:nowrap;vertical-align:top}table.top td.desc{white-space:normal;min-width:260px;color:#52525b}table.top td.name{max-width:220px;overflow:hidden;text-overflow:ellipsis}td.num{text-align:right;font-variant-numeric:tabular-nums}</style>
<h1>${esc(title)}</h1><div class="muted">生成时间：${esc(date)} · 统一产品库 v${VERSION}</div>
<div class="kpi"><div>产品总数<b>${t.n}</b></div><div>多次发布<b>${t.multi}</b></div><div>已 AI 总结<b>${t.ai}</b></div><div>近 7 天同步新增<b>${h.new7d}</b></div></div>
<h2>分类分布</h2><table>${cats.map(c => `<tr><td style="width:160px">${esc(categoryName(c.category))}</td><td><div class="bar" style="width:${(c.n / max * 100).toFixed(1)}%"></div></td><td style="width:60px;text-align:right">${c.n}</td></tr>`).join('')}</table>
<h2>热门产品 Top 20（按发布次数、票数）</h2><table class="top"><tr><th>#</th><th>产品</th><th>分类</th><th>发布次数</th><th>票数</th><th>简介</th></tr>${top.map((x, i) => `<tr><td class="num">${i + 1}</td><td class="name"><a href="${esc(x.url)}">${esc(x.name)}</a></td><td>${esc(categoryName(x.category))}</td><td class="num">${x.launch_count}</td><td class="num">${x.votes || 0}</td><td class="desc">${esc(x.tagline)}</td></tr>`).join('')}</table></html>`;
}
