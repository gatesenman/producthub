import { describe, it, expect } from 'vitest';
import fs from 'node:fs'; import path from 'node:path';
import { COLOR_TOKENS, ALLOWED_DURATIONS } from '../../src/ui/lib/tokens';

const root = path.resolve(__dirname, '../../src/ui');
const files = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []);
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const block = (sel: string) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));

describe('设计系统一致性（docs/设计系统.md）', () => {
  it('每个颜色令牌在浅色和深色主题都有定义', () => { for (const t of COLOR_TOKENS) { expect(block(':root'), t).toContain(`--${t}:`); expect(block('.dark'), t).toContain(`--${t}:`); } });
  it('组件代码不写死颜色、字号、圆角，动效时长只用 150/200ms', () => {
    const bad: string[] = [];
    for (const f of files(root)) { const s = fs.readFileSync(f, 'utf8'); const rel = path.relative(root, f);
      for (const m of s.matchAll(/text-\[\d+(\.\d+)?px\]|rounded-\[\d+px\]|(?<![\w-])(?:bg|text|border)-\[#[0-9a-f]{3,6}\]/gi)) bad.push(`${rel}: ${m[0]}`);
      for (const m of s.matchAll(/duration-(\d+)/g)) if (!ALLOWED_DURATIONS.includes(+m[1])) bad.push(`${rel}: ${m[0]}`);
      for (const m of s.matchAll(/["'`]#[0-9a-fA-F]{6}["'`]/g)) bad.push(`${rel}: ${m[0]}`); }
    expect(bad).toEqual([]);
  });
  it('界面用语统一：不出现「渠道」「看板」等旧称', () => {
    const bad = files(root).flatMap(f => { const s = fs.readFileSync(f, 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''); return ['渠道', '分析看板', '来源监控', '工作台'].filter(w => s.includes(w) && !(w === '工作台' && f.endsWith('AppSidebar.tsx'))).map(w => path.basename(f) + ':' + w); });
    expect(bad).toEqual([]);
  });
});
