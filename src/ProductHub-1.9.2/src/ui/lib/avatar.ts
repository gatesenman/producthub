/** 无 Logo 时的首字母头像：中文取首字，英文取两词首字母 / 驼峰首字母 / 前两字母；色相由名称稳定哈希到 8 色调色板 */
export const AVATAR_HUES = [234, 262, 199, 172, 145, 32, 350, 14];
export function initials(name: string): string {
  const n = String(name || '').replace(/^(the|a)\s+/i, '').trim(); if (!n) return '?';
  const cjk = n.match(/[\u3400-\u9fff\uac00-\ud7af\u3040-\u30ff]/); if (cjk && n.indexOf(cjk[0]) === 0) return cjk[0];
  const words = n.split(/[\s\-_.·:]+/).filter(w => /[a-z0-9]/i.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] || n; const caps = w.match(/[A-Z]/g);
  if (caps && caps.length >= 2 && /^[A-Z]/.test(w)) return caps[0] + caps[1];
  return (w[0].toUpperCase() + (w[1] || '').toLowerCase()).replace(/[^\w\u3400-\u9fff]/g, '');
}
export function hash(s: string) { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619); } return h >>> 0; }
export function avatarHue(name: string) { return AVATAR_HUES[hash(String(name || '?').toLowerCase()) % AVATAR_HUES.length]; }
/** 渐变两端亮度 ≤32%，保证白字对比度 ≥ 4.5（见 tests/unit/avatar.test.ts） */
export function avatarGradient(name: string) { const h = avatarHue(name); return `linear-gradient(135deg, hsl(${h} 62% 32%), hsl(${(h + 28) % 360} 58% 26%))`; }
