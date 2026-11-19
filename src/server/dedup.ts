/**
 * v1.9 去重：规则统一放在这里，入库（upsertProduct）、增量合并（applyDelta）和整库去重（scripts/dedup.ts）共用。
 *
 * 判重规则（同一产品 → 合并为一条）：
 *  R1 规范化 URL 相同：dedup_key 相同（https、去 www、去尾斜杠、去 utm 等跟踪参数、去 index.html）
 *  R2 同可注册域名 + 同名称：如 app.foo.com 与 foo.com 且名称键相同（共享域名除外）
 *  R3 GitHub 等共享域名：只按完整路径（owner/repo）；仅当 owner 与某官网域名主体一致且名称相同时并入该官网条目
 *  R4 无网址条目（目录站 slug 等）：名称键相同且库里只有唯一一个候选产品（唯一域名簇）时并入；有歧义则保留
 * 保留方：手动产品 > 收藏 > 有备注 > 有网址 > 字段更全 > 发布次数多。两个手动产品之间不合并。
 */
import type { DB } from './db';
import { slugName, hostOf, isSharedHost, safeJson } from './util';

/** 名称键：小写、NFKC、去空白和标点；ASCII 至少 3 个字符，CJK 至少 2 个字符 */
export function nameKey(name: string | null | undefined): string | null {
  const k = slugName(String(name || '')); if (!k) return null;
  if (/^[\x00-\x7f]+$/.test(k) ? k.length < 3 : k.length < 2) return null;
  if (/^\d+$/.test(k)) return null;
  return k;
}
const SLD = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'com.au', 'net.au', 'org.au', 'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'or.kr', 'com.br', 'co.in', 'net.in', 'com.tw', 'com.hk', 'com.sg', 'co.nz', 'com.mx', 'co.za', 'com.tr', 'co.id', 'com.my', 'com.ar', 'com.ua', 'co.il', 'com.vn', 'com.ph', 'com.pk', 'com.ng', 'co.th']);
/** 托管平台：每个子域名是不同用户/产品（xxx.github.io、xxx.vercel.app、xxx.lemonsqueezy.com…），子域名本身即「可注册域名」 */
export const PER_SUBDOMAIN = new Set(['github.io', 'gitlab.io', 'bitbucket.io', 'vercel.app', 'netlify.app', 'netlify.com', 'pages.dev', 'workers.dev', 'herokuapp.com', 'web.app', 'firebaseapp.com', 'appspot.com', 'notion.site', 'notion.so', 'substack.com', 'wordpress.com', 'blogspot.com', 'myshopify.com', 'gumroad.com', 'lemonsqueezy.com', 'framer.website', 'framer.ai', 'framer.app', 'webflow.io', 'wixsite.com', 'carrd.co', 'glitch.me', 'replit.app', 'repl.co', 'streamlit.app', 'hf.space', 'onrender.com', 'fly.dev', 'deno.dev', 'surge.sh', 'bubbleapps.io', 'softr.app', 'super.site', 'typedream.app', 'tilda.ws', 'itch.io', 'medium.com', 'beehiiv.com', 'ghost.io', 'readthedocs.io', 'gitbook.io', 'mintlify.app', 'bolt.host', 'lovable.app', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'zendesk.com', 'freshdesk.com', 'atlassian.net', 'tumblr.com', 'weebly.com', 'squarespace.com', 'square.site', 'mystrikingly.com', 'webnode.page', 'odoo.com', 'zohosites.com', 'hubspotpagebuilder.com', 'hashnode.dev', 'dev.to', 'posthaven.com', 'typeform.com', 'jimdosite.com', 'neocities.org', 'sourceforge.io', 'codeberg.page', 'chromewebstore.google.com', 'apps.apple.com', 'translate.goog', 'ngrok.io', 'ngrok-free.app', 'railway.app', 'up.railway.app', 'render.com', 'kinsta.cloud', 'pantheonsite.io', 'wpengine.com', 'shinyapps.io', 'huggingface.co', 'producthunt.com', 'launchrock.com', 'unicornplatform.page', 'durable.co', 'mailchimpsites.com', 'site123.me', 'godaddysites.com', 'business.site']);
/** 可注册域名（eTLD+1 的简化实现；托管平台按完整子域名） */
export function regDomain(host: string | null | undefined): string | null {
  if (!host) return null; const h = host.toLowerCase().replace(/^www\./, ''); const p = h.split('.'); if (p.length <= 2) return h;
  const l2 = p.slice(-2).join('.'); const base = SLD.has(l2) ? p.slice(-3).join('.') : l2;
  if (PER_SUBDOMAIN.has(base) || PER_SUBDOMAIN.has(p.slice(-3).join('.'))) return h;
  return base;
}
const domainLabel = (host: string) => slugName((regDomain(host) || '').split('.')[0] || '');
export type KeyKind = 'name' | 'host' | 'url';
export const keyKind = (k: string | null | undefined): KeyKind => String(k || '').startsWith('url:') ? 'url' : String(k || '').startsWith('host:') ? 'host' : 'name';
/** url: 型 key 的 owner（github.com/owner/repo → owner） */
const urlOwner = (k: string) => slugName(String(k).slice(4).split('/')[1] || '');

