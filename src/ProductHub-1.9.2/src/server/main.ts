/** 独立服务入口：桌面版内嵌 / 内部预览站点（--readonly） */
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { DB } from './db';
import { startServer } from './server';
import { importSourcesCsv } from './sources';

export async function boot(opts: { dataDir: string; uiDir?: string; readOnly?: boolean; port?: number; host?: string; seedDb?: string; seedCsv?: string; scheduler?: boolean; fetcher?: import('./crawler').Fetcher }) {
  fs.mkdirSync(opts.dataDir, { recursive: true });
  const dbFile = path.join(opts.dataDir, 'producthub.db');
  // 首次启动：用预缓存的历史数据库 + 图片初始化
  const gz = opts.seedDb ? opts.seedDb + '.gz' : '';
  // 版本升级：安装包内种子版本与已安装数据不同 → 备份旧库，换新种子库，并迁移收藏/筛选/设置
  const seedVerFile = opts.seedDb ? path.join(path.dirname(opts.seedDb), 'seed-version.txt') : '';
  const seedVer = seedVerFile && fs.existsSync(seedVerFile) ? fs.readFileSync(seedVerFile, 'utf8').trim() : '';
  const verFile = path.join(opts.dataDir, 'seed-version.txt');
  const instVer = fs.existsSync(verFile) ? fs.readFileSync(verFile, 'utf8').trim() : '';
  let carry: Record<string, any[]> | null = null;
  if (seedVer && fs.existsSync(dbFile) && instVer !== seedVer && (fs.existsSync(opts.seedDb!) || fs.existsSync(gz))) {
    try {
      const old = await DB.open(dbFile); carry = {};
      for (const t of ['favorites', 'saved_filters', 'settings']) { try { carry[t] = old.all<any>(`SELECT * FROM ${t}`); } catch { /* 表不存在 */ } }
      // 新种子自带数据版本号：旧库的增量进度（delta.seq 等）不能覆盖新种子；只保留用户配置的更新地址/自动检查开关
      if (carry.settings) carry.settings = carry.settings.filter((r: any) => !String(r.key).startsWith('delta.') || ['delta.updateUrl', 'delta.autoCheck'].includes(r.key));
      try { (old as any).db.close(); } catch { /* */ }
    } catch (e) { console.error('读取旧库失败，仅备份', e); carry = null; }
    fs.renameSync(dbFile, dbFile + '.bak-' + (instVer || 'old').replace(/[^\w.-]/g, '_'));
  }
  if (!fs.existsSync(dbFile) && opts.seedDb && (fs.existsSync(opts.seedDb) || fs.existsSync(gz))) {
    // 安装包内种子库可为 gzip（v1.6 全量库很大，用流式解压避免内存爆）
    if (fs.existsSync(opts.seedDb)) fs.copyFileSync(opts.seedDb, dbFile);
    else {
      const { pipeline } = await import('node:stream/promises');
      const { createGunzip } = await import('node:zlib');
      await pipeline(fs.createReadStream(gz), createGunzip(), fs.createWriteStream(dbFile));
    }
    const seedImg = path.join(path.dirname(opts.seedDb), 'images'); const dst = path.join(opts.dataDir, 'images');
    if (fs.existsSync(seedImg)) { fs.mkdirSync(dst, { recursive: true }); for (const f of fs.readdirSync(seedImg)) {
      const a = path.join(seedImg, f), b = path.join(dst, f); if (!fs.existsSync(b)) fs.copyFileSync(a, b);
    } }
  }
  const db = await DB.open(dbFile);
  if (carry) { for (const [t, rows] of Object.entries(carry)) for (const r of rows) { const k = Object.keys(r); try { db.run(`INSERT OR REPLACE INTO ${t}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`, k.map(x => r[x])); } catch { /* 跳过 */ } } db.saveNow(); }
  if (seedVer) fs.writeFileSync(verFile, seedVer);
  if (opts.seedCsv && fs.existsSync(opts.seedCsv) && !db.get<any>('SELECT COUNT(*) c FROM sources').c) importSourcesCsv(db, fs.readFileSync(opts.seedCsv, 'utf8'));
  const srv = await startServer({ db, dataDir: opts.dataDir, uiDir: opts.uiDir, readOnly: opts.readOnly, port: opts.port, host: opts.host, scheduler: opts.scheduler, fetcher: opts.fetcher });
  return { ...srv, db };
}

if (require.main === module && !process.versions.electron) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined; };
  const root = path.resolve(__dirname, '..');
  boot({ dataDir: arg('--data') || process.env.PH_DATA || path.join(root, 'data', 'runtime'), uiDir: path.join(root, 'dist-ui'), readOnly: process.argv.includes('--readonly'), port: +(arg('--port') || process.env.PORT || 8787), host: arg('--host') || '0.0.0.0', seedDb: path.join(root, 'data', 'seed', 'producthub.db'), seedCsv: path.join(root, 'data', 'sources.csv'), scheduler: !process.argv.includes('--readonly') && !process.argv.includes('--no-scheduler'), fetcher: arg('--web-fixtures') ? require('./fixture-fetcher').fixtureFetcher(path.resolve(arg('--web-fixtures')!)) : undefined })
    .then(s => console.log(`产品库服务已启动 ${s.url} ${process.argv.includes('--readonly') ? '(只读预览)' : ''}`));
}
