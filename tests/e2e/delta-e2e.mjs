/**
 * 增量更新 Electron 实机端到端（xvfb）：设置页 → 检查更新 → 下载（含断网续传）→ 后台合并 → 搜索出新产品 → 重启仍在
 * 另测：坏包/校验和不对被拒且库不变、重复更新幂等、自动检查开关、本地文件导入、合并期间界面响应
 *   xvfb-run -a -s "-screen 0 1440x900x24" node tests/e2e/delta-e2e.mjs --app /tmp/ph-release-e2e/linux-unpacked/product-hub --work /tmp/ph-delta-e2e
 */
import { _electron as electron } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const APP = arg('--app', '/tmp/ph-release-e2e/linux-unpacked/product-hub'); const WORK = arg('--work', '/tmp/ph-delta-e2e');
const SHOTS = path.resolve(arg('--shots', 'screenshots/delta-e2e')); fs.mkdirSync(SHOTS, { recursive: true });
const PUB = path.join(WORK, 'pub'); const DATA = path.join(WORK, 'client-data'); const meta = JSON.parse(fs.readFileSync(path.join(WORK, 'meta.json'), 'utf8'));
const results = []; const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(ok ? '✅' : '❌', name, detail); };

// —— 模拟 CDN：支持 Range；dropOnce 时首个包请求在 35% 处断开 ——
const reqLog = []; let dropOnce = new Set();
const srv = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.split('?')[0].slice(1)); const f = path.join(PUB, name); reqLog.push(`${name} ${req.headers.range || 'full'}`);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  const buf = fs.readFileSync(f); let start = 0; const m = /bytes=(\d+)-/.exec(req.headers.range || ''); if (m) start = +m[1];
  const body = buf.subarray(start); res.writeHead(m ? 206 : 200, { 'content-length': body.length, 'accept-ranges': 'bytes', ...(m ? { 'content-range': `bytes ${start}-${buf.length - 1}/${buf.length}` } : {}) });
  if (dropOnce.has(name)) { dropOnce.delete(name); const cut = Math.floor(body.length * 0.35); res.write(body.subarray(0, cut)); log(`⚡ 模拟断网：${name} 发送 ${cut}/${body.length} 字节后断开`); setTimeout(() => res.destroy(), 50); return; }
  // 限速让进度条可见：每 64KB 间隔 2ms
  let i = 0; const step = () => { if (i >= body.length) return res.end(); const c = body.subarray(i, i + 65536); i += c.length; res.write(c) ? setTimeout(step, 2) : res.once('drain', () => setTimeout(step, 2)); }; step();
});
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${srv.address().port}`; log('mock CDN', BASE);

let app, win;
async function launch(extraEnv = {}) {
  app = await electron.launch({ executablePath: APP, args: ['--no-sandbox', '--disable-gpu'], env: { ...process.env, PH_DATA: DATA, PH_NO_SCHEDULER: '1', PH_QUERY: 'view=settings&noonboard', ...extraEnv }, timeout: 120000 });
  const cp = app.process(); const alog = path.join(WORK, 'app.log');
  cp.stdout?.on('data', d => fs.appendFileSync(alog, d)); cp.stderr?.on('data', d => fs.appendFileSync(alog, d));
  cp.on('exit', (code, sig) => { log('⚠ 应用进程退出', code, sig); fs.appendFileSync(alog, `\n[exit ${code} ${sig}]\n`); });
  win = await app.firstWindow(); for (let i = 0; i < 120 && !win.url().startsWith('http'); i++) await win.waitForTimeout(500);
  await win.setViewportSize?.({ width: 1440, height: 900 }).catch(() => {}); await win.getByTestId('delta-status').waitFor({ timeout: 120000 });
}
const api = (p, body) => Promise.race([new Promise((_, rej) => setTimeout(() => rej(new Error('api 超时 30s: ' + p)), 30000)), apiRaw(p, body)]);
const apiRaw = (p, body) => win.evaluate(async ([p, body]) => { const r = await fetch(p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}); return r.json(); }, [p, body]);
const shot = async (n) => { await win.waitForTimeout(300); await win.screenshot({ path: path.join(SHOTS, n + '.png') }); log('📸', n); };
const setUrl = async (u) => { await win.getByTestId('set-delta-url').fill(u); await win.getByTestId('set-save-delta').click(); await win.waitForTimeout(500); };
const waitJob = async (timeout = 600000) => { await win.locator('[data-testid="delta-job"][data-state="done"], [data-testid="delta-job"][data-state="error"]').waitFor({ timeout }); return api('/api/delta/job'); };
const count = async () => (await api('/api/delta/status')).productCount;
const searchUI = async (q, shotName) => {
  await win.evaluate(() => location.assign('/?view=products&noonboard'));
  await win.getByTestId('search').waitFor({ timeout: 30000 }); await win.getByTestId('search').fill(q); await win.getByTestId('q-submit').click();
  const row = win.getByTestId('product-row').filter({ hasText: q.split(' ')[0] }).first(); const ok = await row.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  if (shotName) await shot(shotName); return ok;
};
const gotoSettings = async () => { await win.evaluate(() => location.assign('/?view=settings&noonboard')); await win.getByTestId('delta-status').waitFor({ timeout: 30000 }); };

try {
  // ————— 第 1 次启动：已安装的 App（数据 #0）—————
  await launch(); const n0 = await count(); const st0 = await api('/api/delta/status');
  check('启动：本地数据版本 #0', st0.seq === 0, `产品 ${n0}`); await shot('01-设置页-初始-#0');

  // 坏包：截断 gzip（索引 sha256 与坏文件一致 → 下载通过，解析拒绝）
  await setUrl(`${BASE}/index-bad.json`); await win.getByTestId('delta-apply-url').click(); let j = await waitJob();
  check('坏包被拒绝', j.state === 'error' && /损坏|解压|JSON/.test(j.error?.message || ''), j.error?.message); check('坏包后库不变', (await count()) === n0 && (await api('/api/delta/status')).seq === 0);
  await shot('02-坏包被拒绝-库不变');
  // 校验和不对
  await setUrl(`${BASE}/index-badsha.json`); await win.getByTestId('delta-apply-url').click(); j = await waitJob();
  check('SHA256 不符被拒绝', j.state === 'error' && /SHA256/.test(j.error?.message || ''), j.error?.message); check('校验失败后库不变', (await count()) === n0);
  await shot('03-校验和不符被拒绝');

  // 正常更新源
  await setUrl(`${BASE}/index.json`); await win.getByTestId('delta-check').click(); await win.getByTestId('delta-check-result').waitFor();
  const chk = await api('/api/delta/check', {}); check('检查更新：发现 2 个包 #0→#2', chk.plan?.length === 2 && chk.latestSeq === 2, chk.message); await shot('04-检查更新-发现2个包');

  // 下载并更新：第一个包下载到 35% 断开 → 自动续传
  dropOnce = new Set([meta.pack1.file]); reqLog.length = 0;
  const tStart = Date.now(); await win.getByTestId('delta-apply-url').click();
  // 合并期间界面/接口响应：每 250ms 请求一次 /api/status 和首页数据
  const lat = []; let applyingShot = false, downloadingShot = false;
  while (true) {
    const t = Date.now(); const jj = await api('/api/delta/job'); lat.push({ ms: Date.now() - t, phase: jj.phase });
    if (jj.phase === 'download' && !downloadingShot && jj.bytes > 0) { downloadingShot = true; await shot('05-下载中-进度'); }
    if (jj.phase === 'apply' && !applyingShot && jj.done > 0) { applyingShot = true; await shot('06-后台合并中-进度'); const t2 = Date.now(); await api('/api/products?pageSize=20'); lat.push({ ms: Date.now() - t2, phase: 'apply-products-list' }); }
    if (jj.state !== 'running') { j = jj; break; }
    await win.waitForTimeout(250);
  }
  const totalMs = Date.now() - tStart;
  const applyLat = lat.filter(x => /apply/.test(x.phase)); const maxApplyLat = Math.max(0, ...applyLat.map(x => x.ms));
  check('下载中断后续传（Range 请求）', reqLog.some(l => l.startsWith(meta.pack1.file) && /bytes=\d+-/.test(l)), reqLog.filter(l => l.startsWith(meta.pack1.file)).join(' | '));
  check('2 个包顺序合并完成 #0→#2', j.state === 'done' && j.results?.length === 2 && j.results[1].seq_after === 2, j.message);
  check('后台线程合并（worker）', j.worker === true || j.results?.every(r => r.worker), `worker=${j.worker}`);
  check('合并期间接口仍响应（<1.5s）', maxApplyLat < 1500, `合并阶段最大响应 ${maxApplyLat}ms，采样 ${applyLat.length} 次`);
  await win.locator('[data-testid="delta-job"][data-state="done"]').waitFor(); await shot('07-更新完成-结果');
  const st2 = await api('/api/delta/status'); const n2 = st2.productCount;
  check('库产品数增加', n2 > n0, `${n0} → ${n2}`);
  // 用户数据保护
  const prod = (g) => win.evaluate(async g => (await fetch('/api/products/' + g)).json(), g);
  const man = await prod('manual-e2e-0001'); check('手动产品核心字段未被覆盖、只补空', man.tagline === '我自己写的简介' && man.notes === '手动备注' && man.pricing === 'Freemium', `${man.tagline} / ${man.pricing}`);
  const note = await prod(meta.note.guid); check('备注未被覆盖', note.notes === '我的备注：重点跟进');
  const favs = await win.evaluate(async () => (await fetch('/api/products?favorites=1&pageSize=50')).json()).catch(() => null);
  const delFav = await prod(meta.delFav.guid); check('被收藏的产品不会被下架墓碑删除', !!delFav?.guid);
  const del = await prod(meta.del.guid); check('下架（墓碑）生效', !del?.guid || del?.error, JSON.stringify(del).slice(0, 80));
  const upd = await prod(meta.upd.guid); check('更新已有产品', String(upd.tagline || '').startsWith('【已更新】'), upd.tagline);
  const filters = await win.evaluate(async () => (await fetch('/api/filters')).json()); check('保存的筛选不变', filters.some(f => f.name === '我的筛选'));
  // 去重：包内同一产品的 URL 变体 / merged_into 墓碑 → 不产生重复，收藏与备注保留
  const dupCount = async (name) => win.evaluate(async n => { const r = await (await fetch('/api/products?pageSize=50&q=' + encodeURIComponent(n))).json(); return (r.items || r.products || r.rows || []).filter(p => p.name === n).length; }, name);
  const dq = await prod('local-dupliquo'); const dqNew = await prod('e2e-dup-dupliquo'); const dqN = await dupCount('Dupliquo');
  check('去重：URL 变体（www/子域/utm）并入本地条目，不新增重复', !!dq?.guid && (!dqNew?.guid || dqNew.guid === dq.guid) && dqN === 1, `本地=${dq?.guid} 包内guid查询=${dqNew?.guid || '无'} 同名条数=${dqN}`);
  check('去重：并入后收藏保留、简介补全', !!dq?.favorite && /Dupliquo/.test(dq?.tagline || ''), `fav=${dq?.favorite} ${dq?.tagline}`);
  const mgN = await dupCount('Mergeon'); const mgA = await prod('local-mergeon'); const mgB = await prod('e2e-mergeon-official'); const mg = mgA?.guid ? mgA : mgB;
  check('去重：merged_into 墓碑合并为一条，收藏/备注迁到保留方', mgN === 1 && !!mg?.favorite && mg?.notes === '去重后备注要保留', `同名条数=${mgN} 保留=${mg?.guid} fav=${mg?.favorite} notes=${mg?.notes}`);
  const totalPack = meta.pack1.products + meta.pack2.products;
  // 搜索可见
  check('搜索出新产品 Zephyrine', await searchUI('Zephyrine', '08-搜索出新产品-Zephyrine'));
  if (meta.sampleNew?.[0]) check(`搜索出真实增量新产品「${meta.sampleNew[0]}」`, await searchUI(meta.sampleNew[0], '09-搜索出真实增量产品'), meta.sampleNew[0]);
  // 重复点更新：幂等
  await gotoSettings(); await win.getByTestId('delta-apply-url').click(); j = await waitJob();
  check('再次更新：已是最新（幂等）', j.state === 'done' && /已是最新/.test(j.message) && (await count()) === n2, j.message); await shot('10-重复更新-已是最新');
  await app.close();

  // ————— 重启：数据仍在 + 自动检查（新发布 #2→#3）—————
  fs.copyFileSync(path.join(PUB, 'index-next.json'), path.join(PUB, 'index.json'));
  await launch({ PH_DELTA_AUTOCHECK_DELAY: '1500' });
  const st3 = await api('/api/delta/status'); check('重启后数据版本仍为 #2、产品数不变', st3.seq === 2 && st3.productCount === n2, `#${st3.seq} ${st3.productCount}`);
  check('重启后仍可搜到 Zephyrine', await searchUI('Zephyrine', '11-重启后仍可搜到'));
  await gotoSettings(); for (let i = 0; i < 20; i++) { const s = await api('/api/delta/status'); if (s.lastCheck?.plan?.length) break; await win.waitForTimeout(500); }
  await gotoSettings(); const st4 = await api('/api/delta/status');
  check('自动检查更新：启动后发现 #2→#3', st4.autoCheck && st4.lastCheck?.plan?.length === 1 && st4.lastCheck?.latestSeq === 3, JSON.stringify(st4.lastCheck).slice(0, 120)); await shot('12-自动检查-发现新包');
  // 关闭自动检查
  await win.getByTestId('delta-auto').uncheck(); await win.waitForTimeout(600); check('自动检查开关可关闭', (await api('/api/delta/status')).autoCheck === false); await shot('13-关闭自动检查');
  await win.getByTestId('delta-auto').check(); await win.waitForTimeout(400);
  // 本地文件导入 #2→#3
  await win.getByTestId('delta-file').setInputFiles(path.join(PUB, meta.pack3.file)); j = await waitJob();
  check('从本地文件合并 #2→#3', j.state === 'done' && j.results?.[0]?.seq_after === 3, j.message); await shot('14-本地文件导入完成');
  // 本地文件跳号：再导入 #0→#1（已应用过 → 幂等）
  await win.getByTestId('delta-file').setInputFiles(path.join(PUB, meta.pack1.file)); j = await waitJob(); check('旧包重复导入：已应用跳过', j.state === 'done' && j.results?.[0]?.status === 'already-applied', j.message);
  check('搜索出本地导入的 Pelicanly', await searchUI('Pelicanly', '15-搜索出本地导入产品'));
  await app.close();
  const summary = { totalMs, maxApplyLat, latSamples: lat.length, n0, n2, final: st3.productCount, pack1: meta.pack1, pack2: meta.pack2, results };
  fs.writeFileSync(path.join(SHOTS, 'e2e-result.json'), JSON.stringify(summary, null, 2));
  log(`完成：${results.filter(r => r.ok).length}/${results.length} 通过；下载+合并总耗时 ${totalMs}ms`);
} catch (e) { console.error('E2E 异常', e); try { await shot('99-异常'); } catch { } results.push({ name: '异常', ok: false, detail: String(e?.message || e) }); fs.writeFileSync(path.join(SHOTS, 'e2e-result.json'), JSON.stringify({ results, error: String(e?.stack || e) }, null, 2)); }
finally { try { await app?.close(); } catch { } srv.close(); process.exit(results.every(r => r.ok) ? 0 : 1); }
