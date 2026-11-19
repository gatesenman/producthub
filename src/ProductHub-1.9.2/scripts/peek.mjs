import { chromium } from '@playwright/test';
const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('console', m => m.type() === 'error' && console.log('CONSOLE', m.text()));
await p.goto(process.argv[2] || 'http://127.0.0.1:18800/'); await p.waitForTimeout(2500); await p.screenshot({ path: process.argv[3] || '/tmp/peek.png' }); await b.close();
