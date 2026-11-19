import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DB } from '../../src/server/db';
import { Scheduler } from '../../src/server/scheduler';
import { startServer } from '../../src/server/server';

afterEach(() => { vi.useRealTimers(); });

describe('退出关库：调度器与 close', () => {
  it('启动调度器后关库再推进定时器：不报未捕获异常，enabled 为 false', async () => {
    const db = await DB.open(null);
    const sch = new Scheduler(db, '/tmp');
    const errors: unknown[] = [];
    const onEx = (e: unknown) => { errors.push(e); };
    const onRej = (e: unknown) => { errors.push(e); };
    process.on('uncaughtException', onEx);
    process.on('unhandledRejection', onRej);
    vi.useFakeTimers();
    try {
      sch.start(1_000, 1_000);
      db.close();
      expect(sch.enabled).toBe(false);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(errors).toEqual([]);
      expect(sch.enabled).toBe(false);
      expect(sch.status().enabled).toBe(false);
    } finally {
      sch.stop();
      process.off('uncaughtException', onEx);
      process.off('unhandledRejection', onRej);
      db.close();
    }
  });

  it('startServer.close() 先停定时器再关库', async () => {
    const db = await DB.open(null);
    const srv = await startServer({ db, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ph-sd-')), noWarm: true, scheduler: true });
    const sch = srv.scheduler;
    let timerAtClose: NodeJS.Timeout | null | undefined = 'unset' as any;
    const orig = db.close.bind(db);
    db.close = () => { timerAtClose = (sch as any).timer; orig(); };
    try {
      expect((sch as any).timer).not.toBeNull();
      await srv.close();
      expect(timerAtClose).toBeNull();
      expect((sch as any).timer).toBeNull();
      expect((sch as any).bootTimer).toBeNull();
      expect(db.db.open).toBe(false);
    } finally {
      db.close = orig;
      await srv.close();
    }
  });

  it('重复 close 安全；关闭后再读写不抛、不写回磁盘', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-sd-'));
    const file = path.join(dir, 'x.db');
    const db = await DB.open(file);
    db.setSetting('keep', 'yes');
    db.close();
    expect(() => db.close()).not.toThrow();
    db.close();
    expect(db.get<any>('SELECT value FROM settings WHERE key=?', ['keep'])).toBeUndefined();
    expect(db.all('SELECT 1 AS n')).toEqual([]);
    expect(db.run('INSERT INTO settings(key,value) VALUES(?,?)', ['late', 'no'])).toEqual({ changes: 0 });
    expect(() => db.setSetting('late', 'no')).not.toThrow();
    expect(db.getSetting('keep', 'def')).toBe('def');
    expect(db.saveNow()).toBeUndefined();
    const db2 = await DB.open(file);
    try {
      expect(db2.getSetting('keep')).toBe('yes');
      expect(db2.getSetting('late')).toBe('');
    } finally { db2.close(); }
  });

  it('startServer.close 可重复调用', async () => {
    const db = await DB.open(null);
    const srv = await startServer({ db, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ph-sd-')), noWarm: true, scheduler: false });
    await srv.close();
    await expect(srv.close()).resolves.toBeUndefined();
    expect(db.db.open).toBe(false);
  });
});
