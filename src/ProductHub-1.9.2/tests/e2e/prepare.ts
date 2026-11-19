/** 为 E2E 准备确定性的测试数据目录 */
import fs from 'node:fs';
import { DB } from '../../src/server/db';
import { upsertProduct } from '../../src/server/products';
import { importSourcesCsv } from '../../src/server/sources';
(async () => {
  const dir = process.argv[2] || '/tmp/ph-e2e'; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const db = await DB.open(dir + '/producthub.db'); importSourcesCsv(db, fs.readFileSync('data/sources.csv', 'utf8'));
  const src = db.get<any>("SELECT guid FROM sources WHERE name='BetaList'").guid; const src2 = db.get<any>("SELECT guid FROM sources WHERE name='DevHunt'").guid;
  const P: [string, string, string][] = [['WriteBot', 'writebot.ai', 'AI writing assistant for blog posts and copywriting'], ['CopyGenie', 'copygenie.io', 'AI copywriting tool for marketing teams'], ['FitTrack', 'fittrack.app', 'Workout and fitness tracker for iOS and Android'],
    ['CodeShip', 'codeship.dev', 'Open-source CLI to deploy code for developers'], ['NoteNest', 'notenest.app', 'Note-taking productivity app with AI search'], ['PayFlow', 'payflow.com', 'Invoice and payment platform for freelancers'], ['PixelForge', 'pixelforge.ai', 'AI image generator text-to-image art'], ['ShopLens', 'shoplens.co', 'Shopify ecommerce analytics dashboard'], ['LearnLoop', 'learnloop.edu', 'Language learning app for students'], ['VaultKey', 'vaultkey.io', 'Password manager with encryption and privacy']];
  P.forEach(([n, d, t], i) => upsertProduct(db, { name: n, url: 'https://' + d, tagline: t, description: t + '. ' + 'Built for modern teams.', votes: (i + 1) * 10, launch_date: `2026-0${(i % 9) + 1}-15` }, { sourceGuid: i % 2 ? src : src2 }));
  upsertProduct(db, { name: 'WriteBot', url: 'https://writebot.ai', tagline: 'AI writing assistant v2 relaunch' }, { sourceGuid: src2 });
  db.close(); console.log('e2e data ready', dir);
})();
