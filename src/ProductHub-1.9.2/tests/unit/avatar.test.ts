import { describe, it, expect } from 'vitest';
import { initials, avatarHue, AVATAR_HUES } from '../../src/ui/lib/avatar';
import { ratio } from '../../src/ui/lib/contrast';
describe('首字母头像', () => {
  it('取首字母规则', () => {
    expect(initials('PayFlow')).toBe('PF'); expect(initials('Notion AI')).toBe('NA'); expect(initials('notion')).toBe('No');
    expect(initials('飞书文档')).toBe('飞'); expect(initials('The Browser Company')).toBe('BC'); expect(initials('')).toBe('?'); expect(initials('x.ai')).toBe('XA');
  });
  it('色相稳定且来自调色板', () => { expect(avatarHue('PayFlow')).toBe(avatarHue('payflow')); expect(AVATAR_HUES).toContain(avatarHue('任意')); });
  it('白字对比度 ≥ 4.5（渐变两端）', () => { for (const h of AVATAR_HUES) { expect(ratio([0, 0, 100], [h, 62, 32])).toBeGreaterThanOrEqual(4.5); expect(ratio([0, 0, 100], [(h + 28) % 360, 58, 26])).toBeGreaterThanOrEqual(4.5); } });
});
