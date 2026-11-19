/** WCAG AA 对比度：亮/暗两套主题的关键前景/背景对（正文 ≥4.5，大字/图标/状态色 ≥3） */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { ratio } from '../../src/ui/lib/contrast';
const css = fs.readFileSync('src/ui/styles.css', 'utf8');
function vars(block: string) { const m: Record<string, number[]> = {}; for (const [, k, h, s, l] of block.matchAll(/--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)) m[k] = [+h, +s, +l]; return m; }
const light = vars(css.slice(css.indexOf(':root'), css.indexOf('.dark')));
const dark = { ...light, ...vars(css.slice(css.indexOf('.dark {'), css.indexOf('* {'))) };
const PAIRS: [string, string, number][] = [
  ['foreground', 'background', 4.5], ['muted-foreground', 'background', 4.5], ['muted-foreground', 'muted', 4.5], ['muted-foreground', 'card', 4.5],
  ['primary-foreground', 'primary', 4.5], ['brand-foreground', 'brand', 4.5], ['brand', 'background', 4.5], ['brand', 'brand-soft', 4.5],
  ['destructive', 'background', 4.5], ['destructive-foreground', 'destructive', 4.5], ['success', 'background', 3], ['warning', 'background', 3],
  ['sidebar-foreground', 'sidebar', 4.5], ['sidebar-accent-foreground', 'sidebar-accent', 4.5], ['popover-foreground', 'popover', 4.5], ['ring', 'background', 3], ['ring', 'card', 3],
];
for (const [name, t] of [['亮色', light], ['暗色', dark]] as const) describe('对比度 ' + name, () => {
  for (const [fg, bg, min] of PAIRS) it(`${fg} / ${bg} ≥ ${min}`, () => { expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(min); });
});
