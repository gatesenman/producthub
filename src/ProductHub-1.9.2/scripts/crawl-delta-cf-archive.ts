/**
 * Cloudflare 公开存档回退实跑（至 2026-11-09）
 * 只用 Wayback / Common Crawl / 直连公开页；不过挑战。
 *
 *   PATH=.../node-v22.../bin:$PATH npx tsx scripts/crawl-delta-cf-archive.ts [--only=sourceforge,alternativeto,saashub,f6s,others]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DB, now } from '../src/server/db';
import { upsertProduct } from '../src/server/products';
import { isArticleNoise } from '../src/server/history';
import { slugName } from '../src/server/util';
import {
  CF_PRIORITY_TARGETS,
  ArchiveProductCandidate,
  resolveViaPublicArchives,
  waybackAvailable,
  fetchWaybackSnapshot,
  parseProductsFromArchive,
  probeDirect,
  commonCrawlQuery,
  fetchCommonCrawlRecord,
  SiteKind,
} from '../src/server/archive-fallback';

const ARGS = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const ONLY = new Set(String(ARGS.only || 'sourceforge,alternativeto,saashub,f6s,others').split(',').filter(Boolean));
const DIR = path.resolve('data/crawl');
const DBF = path.join(DIR, 'producthub.db');
const DELTA = path.resolve('data/delta');
const LOGF = path.resolve('logs/crawl-delta-cf-archive.log');
const TMP = path.resolve('data/delta/cf-archive-tmp');
fs.mkdirSync(DELTA, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(path.dirname(LOGF), { recursive: true });

const log = (s: string) => {
  const line = `[${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })}] ${s}`;
  fs.appendFileSync(LOGF, line + '\n');
  console.log(line);
};

const NOISE_NAME = /^(登录|注册|关于我们|公司动态|帮助中心|首页|home|about|contact|privacy|terms|blog|news|login|signup|sign up|categories|tools|confidential|stealth|see project|compare|for vendors|create|join|help)$/i;

type SrcRow = { guid: string; seq: number; name: string; url: string; product_count: number };

function findSource(db: DB, name: string): SrcRow | undefined {
  return db.get<SrcRow>('SELECT guid, seq, name, url, product_count FROM sources WHERE name=? COLLATE NOCASE', [name]);
}

async function ingest(db: DB, src: SrcRow, strategy: string, items: ArchiveProductCandidate[], channelNote: string) {
  let inserted = 0, updated = 0, n = 0, noise = 0;
  const batch: ArchiveProductCandidate[] = [];
  for (const it of items) {
    if (!it.name || it.name.length < 2) continue;
    if (isArticleNoise(it.name, it.url) || NOISE_NAME.test(it.name.trim())) { noise++; continue; }
    batch.push(it);
  }
  for (let i = 0; i < batch.length; i += 1000) {
    const chunk = batch.slice(i, i + 1000);
    db.tx(() => {
      for (const it of chunk) {
        try {
          const r = upsertProduct(db, {
            name: it.name,
            url: it.url,
            tagline: it.tagline || null,
            description: it.description || null,
          }, { sourceGuid: src.guid, origin: 'crawl-cf-archive', versionLabel: `${src.name}:${it.channel}` });
          n++;
          if (r.status === 'inserted') inserted++;
          else if (r.status === 'updated' || r.newVersion) updated++;
        } catch { /* skip */ }
      }
    });
  }
  const pc = db.get<any>('SELECT COUNT(DISTINCT product_guid) c FROM product_versions WHERE source_guid=?', [src.guid]).c;
  const status = pc ? 'ok' : 'empty';
  db.run('UPDATE sources SET last_crawl_at=?, last_status=?, last_error=?, product_count=? WHERE guid=?',
    [now(), status, channelNote.slice(0, 280), pc, src.guid]);
  try {
    db.run(
      'INSERT OR REPLACE INTO crawl_state(source_guid,strategy,cursor,pages,items,inserted,status,earliest,last_error,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [src.guid, strategy, null, 1, n, inserted, 'done', null, channelNote.slice(0, 280), now()],
    );
  } catch { /* */ }
  return { n, inserted, updated, pc, noise };
}

