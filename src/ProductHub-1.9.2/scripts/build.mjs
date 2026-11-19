import { build } from 'esbuild';
import { copyFileSync } from 'node:fs';
const common = { bundle: true, platform: 'node', target: 'node20', format: 'cjs', external: ['electron', 'sql.js', 'better-sqlite3'], sourcemap: false, logLevel: 'warning' };
await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.js' });
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.js' });
await build({ ...common, entryPoints: ['src/server/main.ts'], outfile: 'dist-server/server.js' });
// v1.9 增量合并后台线程（与主 bundle 同目录，asar 外解包）
await build({ ...common, entryPoints: ['src/server/delta-worker.ts'], outfile: 'dist-electron/delta-worker.js' });
await build({ ...common, entryPoints: ['src/server/delta-worker.ts'], outfile: 'dist-server/delta-worker.js' });
copyFileSync('build/icon.png', 'dist-electron/icon.png');
copyFileSync('build/icon.ico', 'dist-electron/icon.ico');
console.log('built electron + server bundles; copied app icons into dist-electron');
