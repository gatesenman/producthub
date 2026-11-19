import type { DB } from './db';
import { crawlSource } from './crawler';

export class Scheduler {
  private timer: NodeJS.Timeout | null = null; private bootTimer: NodeJS.Timeout | null = null;
  running = false; lastTick: string | null = null; log: string[] = [];
  private dueCache: { rev: number; t: number; n: number } | null = null;
  constructor(private db: DB, private imageDir: string) {}
  get enabled() { try { return this.db.isOpen() && this.db.getSetting('scheduler.enabled', '1') === '1'; } catch { return false; } }
  /** 到期来源：启用 且 从未抓取或距上次抓取超过间隔；失败的来源按 3 倍间隔退避 */
  dueSources(limit: number) {
    return this.db.all<any>(`SELECT guid,name FROM sources WHERE enabled=1 AND interval_min > 0 AND (last_crawl_at IS NULL OR
      (julianday('now') - julianday(last_crawl_at)) * 1440 >= interval_min * (CASE WHEN last_status='error' THEN 3 ELSE 1 END))
      ORDER BY last_crawl_at IS NOT NULL, last_crawl_at, seq LIMIT ?`, [limit]);
  }
  private dueCount() {
    const now = Date.now();
    if (this.dueCache && this.dueCache.rev === this.db.rev && now - this.dueCache.t < 30_000) return this.dueCache.n;
    const n = this.dueSources(1000).length;
    this.dueCache = { rev: this.db.rev, t: now, n }; return n;
  }
  async tick(limit = Number(this.db.getSetting('scheduler.batch', '5'))) {
    if (!this.db.isOpen() || this.running) return { skipped: true }; this.running = true; this.lastTick = new Date().toISOString();
    const out: any[] = [];
    try { for (const s of this.dueSources(limit)) { const r = await crawlSource(this.db, s.guid, { imageDir: this.imageDir }); out.push({ name: s.name, ...r }); this.log.unshift(`${new Date().toLocaleString('zh-CN')} ${s.name}: ${r.error ? '失败 ' + r.error : `发现 ${r.found}，新增 ${r.inserted}，更新 ${r.updated}`}`); }
      this.log = this.log.slice(0, 200); this.dueCache = null;
    } finally { this.running = false; this.db.saveNow(); }
    return { results: out };
  }
  /** v1.9.1：按给定来源顺序抓取（「只重试失败的源」/ 批量抓取），后台执行，可在状态里看进度 */
  job: { kind: string; total: number; done: number; ok: number; failed: number; startedAt: string; finishedAt?: string; current?: string } | null = null;
  runList(guids: string[], kind = 'retry') {
    if (this.running) throw Object.assign(new Error('正在抓取中，请稍后再试'), { code: 'busy' });
    this.running = true; const job = this.job = { kind, total: guids.length, done: 0, ok: 0, failed: 0, startedAt: new Date().toISOString() } as NonNullable<Scheduler['job']>;
    (async () => { try { for (const g of guids) { const s = this.db.get<any>('SELECT name FROM sources WHERE guid=?', [g]); job.current = s?.name; const r: any = await crawlSource(this.db, g, { imageDir: this.imageDir }); job.done++; r.error || !r.found ? job.failed++ : job.ok++;
        this.log.unshift(`${new Date().toLocaleString('zh-CN')} ${s?.name}: ${r.error ? '失败 ' + r.error : `发现 ${r.found}，新增 ${r.inserted}，更新 ${r.updated}${r.method ? '（' + r.method + '）' : ''}`}`); } }
      finally { job.finishedAt = new Date().toISOString(); job.current = undefined; this.running = false; this.dueCache = null; this.log = this.log.slice(0, 200); this.db.saveNow(); } })();
    return job;
  }
  private stopped = true;
  /** 启动后推迟首轮抓取，避免与 UI 冷启动抢 CPU/磁盘 */
  start(everyMs = 60_000, bootDelayMs = 45_000) {
    this.stop();
    this.stopped = false;
    this.bootTimer = setTimeout(() => this.safeTick(), bootDelayMs);
    this.timer = setInterval(() => this.safeTick(), everyMs);
  }
  /** 定时回调：库已关闭或 stop 后不得抛到事件循环 */
  private safeTick() { try { if (!this.stopped && this.enabled) this.tick().catch(() => {}); } catch { /* */ } }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = null; if (this.bootTimer) clearTimeout(this.bootTimer); this.bootTimer = null; }
  /** 停表后等待进行中的 tick / runList 结束，超时则放弃，供退出流程调用 */
  async drain(timeoutMs = 5_000) {
    this.stop();
    const start = Date.now();
    while (this.running && Date.now() - start < timeoutMs) await new Promise(r => setTimeout(r, 25));
  }
  status() {
    try { return { enabled: this.enabled, running: this.running, lastTick: this.lastTick, batch: Number(this.db.getSetting('scheduler.batch', '5')), due: this.dueCount(), log: this.log.slice(0, 30), job: this.job }; }
    catch { return { enabled: false, running: this.running, lastTick: this.lastTick, batch: 5, due: 0, log: this.log.slice(0, 30), job: this.job }; }
  }
}