const summary: any = {
  timezone: 'Asia/Shanghai',
  startedAt: new Date().toISOString(),
  before: 0, after: 0, delta: 0,
  bySource: {} as Record<string, any>,
  noPublicChannel: [] as { name: string; reason: string; evidence: string[] }[],
  packed: false,
};

async function runTarget(db: DB, t: typeof CF_PRIORITY_TARGETS[0]) {
  const src = findSource(db, t.name);
  if (!src) { log(`skip ${t.name}: source row missing`); return; }
  log(`▶ ${t.name} (seq=${src.seq} pc=${src.product_count})`);
  const res = await resolveViaPublicArchives({
    name: t.name, kind: t.kind, directUrls: t.directUrls, archiveUrls: t.archiveUrls, ccPatterns: t.ccPatterns, log,
  });
  const channelNote = `channels=${res.channelsUsed.join(',')||'none'}; items=${res.items.length}; challenged=${res.challenged}`;
  log(`  ${channelNote}`);
  for (const e of res.evidence.slice(0, 30)) log(`  · ${e}`);

  const ing = await ingest(db, src, `cf-archive-${t.kind}`, res.items, channelNote);
  summary.bySource[t.name] = {
    seq: src.seq,
    beforePc: src.product_count,
    afterPc: ing.pc,
    found: res.items.length,
    inserted: ing.inserted,
    updated: ing.updated,
    noise: ing.noise,
    channels: res.channelsUsed,
    challenged: res.challenged,
    evidence: res.evidence,
    probes: res.probes,
  };
  if (!res.items.length && res.challenged) {
    summary.noPublicChannel.push({
      name: t.name,
      reason: '直连挑战/封锁，公开存档未解析出产品或归档不可用',
      evidence: res.evidence,
    });
  }
  log(`✔ ${t.name}: found=${res.items.length} 新=${ing.inserted} upd=${ing.updated} pc=${ing.pc}`);
}

/** 其余 CF 源：仅探测 + available，有快照就解析通用链接 */
const OTHER_CF: { name: string; kind: SiteKind; urls: string[]; archiveUrls: string[] }[] = [
  { name: 'Tools.so', kind: 'generic', urls: ['https://tools.so', 'https://www.tools.so'], archiveUrls: ['tools.so', 'www.tools.so'] },
  { name: 'NoCode.Tech', kind: 'generic', urls: ['https://nocode.tech', 'https://nocode.tech/sitemap.xml'], archiveUrls: ['nocode.tech'] },
  { name: 'SelectHub', kind: 'generic', urls: ['https://www.selecthub.com', 'https://www.selecthub.com/sitemap.xml'], archiveUrls: ['www.selecthub.com', 'selecthub.com'] },
  { name: 'SpotSaaS', kind: 'generic', urls: ['https://spotsaas.com'], archiveUrls: ['spotsaas.com'] },
  { name: 'Startup Buffer', kind: 'generic', urls: ['https://startupbuffer.com'], archiveUrls: ['startupbuffer.com'] },
  { name: 'Saaspo', kind: 'generic', urls: ['https://saaspo.com'], archiveUrls: ['saaspo.com'] },
  { name: 'EU-Startups', kind: 'generic', urls: ['https://www.eu-startups.com', 'https://www.eu-startups.com/feed/'], archiveUrls: ['www.eu-startups.com'] },
  { name: 'Trustpilot', kind: 'generic', urls: ['https://www.trustpilot.com/categories/software'], archiveUrls: ['www.trustpilot.com/categories/software'] },
  { name: 'IT桔子', kind: 'generic', urls: ['https://www.itjuzi.com', 'https://m.itjuzi.com'], archiveUrls: ['www.itjuzi.com', 'itjuzi.com'] },
];

