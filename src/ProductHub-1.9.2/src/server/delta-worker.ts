/** 后台线程：在独立 SQLite 连接上应用增量包（单事务），主线程/界面不被阻塞 */
import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { DB } from './db';
import { applyDelta } from './delta';

const { dbFile, file, expect, nativeBinding } = workerData as { dbFile: string; file: string; expect?: { sha256?: string; size?: number }; nativeBinding?: string };
parentPort!.postMessage({ type: 'ready' });
let db: DB | null = null;
try {
  const raw = new Database(dbFile, nativeBinding && fs.existsSync(nativeBinding) ? { nativeBinding } : {});
  db = new DB(raw, dbFile); raw.pragma('busy_timeout = 60000');
  let last = 0;
  const r = applyDelta(db, fs.readFileSync(file), p => { const t = Date.now(); if (t - last > 150 || p.phase === 'done') { last = t; parentPort!.postMessage({ type: 'progress', p }); } }, expect);
  parentPort!.postMessage({ type: 'result', r });
} catch (e: any) {
  parentPort!.postMessage({ type: 'error', code: e?.code || 'apply', message: String(e?.message || e) });
} finally { try { db?.db.close(); } catch { /* */ } }
