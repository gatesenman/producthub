/**
 * 增量更新后台任务：检查 → 下载（断点续传/校验）→ 后台线程合并 → 刷新缓存
 * 同时只允许一个任务；界面轮询 GET /api/delta/job 获取进度
 */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { DB, now } from './db';
import { applyDelta, checkDelta, downloadVerified, DeltaError, sha256, type ApplyResult, type CheckResult } from './delta';

export type JobState = { id: number; kind: 'update' | 'apply'; state: 'running' | 'done' | 'error'; phase: string; step: number; steps: number; done: number; total: number; bytes: number; totalBytes: number;
  message: string; results: ApplyResult[]; error?: { code: string; message: string } | null; started_at: string; finished_at?: string; check?: CheckResult | null; worker: boolean; product_count_before?: number; product_count_after?: number };

function workerFile(): string | null {
  if (process.env.PH_DELTA_WORKER === '0') return null;
  const f = path.join(__dirname, 'delta-worker.js');
  const unpacked = f.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  if (fs.existsSync(unpacked)) return unpacked; if (fs.existsSync(f)) return f; return null;
}
function nativeBindingPath(): string | undefined {
  try { const p = require.resolve('better-sqlite3/build/Release/better_sqlite3.node'); return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'); } catch { return undefined; }
}

export class DeltaJobs {
  job: JobState | null = null; private seq = 0;
  constructor(private db: DB, private dataDir: string, private hooks: { before?: () => void | Promise<void>; after?: () => void } = {}) {}
  get running() { return this.job?.state === 'running'; }
  status() { return this.job; }
  private begin(kind: JobState['kind'], steps: number): JobState {
    if (this.running) throw new DeltaError('busy', '已有增量更新任务在进行中');
    this.job = { id: ++this.seq, kind, state: 'running', phase: 'start', step: 0, steps, done: 0, total: 0, bytes: 0, totalBytes: 0, message: '准备中', results: [], error: null, started_at: now(), worker: false, product_count_before: this.count() };
    return this.job;
  }
  private count() { return this.db.get<any>('SELECT COUNT(*) c FROM products')?.c || 0; }
  private finish(j: JobState, err?: any) {
    j.finished_at = now(); j.product_count_after = this.count(); this.db.rev++;
    if (err) { j.state = 'error'; j.error = { code: err.code || 'error', message: String(err.message || err) }; j.message = j.error.message; }
    else { j.state = 'done'; j.phase = 'done'; const ins = j.results.reduce((a, r) => a + r.inserted, 0), upd = j.results.reduce((a, r) => a + r.updated, 0), del = j.results.reduce((a, r) => a + r.deleted, 0);
      j.message = j.results.length && j.results.every(r => r.status === 'already-applied') ? '已是最新，无需合并' : j.results.length ? `更新完成：新增 ${ins}，更新 ${upd}，删除 ${del}（库 ${j.product_count_before} → ${j.product_count_after}）` : j.message; }
    try { this.hooks.after?.(); } catch { /* */ }
  }

  /** 在后台线程应用；后台线程不可用时退回主线程（仍是单事务） */
  applyFile(file: string, expect?: { sha256?: string; size?: number }, onProgress?: (p: any) => void): Promise<ApplyResult & { worker: boolean }> {
    const wf = this.db.file ? workerFile() : null;
    const inProcess = () => { const r = applyDelta(this.db, fs.readFileSync(file), onProgress, expect); return { ...r, worker: false }; };
    if (!wf) return Promise.resolve().then(inProcess);
    return new Promise((resolve, reject) => {
      let settled = false, ready = false;
      const w = new Worker(wf, { workerData: { dbFile: this.db.file, file, expect, nativeBinding: nativeBindingPath() } });
      w.on('message', (m: any) => {
        if (m.type === 'ready') ready = true;
        else if (m.type === 'progress') onProgress?.(m.p);
        else if (m.type === 'result') { settled = true; resolve({ ...m.r, worker: true }); }
        else if (m.type === 'error') { settled = true; reject(new DeltaError(m.code, m.message)); }
      });
      w.on('error', e => { if (settled) return; settled = true; if (!ready) { try { resolve(inProcess()); } catch (x) { reject(x); } } else reject(e); });
      w.on('exit', c => { if (!settled) { settled = true; if (!ready) { try { resolve(inProcess()); } catch (x) { reject(x); } } else reject(new DeltaError('worker', '合并线程异常退出 ' + c)); } });
    });
  }

  /** 从索引/URL 完整更新：按更新链逐个下载 + 校验 + 合并 */
  startUpdate(url: string, fetchImpl?: typeof fetch): JobState {
    const j = this.begin('update', 0);
    (async () => {
      try {
        await this.hooks.before?.();
        j.phase = 'check'; j.message = '检查更新…'; const c = await checkDelta(this.db, url, fetchImpl); j.check = c;
        this.db.setSetting('delta.lastCheckAt', c.checkedAt); this.db.setSetting('delta.lastCheck', JSON.stringify({ ...c, plan: c.plan.map(p => ({ from_seq: p.from_seq, to_seq: p.to_seq, size: p.size, products: p.products })) }));
        if (c.gap) throw new DeltaError('seq-gap', c.message);
        if (!c.plan.length) { j.message = c.message; this.finish(j); return; }
        j.steps = c.plan.length; j.totalBytes = c.totalBytes; let base = 0;
        const cache = path.join(this.dataDir, 'delta-cache'); fs.mkdirSync(cache, { recursive: true });
        for (const [i, p] of c.plan.entries()) {
          j.step = i + 1; j.phase = 'download'; j.message = `下载增量包 ${i + 1}/${c.plan.length}（#${p.from_seq}→#${p.to_seq}）`;
          const dest = path.join(cache, `delta-${p.from_seq}-${p.to_seq}-${(p.sha256 || sha256(p.href)).slice(0, 12)}.phdelta.json.gz`);
          await downloadVerified(p.href, dest, { sha256: p.sha256 || undefined, size: p.size || undefined }, { fetchImpl, onProgress: (got) => { j.bytes = base + got; } });
          base += p.size || fs.statSync(dest).size; j.bytes = base;
          j.phase = 'apply'; j.message = `合并增量包 ${i + 1}/${c.plan.length}`; j.done = 0; j.total = p.products || 0;
          const r = await this.applyFile(dest, { sha256: p.sha256 || undefined }, pr => { j.done = pr.done; j.total = pr.total || j.total; if (pr.message) j.message = `合并 ${i + 1}/${c.plan.length}：${pr.message}`; });
          j.worker = j.worker || r.worker; j.results.push(r); this.db.rev++;
          try { fs.rmSync(dest, { force: true }); } catch { /* */ }
        }
        this.finish(j);
      } catch (e) { this.finish(j, e); }
    })();
    return j;
  }

  /** 应用本地文件 / 上传包 */
  startApplyFile(file: string, cleanup = false): JobState {
    const j = this.begin('apply', 1);
    (async () => {
      try { await this.hooks.before?.(); j.step = 1; j.phase = 'apply'; j.message = '校验并合并本地增量包';
        const r = await this.applyFile(file, undefined, pr => { j.done = pr.done; j.total = pr.total; if (pr.message) j.message = pr.message; });
        j.worker = r.worker; j.results.push(r); this.finish(j);
      } catch (e) { this.finish(j, e); } finally { if (cleanup) try { fs.rmSync(file, { force: true }); } catch { /* */ } }
    })();
    return j;
  }
  /** 等待当前任务结束（测试/兼容旧接口） */
  async wait(timeoutMs = 600_000): Promise<JobState> { const t = Date.now(); while (this.running && Date.now() - t < timeoutMs) await new Promise(r => setTimeout(r, 50)); return this.job!; }
}