async function runOthers(db: DB) {
  for (const t of OTHER_CF) {
    const src = findSource(db, t.name);
    if (!src) { log(`skip other ${t.name}: no row`); continue; }
    log(`▶ other ${t.name}`);
    const probes = await probeDirect(t.urls);
    const evidence = probes.map(p => `direct ${p.url} → HTTP ${p.status} ${p.reason || ''}`);
    let items: ArchiveProductCandidate[] = [];
    const channels: string[] = [];
    for (const au of t.archiveUrls) {
      const av = await waybackAvailable(au);
      evidence.push(av.evidence);
      if (!av.snapshotUrl) continue;
      const snap = await fetchWaybackSnapshot({ snapshotUrl: av.snapshotUrl });
      evidence.push(snap.evidence);
      if (snap.ok) {
        channels.push('wayback');
        items = items.concat(parseProductsFromArchive(t.kind, snap.html, au, 'wayback'));
      }
    }
    // light CC exact
    for (const au of t.archiveUrls.slice(0, 1)) {
      const pat = au.startsWith('http') ? au : `https://${au}`;
      const q = await commonCrawlQuery(pat, { limit: 3, maxIndexes: 4 });
      evidence.push(q.evidence);
      for (const hit of q.hits.slice(0, 1)) {
        const rec = await fetchCommonCrawlRecord(hit);
        evidence.push(rec.evidence);
        if (rec.ok) {
          channels.push('commoncrawl');
          items = items.concat(parseProductsFromArchive(t.kind, rec.html, hit.original || pat, 'commoncrawl'));
        }
      }
    }
    // dedupe
    const seen = new Set<string>();
    items = items.filter(i => { const k = slugName(i.name) + '|' + i.url; if (seen.has(k)) return false; seen.add(k); return true; });
    const channelNote = `channels=${[...new Set(channels)].join(',')||'none'}; items=${items.length}`;
    const ing = await ingest(db, src, 'cf-archive-other', items, channelNote);
    summary.bySource[t.name] = {
      seq: src.seq, beforePc: src.product_count, afterPc: ing.pc,
      found: items.length, inserted: ing.inserted, updated: ing.updated,
      channels: [...new Set(channels)], evidence, probes,
    };
    if (!items.length) {
      summary.noPublicChannel.push({
        name: t.name,
        reason: '公开存档/API 未拿到可用产品列表',
        evidence,
      });
    }
    log(`✔ other ${t.name}: found=${items.length} 新=${ing.inserted} pc=${ing.pc}`);
  }
}

(async () => {
  log(`==== crawl-delta-cf-archive 启动 only=${[...ONLY]} ====`);
  const db = await DB.open(DBF);
  const before = db.get<any>('SELECT COUNT(*) p FROM products').p;
  summary.before = before;
  log(`产品数 before=${before}`);

  for (const t of CF_PRIORITY_TARGETS) {
    const key = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const aliases: Record<string, string> = {
      sourceforge: 'sourceforge', alternativeto: 'alternativeto', saashub: 'saashub', f6s: 'f6s',
    };
    const token = aliases[key] || key;
    if (![...ONLY].some(o => o === token || o === t.name.toLowerCase())) continue;
    await runTarget(db, t);
  }
  if (ONLY.has('others')) await runOthers(db);

  const after = db.get<any>('SELECT COUNT(*) p FROM products').p;
  summary.after = after;
  summary.delta = after - before;
  summary.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(DELTA, 'cf-archive-summary.json'), JSON.stringify(summary, null, 2));
  try { db.setSetting('crawl.cfArchiveFinishedAt', new Date().toISOString()); } catch { /* */ }
  try { db.saveNow(); } catch { /* */ }
  log(`==== 完成 products ${before} → ${after} (+${after - before}) ====`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* */ }
  process.exit(0);
})().catch(e => { log('FATAL ' + (e?.stack || e)); process.exit(1); });