export type Cand = { guid: string; dedup_key: string; domain: string | null; origin?: string | null; url?: string | null };
/** 同一产品的「簇」标识：非共享域名按可注册域名；共享域名按完整路径 key；无网址为 null */
function clusterOf(c: Cand): string | null {
  const k = keyKind(c.dedup_key);
  if (k === 'host' && c.domain && !isSharedHost(c.domain)) return 'd:' + regDomain(c.domain);
  if (k === 'host' || k === 'url') return 'k:' + String(c.dedup_key).replace(/#.*$/, '');
  return null;
}

/**
 * 给定一个新条目（key/url），在同名称键的候选里找应并入的已有产品；找不到或有歧义返回 null。
 * 候选应已排除新条目自身 guid。
 */
export function pickDuplicate(entry: { key: string; url?: string | null }, cands: Cand[]): Cand | null {
  if (!cands.length) return null;
  const kind = keyKind(entry.key); const host = hostOf(entry.url || null);
  const nonName = cands.filter(c => keyKind(c.dedup_key) !== 'name');
  const nameOnly = cands.filter(c => keyKind(c.dedup_key) === 'name');
  const clusters = new Set(nonName.map(clusterOf));
  if (kind === 'host' && host && !isSharedHost(host)) {
    const rd = regDomain(host); const same = nonName.find(c => clusterOf(c) === 'd:' + rd); if (same) return same;
    const lab = domainLabel(host); const gh = nonName.filter(c => keyKind(c.dedup_key) === 'url' && urlOwner(c.dedup_key) && urlOwner(c.dedup_key) === lab);
    if (gh.length === 1 && clusters.size === 1) return gh[0];
    if (nameOnly.length && clusters.size === 0) return nameOnly[0];
    return null;
  }
  if (kind === 'url') {
    const ow = urlOwner(entry.key);
    const off = nonName.filter(c => keyKind(c.dedup_key) === 'host' && c.domain && !isSharedHost(c.domain) && ow && domainLabel(c.domain) === ow);
    const offClusters = new Set(off.map(clusterOf)); if (off.length && offClusters.size === 1) return off[0];
    if (nameOnly.length && clusters.size === 0) return nameOnly[0];
    return null;
  }
  if (kind === 'name') {
    if (clusters.size === 1) return nonName[0];
    if (clusters.size === 0 && nameOnly.length) return nameOnly[0];
    return null;
  }
  return null;
}

/** 找重复：别名 → 名称键候选 */
export function resolveAlias(db: DB, guid: string): string {
  let g = guid; for (let i = 0; i < 6; i++) { const r = db.get<any>('SELECT guid FROM product_alias WHERE alias=?', [g]); if (!r || r.guid === g) break; g = r.guid; } return g;
}
export function findDuplicate(db: DB, entry: { guid: string; name: string; key: string; url?: string | null }): Cand | null {
  const nk = nameKey(entry.name); if (!nk) return null;
  let cands = db.all<Cand>('SELECT guid, dedup_key, domain, origin, url FROM products WHERE name_key=? AND guid<>? LIMIT 60', [nk, entry.guid]);
  if (!cands.length) cands = db.all<Cand>('SELECT guid, dedup_key, domain, origin, url FROM products WHERE name_key IS NULL AND name=? COLLATE NOCASE AND guid<>? LIMIT 60', [entry.name, entry.guid]);
  return pickDuplicate(entry, cands);
}

const FIELDS = ['tagline', 'description', 'category', 'logo_url', 'logo_local', 'pricing', 'maker', 'country', 'ai_summary', 'ai_analysis', 'enrich_json', 'enriched_at', 'enrich_status'];
/** 打分：选保留方 */
export function winnerScore(p: any): number {
  let s = 0; if (p.origin === 'manual') s += 1e9; if (p.fav) s += 1e8; if (p.notes && String(p.notes).trim()) s += 1e7;
  if (p.url) s += 1e6; if (keyKind(p.dedup_key) === 'host') s += 5e5;
  for (const f of FIELDS) if (p[f] != null && p[f] !== '') s += 1e4;
  s += Math.min(9999, (p.launch_count || 0) * 10 + Math.log10(1 + (p.votes || 0)));
  return s;
}

/** 把 loser 合并进 winner：补全字段、合并标签/平台/来源版本/收藏/备注、重定向 alt_rel、记别名；删除 loser（墓碑带 merged_into） */
export function mergeInto(db: DB, winnerGuid: string, loserGuid: string): boolean {
  if (winnerGuid === loserGuid) return false;
  const w = db.get<any>('SELECT * FROM products WHERE guid=?', [winnerGuid]); const l = db.get<any>('SELECT * FROM products WHERE guid=?', [loserGuid]);
  if (!w || !l) return false;
  if (l.origin === 'manual' && w.origin !== 'manual') return mergeInto(db, loserGuid, winnerGuid);
  if (l.origin === 'manual' && w.origin === 'manual') return false;
  const sets: string[] = []; const vals: any[] = [];
  for (const f of FIELDS) {
    const wv = w[f], lv = l[f];
    if ((wv == null || wv === '') && lv != null && lv !== '') { sets.push(`${f}=?`); vals.push(lv); }
    else if (f === 'description' && lv && w.origin !== 'manual' && String(lv).length > String(wv || '').length * 1.5) { sets.push(`${f}=?`); vals.push(lv); }
  }
  if (!w.url && l.url) { sets.push('url=?', 'domain=?'); vals.push(l.url, l.domain); }
  const tags = [...new Set([...safeJson<string[]>(w.tags, []), ...safeJson<string[]>(l.tags, [])])]; if (tags.length !== safeJson<string[]>(w.tags, []).length) { sets.push('tags=?'); vals.push(JSON.stringify(tags.slice(0, 40))); }
  const plats = [...new Set([...safeJson<string[]>(w.platforms, []), ...safeJson<string[]>(l.platforms, [])])]; if (plats.length !== safeJson<string[]>(w.platforms, []).length) { sets.push('platforms=?'); vals.push(JSON.stringify(plats)); }
  if ((l.votes || 0) > (w.votes || 0)) { sets.push('votes=?'); vals.push(l.votes); }
  if (l.first_seen && (!w.first_seen || l.first_seen < w.first_seen)) { sets.push('first_seen=?'); vals.push(l.first_seen); }
  if (l.launch_date && (!w.launch_date || l.launch_date < w.launch_date)) { sets.push('launch_date=?'); vals.push(l.launch_date); }
  if (l.last_seen && (!w.last_seen || l.last_seen > w.last_seen)) { sets.push('last_seen=?'); vals.push(l.last_seen); }
  const ln = String(l.notes || '').trim(), wn = String(w.notes || '').trim();
  if (ln && ln !== wn) { sets.push('notes=?'); vals.push(wn ? `${wn}\n${ln}` : ln); }
  if (!w.name_key) { sets.push('name_key=?'); vals.push(nameKey(w.name)); }
  // 来源版本 / 收藏 / alt_rel
  db.run('UPDATE OR IGNORE product_versions SET product_guid=? WHERE product_guid=?', [winnerGuid, loserGuid]);
  db.run('DELETE FROM product_versions WHERE product_guid=?', [loserGuid]);
  db.run('INSERT OR IGNORE INTO favorites(product_guid, created_at) SELECT ?, created_at FROM favorites WHERE product_guid=?', [winnerGuid, loserGuid]);
  db.run('DELETE FROM favorites WHERE product_guid=?', [loserGuid]);
  db.run('INSERT OR IGNORE INTO alt_rel(target, product_guid, src) SELECT target, ?, src FROM alt_rel WHERE product_guid=?', [winnerGuid, loserGuid]);
  db.run('DELETE FROM alt_rel WHERE product_guid=?', [loserGuid]);
  const lk = nameKey(l.name), wk = nameKey(w.name);
  if (lk && wk && lk !== wk) db.run('UPDATE OR IGNORE alt_rel SET target=? WHERE target=?', [wk, lk]);
  // 别名：loser 及以 loser 为目标的别名都指向 winner
  db.run('UPDATE product_alias SET guid=? WHERE guid=?', [winnerGuid, loserGuid]);
  db.run('INSERT OR REPLACE INTO product_alias(alias, guid) VALUES(?,?)', [loserGuid, winnerGuid]);
  db.run('DELETE FROM product_alias WHERE alias=?', [winnerGuid]);
  db.run('DELETE FROM products WHERE guid=?', [loserGuid]);
  db.run('UPDATE deleted_products SET merged_into=? WHERE guid=?', [winnerGuid, loserGuid]);
  sets.push('launch_count=(SELECT COUNT(*) FROM product_versions WHERE product_guid=?)', 'updated_at=?'); vals.push(winnerGuid, new Date().toISOString());
  db.run(`UPDATE products SET ${sets.join(',')} WHERE guid=?`, [...vals, winnerGuid]);
  return true;
}

/** 一组同产品候选里选保留方并合并其余；返回 [winner, losers] */
export function mergeGroup(db: DB, guids: string[]): { winner: string; losers: string[] } | null {
  if (guids.length < 2) return null;
  const rows = guids.map(g => db.get<any>(`SELECT guid, origin, notes, url, dedup_key, launch_count, votes, ${FIELDS.join(',')}, (SELECT 1 FROM favorites f WHERE f.product_guid=products.guid) fav FROM products WHERE guid=?`, [g])).filter(Boolean);
  if (rows.length < 2) return null;
  if (rows.filter(r => r.origin === 'manual').length > 1) { const keep = rows.filter(r => r.origin !== 'manual'); const man = rows.find(r => r.origin === 'manual'); rows.length = 0; rows.push(man, ...keep); }
  rows.sort((a, b) => winnerScore(b) - winnerScore(a));
  const winner = rows[0].guid; const losers: string[] = [];
  for (const r of rows.slice(1)) if (mergeInto(db, winner, r.guid)) losers.push(r.guid);
  return losers.length ? { winner, losers } : null;
}

/**
 * 把同名称键的一组产品划分为「同一产品」簇（整库去重用），规则同 pickDuplicate。
 * 返回需要合并的簇（每个 ≥2 条）及命中的规则。
 */
export function clusterSameName(rows: Cand[]): { guids: string[]; rule: string }[] {
  const out: { guids: string[]; rule: string }[] = [];
  const byCluster = new Map<string, Cand[]>(); const nameOnly: Cand[] = []; const urlRows: Cand[] = [];
  for (const r of rows) { const k = keyKind(r.dedup_key); if (k === 'name') nameOnly.push(r); else if (k === 'url' || isSharedHost(r.domain)) urlRows.push(r); else { const c = clusterOf(r)!; byCluster.set(c, [...(byCluster.get(c) || []), r]); } }
  // R3：共享域名路径 → owner 与唯一官网域名主体一致
  const rest: Cand[] = [];
  for (const u of urlRows) {
    const ow = keyKind(u.dedup_key) === 'url' ? urlOwner(u.dedup_key) : '';
    const hits = ow ? [...byCluster.entries()].filter(([, l]) => l[0].domain && domainLabel(l[0].domain) === ow) : [];
    if (hits.length === 1) hits[0][1].push(Object.assign(u, { _rule: 'R3' } as any)); else rest.push(u);
  }
  // 共享域名路径之间：key 去掉 # 后缀相同（R1）
  const byUrl = new Map<string, Cand[]>(); for (const u of rest) { const c = clusterOf(u)!; byUrl.set(c, [...(byUrl.get(c) || []), u]); }
  const all = [...byCluster.entries(), ...byUrl.entries()];
  // R4：无网址条目 → 唯一簇
  if (nameOnly.length) {
    if (all.length === 1) all[0][1].push(...nameOnly.map(n => Object.assign(n, { _rule: 'R4' } as any)));
    else if (all.length === 0 && nameOnly.length > 1) all.push(['n:', nameOnly.map(n => Object.assign(n, { _rule: 'R1' } as any))]);
  }
  for (const [c, l] of all) if (l.length > 1) {
    const rules = new Set<string>(l.map((x: any) => x._rule).filter(Boolean));
    if (c.startsWith('d:')) { const hosts = new Set(l.filter(x => keyKind(x.dedup_key) === 'host').map(x => x.domain)); if (hosts.size > 1) rules.add('R2'); else if (l.filter(x => keyKind(x.dedup_key) === 'host').length > 1) rules.add('R1'); }
    else if (l.filter(x => keyKind(x.dedup_key) !== 'name').length > 1) rules.add('R1');
    out.push({ guids: l.map(x => x.guid), rule: [...rules].sort().join('+') || 'R1' });
  }
  return out;
}
