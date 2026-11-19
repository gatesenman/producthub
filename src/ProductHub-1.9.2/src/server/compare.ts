/** v1.4 产品对比：2–5 个产品并排，逐属性标记差异，可导出 xlsx / Markdown */
import * as XLSX from 'xlsx';
import type { DB } from './db';
import { hydrate } from './products';
import { CATEGORIES } from './taxonomy';
import { localAnalysis } from './ai';

export type CompareRow = { key: string; label: string; group: string; values: string[]; differs: boolean };
const join = (a: any, sep = '、') => (Array.isArray(a) ? a.filter(Boolean).join(sep) : a ?? '') || '';
const catName = (id: string) => CATEGORIES.find(c => c.id === id)?.name || id || '';
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function compareProducts(db: DB, guids: string[]) {
  const ids = [...new Set(guids.filter(Boolean))];
  if (ids.length < 2 || ids.length > 5) throw new Error('请选择 2–5 个产品进行对比');
  const products = ids.map(g => { const p = db.get<any>('SELECT * FROM products WHERE guid=?', [g]); if (!p) throw new Error('产品不存在：' + g); return hydrate(p); });
  const sources = ids.map(g => db.all<any>('SELECT DISTINCT s.name FROM product_versions v JOIN sources s ON s.guid=v.source_guid WHERE v.product_guid=?', [g]).map(r => r.name));
  const analyses = products.map(p => p.ai_analysis || localAnalysis(p, []));
  const dimKeys: { key: string; label: string }[] = [];
  for (const a of analyses) for (const d of a?.dimensions || []) if (!dimKeys.some(k => k.key === d.key)) dimKeys.push({ key: d.key, label: d.label });
  const e = (p: any) => p.enrich || {};
  const tiers = (p: any) => (e(p).pricing?.tiers || []).map((t: any) => `${t.name}${t.price ? ' ' + t.price : ''}${t.period ? ' ' + t.period : ''}`).join('；');
  const freeTxt = (p: any) => { const f = e(p).pricing?.hasFree; return f === true ? '有' : f === false ? '无' : ''; };
  const spec: [string, string, string, (p: any, i: number) => string][] = [
    ['tagline', '一句话定位', '定位', p => e(p).summary || p.tagline || ''],
    ['category', '分类', '定位', p => catName(p.category)],
    ['tags', '标签', '定位', p => join(p.tags)],
    ['audience', '目标用户', '定位', p => join(e(p).audience?.length ? e(p).audience : analyses[products.indexOf(p)]?.audience)],
    ['features', '核心功能', '功能', p => join(e(p).features, '\n')],
    ['platforms', '平台', '功能', p => join(p.platforms)],
    ['languages', '界面语言', '功能', p => join(e(p).languages)],
    ['hasFree', '免费版', '定价', p => freeTxt(p)],
    ['pricingModel', '定价模式', '定价', p => e(p).pricing?.model || p.pricing || ''],
    ['tiers', '价格档位', '定价', p => tiers(p)],
    ['company', '公司/团队', '公司', p => e(p).company?.name || p.maker || ''],
    ['country', '国家/地区', '公司', p => p.country || e(p).company?.location || ''],
    ['socials', '社交账号', '公司', p => Object.keys(e(p).socials || {}).join('、')],
    ['launch_date', '上线日期', '动态', p => p.launch_date || ''],
    ['first_seen', '首次收录', '动态', p => (p.first_seen || '').slice(0, 10)],
    ['sources', '来源', '动态', (_p, i) => sources[i].join('、')],
    ['launch_count', '发布次数', '动态', p => String(p.launch_count ?? '')],
    ['url', '官网', '动态', p => p.url || ''],
    ['enriched_at', '信息更新', '动态', p => (p.enriched_at || '').slice(0, 10)],
    ...dimKeys.map(d => [`ai_${d.key}`, `AI 评分 · ${d.label}`, 'AI 评分', (_p: any, i: number) => { const x = analyses[i]?.dimensions?.find((y: any) => y.key === d.key); return x ? String(x.score) : ''; }] as [string, string, string, (p: any, i: number) => string]),
  ];
  const rows: CompareRow[] = spec.map(([key, label, group, f]) => { const values = products.map((p, i) => f(p, i) || ''); const filled = values.filter(Boolean); return { key, label, group, values, differs: filled.length > 0 && (new Set(values.map(norm)).size > 1) }; })
    .filter(r => r.values.some(Boolean) || ['hasFree', 'tiers', 'features', 'audience'].includes(r.key));
  const best: Record<string, number> = {};
  for (const r of rows) if (r.key.startsWith('ai_')) { const n = r.values.map(v => +v || 0); const m = Math.max(...n); if (m > 0 && n.filter(x => x === m).length === 1) best[r.key] = n.indexOf(m); }
  return { products: products.map(p => ({ guid: p.guid, name: p.name, url: p.url, logo_url: p.logo_url, domain: p.domain, enriched: !!p.enrich, enrich_status: p.enrich_status })), rows, best, diffCount: rows.filter(r => r.differs).length };
}

export function compareExport(db: DB, guids: string[], format: 'xlsx' | 'md') {
  const c = compareProducts(db, guids); const names = c.products.map(p => p.name);
  if (format === 'md') {
    const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
    const lines = [`# 产品对比：${names.join(' vs ')}`, '', `> 导出自 ProductHub，${new Date().toISOString().slice(0, 10)}。标记 ★ 的行存在差异。`, '', `| 属性 | ${names.map(esc).join(' | ')} |`, `|---|${names.map(() => '---').join('|')}|`,
      ...c.rows.map(r => `| ${r.differs ? '★ ' : ''}${r.label} | ${r.values.map(v => esc(v || '—')).join(' | ')} |`)];
    return { body: lines.join('\n') + '\n', mime: 'text/markdown; charset=utf-8', ext: 'md' };
  }
  const aoa = [['分组', '属性', '差异', ...names], ...c.rows.map(r => [r.group, r.label, r.differs ? '是' : '', ...r.values])];
  const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 8 }, { wch: 16 }, { wch: 6 }, ...names.map(() => ({ wch: 36 }))];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '对比');
  return { body: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
}
