/** WCAG 2.x 相对亮度与对比度（输入 HSL 三元组） */
export function hslToRgb([h, s, l]: number[]) { s /= 100; l /= 100; const k = (n: number) => (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); return [0, 8, 4].map(n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))); }
export function luminance(c: number[]) { const [r, g, b] = hslToRgb(c).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export function ratio(a: number[], b: number[]) { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
