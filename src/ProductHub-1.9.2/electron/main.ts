import { app, BrowserWindow, Menu, shell, dialog, ipcMain, nativeTheme } from 'electron';
import path from 'node:path';
import { boot } from '../src/server/main';
import { installBrowserHost } from './browser-host';

const root = path.join(__dirname, '..');
let srv: Awaited<ReturnType<typeof boot>> | null = null;

const SPLASH = (dark: boolean) => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font:13px -apple-system,'PingFang SC','Microsoft YaHei UI',sans-serif;background:${dark ? '#111113' : '#ffffff'};color:${dark ? '#a1a1aa' : '#71717a'};-webkit-app-region:drag"><div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,#4f5bea,#8b5cf6);color:#fff;font:700 22px sans-serif;display:flex;align-items:center;justify-content:center">P</div><div style="font-size:15px;font-weight:600;color:${dark ? '#f4f4f5' : '#18181b'}">统一产品库</div><div>正在准备数据…首次启动约需几秒</div></body></html>`);

/** 一键启动：先立即显示窗口和启动画面，再在后台初始化数据库与本地服务 */
async function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  const iconPath = path.join(__dirname, 'icon.png');
  const win = new BrowserWindow({ width: 1440, height: 900, minWidth: 1100, minHeight: 680, title: '统一产品库', icon: iconPath, backgroundColor: dark ? '#111113' : '#ffffff', autoHideMenuBar: true, frame: process.platform === 'darwin', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined, trafficLightPosition: { x: 12, y: 13 },
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: true, spellcheck: false, preload: path.join(__dirname, 'preload.js') } });
  win.loadURL(SPLASH(dark));
  installBrowserHost();
  try {
    srv = await boot({ dataDir: process.env.PH_DATA || path.join(app.getPath('userData'), 'data'), uiDir: path.join(root, 'dist-ui'), port: +(process.env.PH_PORT || 0), host: '127.0.0.1', seedDb: path.join(app.isPackaged ? path.join(process.resourcesPath, 'seed') : path.join(root, 'data', 'seed'), 'producthub.db'), seedCsv: path.join(root, 'data', 'sources.csv'), scheduler: !process.env.PH_NO_SCHEDULER });
  } catch (e) {
    dialog.showErrorBox('统一产品库启动失败', `无法初始化数据目录：${(e as Error).message}\n\n请检查磁盘空间或权限后重试；数据目录：${app.getPath('userData')}`); app.quit(); return;
  }
  ipcMain.removeAllListeners('win');
  ipcMain.on('win', (_e, a) => { if (a === 'minimize') win.minimize(); else if (a === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize(); else if (a === 'close') win.close(); });
  win.on('maximize', () => win.webContents.send('maximized', true)); win.on('unmaximize', () => win.webContents.send('maximized', false));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(srv!.url)) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.session.on('will-download', (_e, item) => { item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) }); });
  await win.loadURL(srv.url + (process.env.PH_QUERY ? '/?' + process.env.PH_QUERY : process.env.PH_VIEW ? '/?view=' + process.env.PH_VIEW : ''));
  if (process.env.PH_SCREENSHOT) { setTimeout(async () => { const img = await win.webContents.capturePage(); require('node:fs').writeFileSync(process.env.PH_SCREENSHOT!, img.toPNG()); app.quit(); }, +(process.env.PH_SHOT_DELAY || 4000)); }
}
Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: '文件', submenu: [{ label: '打开数据目录', click: () => shell.openPath(app.getPath('userData')) }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
  { label: '视图', submenu: [{ role: 'reload', label: '重新加载' }, { role: 'toggleDevTools', label: '开发者工具' }, { role: 'togglefullscreen', label: '全屏' }] },
  { label: '帮助', submenu: [{ label: '关于', click: () => dialog.showMessageBox({ message: '统一产品库 v' + app.getVersion(), detail: '跨端产品情报桌面应用 · Electron + React + SQLite' }) }] },
]));
app.whenReady().then(createWindow);
let quitting = false, quitReady = false;
const isClosedDbErr = (e: unknown) => /database connection is not open/i.test(String((e as any)?.message || e));
/** 退出时先停调度器与全部定时器，等进行中的 tick 结束或超时，再关库，最后 app.quit() */
async function quitAll() {
  if (quitting) return;
  quitting = true;
  try { if (srv) await srv.close(); } catch { /* */ }
  srv = null;
  quitReady = true;
  app.quit();
}
process.on('uncaughtException', (err) => { if (quitting || isClosedDbErr(err)) return; try { dialog.showErrorBox('统一产品库出错', err.stack || String(err)); } catch { /* */ } });
process.on('unhandledRejection', (err) => { if (quitting || isClosedDbErr(err)) return; });
app.on('window-all-closed', () => { void quitAll(); });
// 主窗口关闭即退出（内置浏览器 / 抓取窗口不阻止退出）
app.on('browser-window-created', (_e, w) => { if (BrowserWindow.getAllWindows().length === 1) w.on('closed', () => { void quitAll(); }); });
app.on('before-quit', (e) => { if (quitReady) return; e.preventDefault(); void quitAll(); });
app.on('will-quit', (e) => { if (quitReady) return; e.preventDefault(); void quitAll(); });
