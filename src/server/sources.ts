import Papa from 'papaparse';
import type { DB } from './db';
import { now } from './db';
import { sourceGuid, normalizeUrl, hostOf } from './util';
import { ensureSourceSettings, effectiveSettings } from './source-settings';
import { kindOfError } from './crawl-pipeline';
import { failLabel } from './net';
import { builtinNote } from './browser-rules';

/** 导入监控来源 CSV（序号,名称,网址,类别,地区/语言,简介,提交方式,流量/知名度,核验状态） */
export function importSourcesCsv(db: DB, csv: string) {
  const { data } = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true });
  const col = (r: Record<string, string>, ...keys: string[]) => { for (const k of Object.keys(r)) if (keys.some(x => k.startsWith(x))) return (r[k] || '').trim(); return ''; };
  let inserted = 0, updated = 0;
  db.tx(() => { for (const r of data) {
    const url = col(r, '网址', 'url', 'URL'); const name = col(r, '名称', 'name'); if (!url || !name) continue;
    const res = upsertSource(db, { seq: parseInt(col(r, '序号', 'seq')) || null, name, url, category: col(r, '类别', 'category'), region: col(r, '地区', 'region'), intro: col(r, '简介', 'intro'), submit_mode: col(r, '提交方式', 'submit'), traffic: col(r, '流量', 'traffic'), verify_status: col(r, '核验', 'verify') });
    res === 'inserted' ? inserted++ : updated++;
  } });
  return { inserted, updated, total: data.length };
}
export function upsertSource(db: DB, s: any): 'inserted' | 'updated' {
  const url = normalizeUrl(s.url); if (!url) throw new Error('网址无效'); const guid = sourceGuid(url); const ts = now();
  const ex = db.get('SELECT guid FROM sources WHERE guid=?', [guid]);
  if (ex) { db.run('UPDATE sources SET seq=COALESCE(?,seq), name=?, category=COALESCE(?,category), region=COALESCE(?,region), intro=COALESCE(?,intro), submit_mode=COALESCE(?,submit_mode), traffic=COALESCE(?,traffic), verify_status=COALESCE(?,verify_status), updated_at=? WHERE guid=?', [s.seq, s.name, s.category || null, s.region || null, s.intro || null, s.submit_mode || null, s.traffic || null, s.verify_status || null, ts, guid]); return 'updated'; }
  db.run('INSERT INTO sources(guid,seq,name,url,host,category,region,intro,submit_mode,traffic,verify_status,enabled,interval_min,rule_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [guid, s.seq, s.name, url, hostOf(url), s.category, s.region, s.intro, s.submit_mode, s.traffic, s.verify_status, s.enabled ?? 1, s.interval_min || 1440, s.rule_json ? (typeof s.rule_json === 'string' ? s.rule_json : JSON.stringify(s.rule_json)) : null, ts, ts]);
  return 'inserted';
}
export function listSources(db: DB) {
  ensureSourceSettings(db);
  return db.all<any>('SELECT s.*, ss.ok_count, ss.fail_count, ss.consecutive_fail, ss.last_kind, ss.last_method, ss.last_ms, ss.last_items, (ss.settings_json IS NOT NULL) has_custom FROM sources s LEFT JOIN source_settings ss ON ss.guid=s.guid ORDER BY COALESCE(s.seq, 99999), s.name').map(r => {
    const eff = effectiveSettings(db, r); const kind = r.last_status === 'ok' ? null : (r.last_kind && r.last_status !== 'ok' ? r.last_kind : kindOfError(r.last_status, r.last_error));
    return { ...r, method: eff.method, proxy: eff.proxy, session: eff.session, fail_kind: kind, fail_label: kind ? failLabel(kind) : null, note: builtinNote(r.url), ok_count: r.ok_count || 0, fail_count: r.fail_count || 0 };
  });
}
export function updateSource(db: DB, guid: string, p: any) {
  const allowed = ['name', 'category', 'region', 'intro', 'enabled', 'interval_min', 'rule_json'];
  const sets: string[] = [], vals: any[] = [];
  for (const k of allowed) if (k in p) { sets.push(k + '=?'); vals.push(k === 'rule_json' && p[k] && typeof p[k] !== 'string' ? JSON.stringify(p[k]) : p[k]); }
  if (sets.length) db.run(`UPDATE sources SET ${sets.join(',')}, updated_at=? WHERE guid=?`, [...vals, now(), guid]);
  return db.get('SELECT * FROM sources WHERE guid=?', [guid]);
}
export function deleteSource(db: DB, guid: string) { db.run('DELETE FROM sources WHERE guid=?', [guid]); }
