import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ResEdit = require('resedit');

/** @param {import('electron-builder').AfterPackContext} ctx */
export default async function afterPack(ctx) {
  // v1.9：把 Electron ABI 的 better-sqlite3 预编译件放进解包目录（仓库 node_modules 保持 Node ABI 供测试/抓取用）
  const plat = `${ctx.electronPlatformName}-x64`; const nat = path.resolve('build/native', plat, 'better_sqlite3.node');
  const dstNat = path.join(ctx.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  if (fs.existsSync(nat) && fs.existsSync(path.dirname(dstNat))) { fs.copyFileSync(nat, dstNat); console.log('[after-pack] native better-sqlite3 for', plat, '→', dstNat); }
  else console.warn('[after-pack] native prebuild missing for', plat, nat);
  if (ctx.electronPlatformName !== 'win32') return;
  const ver = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version; const [v1, v2, v3] = ver.split('.').map(Number);
  const exeName = `${ctx.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(ctx.appOutDir, exeName);
  const icoPath = path.resolve('build/icon.ico');
  if (!fs.existsSync(exePath) || !fs.existsSync(icoPath)) {
    console.warn('[after-pack-icon] skip; missing', exePath, icoPath);
    return;
  }
  const data = fs.readFileSync(exePath);
  const exe = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const target = groups[0] || { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    target.id,
    target.lang,
    iconFile.icons.map((item) => item.data),
  );
  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (viList[0]) {
    const vi = viList[0];
    vi.setFileVersion(v1, v2, v3, 0, 1033);
    vi.setProductVersion(v1, v2, v3, 0, 1033);
    vi.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        FileDescription: '统一产品库',
        ProductName: '统一产品库',
        ProductVersion: ver,
        FileVersion: ver,
        CompanyName: 'GAOSICHUN',
        LegalCopyright: 'Copyright GAOSICHUN',
        InternalName: 'ProductHub',
        OriginalFilename: exeName,
      },
    );
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('[after-pack-icon] embedded icon into', exePath);
}
