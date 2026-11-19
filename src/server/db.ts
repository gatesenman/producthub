import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
// eslint-disable-next-line
const req: NodeRequire = typeof require !== 'undefined' ? require : createRequire(import.meta.url);


export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  guid TEXT PRIMARY KEY, seq INTEGER, name TEXT NOT NULL, url TEXT NOT NULL, host TEXT,
  category TEXT, region TEXT, intro TEXT, submit_mode TEXT, traffic TEXT, verify_status TEXT,
  enabled INTEGER DEFAULT 1, interval_min INTEGER DEFAULT 1440, rule_json TEXT,
  last_crawl_at TEXT, last_status TEXT, last_error TEXT, product_count INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS products (
  guid TEXT PRIMARY KEY, dedup_key TEXT UNIQUE, name TEXT NOT NULL, url TEXT, domain TEXT,
  tagline TEXT, description TEXT, category TEXT, tags TEXT DEFAULT '[]', logo_url TEXT, logo_local TEXT,
  pricing TEXT, platforms TEXT DEFAULT '[]', maker TEXT, country TEXT, launch_date TEXT,
  first_seen TEXT, last_seen TEXT, votes INTEGER DEFAULT 0, launch_count INTEGER DEFAULT 0,
  ai_summary TEXT, ai_analysis TEXT, embedding TEXT, origin TEXT DEFAULT 'crawl', notes TEXT,
  content_hash TEXT, created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_products_domain ON products(domain);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_votes ON products(votes DESC);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_products_launch ON products(launch_date DESC, first_seen DESC);
CREATE INDEX IF NOT EXISTS idx_products_first_seen ON products(first_seen DESC);
CREATE INDEX IF NOT EXISTS idx_products_launches ON products(launch_count DESC, votes DESC);
CREATE INDEX IF NOT EXISTS idx_products_cat_updated ON products(category, updated_at DESC);
CREATE TABLE IF NOT EXISTS product_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_guid TEXT NOT NULL, source_guid TEXT, version_label TEXT,
  launched_at TEXT, url TEXT, votes INTEGER, snapshot TEXT, content_hash TEXT, created_at TEXT,
  UNIQUE(product_guid, source_guid, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_versions_product ON product_versions(product_guid);
CREATE INDEX IF NOT EXISTS idx_versions_source ON product_versions(source_guid);
CREATE TABLE IF NOT EXISTS crawl_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source_guid TEXT, started_at TEXT, finished_at TEXT, status TEXT,
  found INTEGER DEFAULT 0, inserted INTEGER DEFAULT 0, updated INTEGER DEFAULT 0, error TEXT
);
CREATE TABLE IF NOT EXISTS saved_filters (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, filter_json TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS favorites (product_guid TEXT PRIMARY KEY, created_at TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`;

/** v1.8：磁盘全文索引（FTS5，按需分页），由触发器写入待同步队列，搜索前增量同步 */
export const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(name, py, domain, tagline, tags, enrich, descr, content='', contentless_delete=1, tokenize="unicode61 remove_diacritics 0 tokenchars '+#'");
CREATE TABLE IF NOT EXISTS fts_queue (rid INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS alt_rel (target TEXT NOT NULL, product_guid TEXT NOT NULL, src TEXT, PRIMARY KEY(target, product_guid)) WITHOUT ROWID;
CREATE TRIGGER IF NOT EXISTS trg_products_ai AFTER INSERT ON products BEGIN INSERT OR IGNORE INTO fts_queue(rid) VALUES (new.rowid); END;
CREATE TRIGGER IF NOT EXISTS trg_products_au AFTER UPDATE OF name, tagline, description, tags, category, domain, enrich_json ON products BEGIN INSERT OR IGNORE INTO fts_queue(rid) VALUES (new.rowid); END;
CREATE TRIGGER IF NOT EXISTS trg_products_ad AFTER DELETE ON products BEGIN DELETE FROM products_fts WHERE rowid=old.rowid; DELETE FROM fts_queue WHERE rid=old.rowid; END;
`;
/** v1.9 墓碑表：产品/替代关系删除后记录，供下一个增量包下发 */
export const TOMBSTONE_SCHEMA = `
CREATE TABLE IF NOT EXISTS deleted_products (guid TEXT PRIMARY KEY, dedup_key TEXT, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS idx_deleted_products_at ON deleted_products(deleted_at);
CREATE TABLE IF NOT EXISTS deleted_alt_rel (target TEXT NOT NULL, product_guid TEXT NOT NULL, deleted_at TEXT, PRIMARY KEY(target, product_guid)) WITHOUT ROWID;
CREATE TRIGGER IF NOT EXISTS trg_products_tomb AFTER DELETE ON products BEGIN INSERT OR REPLACE INTO deleted_products(guid, dedup_key, deleted_at) VALUES (old.guid, old.dedup_key, strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER IF NOT EXISTS trg_products_untomb AFTER INSERT ON products BEGIN DELETE FROM deleted_products WHERE guid=new.guid; END;
CREATE TRIGGER IF NOT EXISTS trg_alt_rel_tomb AFTER DELETE ON alt_rel BEGIN INSERT OR REPLACE INTO deleted_alt_rel(target, product_guid, deleted_at) VALUES (old.target, old.product_guid, strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER IF NOT EXISTS trg_alt_rel_untomb AFTER INSERT ON alt_rel BEGIN DELETE FROM deleted_alt_rel WHERE target=new.target AND product_guid=new.product_guid; END;
`;
/** v1.9 去重：名称键索引、合并别名（被合并的旧 guid → 保留的 guid）、alt_rel 反查索引 */
export const DEDUP_SCHEMA = `
CREATE INDEX IF NOT EXISTS idx_products_name_key ON products(name_key);
CREATE TABLE IF NOT EXISTS product_alias (alias TEXT PRIMARY KEY, guid TEXT NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_product_alias_guid ON product_alias(guid);
CREATE INDEX IF NOT EXISTS idx_alt_rel_product ON alt_rel(product_guid);
`;
export class DB {
  db: Database.Database; file: string | null;
  rev = 0; // 写操作计数：用于让缓存失效
  private stmts = new Map<string, Database.Statement>();
  private closed = false;
  constructor(db: Database.Database, file: string | null) {
    this.db = db; this.file = file;
    if (file) { db.pragma('journal_mode = WAL'); db.pragma('synchronous = NORMAL'); db.pragma('busy_timeout = 5000'); }
    db.pragma('cache_size = -65536'); db.pragma('temp_store = MEMORY'); try { db.pragma('mmap_size = 268435456'); } catch { /* */ }
    db.exec(SCHEMA); this.migrate(); db.exec(FTS_SCHEMA); db.exec(TOMBSTONE_SCHEMA); db.exec(DEDUP_SCHEMA);
    try { const dc = new Set(this.all<any>('PRAGMA table_info(deleted_products)').map(c => c.name)); if (!dc.has('merged_into')) db.exec('ALTER TABLE deleted_products ADD COLUMN merged_into TEXT'); } catch { /* */ }
  }
  /** 连接仍可用时才读写；已关闭时 get/all 给缺省，run/set 忽略，不抛 “connection is not open” */
  isOpen() { return !this.closed && !!this.db?.open; }
  /** v1.4：官网信息补齐字段 */
  private migrate() { const cols = new Set(this.all<any>('PRAGMA table_info(products)').map(c => c.name));
    for (const [c, t] of [['enrich_json', 'TEXT'], ['enriched_at', 'TEXT'], ['enrich_status', 'TEXT'], ['name_key', 'TEXT']]) if (!cols.has(c)) this.db.exec(`ALTER TABLE products ADD COLUMN ${c} ${t}`); }
  static async open(file: string | null, seedFile?: string): Promise<DB> {
    if (file && !fs.existsSync(file) && seedFile && fs.existsSync(seedFile)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.copyFileSync(seedFile, file); }
    if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
    const d = new DB(new Database(file || (seedFile && fs.existsSync(seedFile) ? seedFile : ':memory:')), file);
    return d;
  }
  private prep(sql: string) { let st = this.stmts.get(sql); if (!st) { st = this.db.prepare(sql); if (this.stmts.size > 500) this.stmts.clear(); this.stmts.set(sql, st); } return st; }
  all<T = any>(sql: string, params: any[] = []): T[] { if (!this.isOpen()) return []; const st = this.prep(sql); return (st.reader ? st.all(...params.map(norm)) : (st.run(...params.map(norm)), [])) as T[]; }
  get<T = any>(sql: string, params: any[] = []): T | undefined { if (!this.isOpen()) return undefined; const st = this.prep(sql); return (st.reader ? st.get(...params.map(norm)) : (st.run(...params.map(norm)), undefined)) as T | undefined; }
  run(sql: string, params: any[] = []) { if (!this.isOpen()) return { changes: 0 }; this.rev++; if (!params.length && /;\s*\S/.test(sql.trim().replace(/;\s*$/, ''))) { this.db.exec(sql); return { changes: 0 }; } const r = this.prep(sql).run(...params.map(norm)); return { changes: r.changes }; }
  tx<T>(fn: () => T): T { this.rev++; if (this.db.inTransaction) return fn(); return this.db.transaction(fn)(); }
  /** better-sqlite3 写入即落盘；保留接口以兼容旧调用（WAL 检查点） */
  scheduleSave() { /* no-op */ }
  saveNow() { if (!this.isOpen() || !this.file) return; try { this.db.pragma('wal_checkpoint(PASSIVE)'); } catch { /* */ } }
  getSetting(k: string, def = ''): string { return this.get<any>('SELECT value FROM settings WHERE key=?', [k])?.value ?? def; }
  setSetting(k: string, v: string) { this.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, v]); }
  close() {
    if (this.closed) return;
    try { this.saveNow(); } catch { /* */ }
    this.stmts.clear();
    this.closed = true;
    try { if (this.db.open) this.db.close(); } catch { /* */ }
  }
}
function norm(v: any) { return v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v; }
export const now = () => new Date().toISOString();
