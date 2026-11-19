/** 表单内联校验工具：返回中文错误信息或空串 */
export const isUrl = (v: string) => { try { const u = new URL(v); return /^https?:$/.test(u.protocol) && u.hostname.includes('.'); } catch { return false; } };
export const vUrl = (v: string, required = false) => !v?.trim() ? (required ? '必填' : '') : isUrl(v.trim()) ? '' : '请输入以 http:// 或 https:// 开头的完整网址';
export const vRequired = (v: string, label = '此项') => v?.trim() ? '' : `${label}不能为空`;
export const vJson = (v: string) => { if (!v?.trim()) return ''; try { JSON.parse(v); return ''; } catch (e) { return 'JSON 格式错误：' + String((e as Error).message).replace(/^JSON\.parse: /, ''); } };
export const vRange = (v: string | number, min: number, max: number, label = '数值') => { const n = Number(v); return v === '' || v == null ? '' : Number.isFinite(n) && n >= min && n <= max ? '' : `${label}需在 ${min}–${max} 之间`; };
export const vRegex = (v: string) => { if (!v) return ''; try { new RegExp(v); return ''; } catch { return '正则表达式无效'; } };
