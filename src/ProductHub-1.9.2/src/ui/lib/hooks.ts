import { useEffect, useState, useCallback, useRef } from 'react';
export type Theme = 'system' | 'light' | 'dark';
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('ph.theme') as Theme) || 'system');
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { const d = theme === 'dark' || (theme === 'system' && mq.matches); document.documentElement.classList.toggle('dark', d); setDark(d); };
    apply(); localStorage.setItem('ph.theme', theme); mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply);
  }, [theme]);
  return { theme, setTheme, dark, cycle: () => setTheme(t => t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system') };
}
export function useAsync<T>(fn: () => Promise<T>, deps: any[]) {
  const [data, setData] = useState<T | null>(null); const [loading, setLoading] = useState(true); const [n, setN] = useState(0); const [error, setError] = useState<string | null>(null);
  useEffect(() => { let ok = true; setLoading(true); fn().then(d => { if (ok) { setData(d); setError(null); } }).catch(e => ok && setError(String(e?.message || e))).finally(() => ok && setLoading(false)); return () => { ok = false; }; }, [...deps, n]);
  return { data, loading, error, reload: useCallback(() => setN(x => x + 1), []), setData };
}
/** 可拖拽调宽，宽度持久化 */
export function useResizable(key: string, def: number, min: number, max: number, side: 'left' | 'right' = 'left') {
  const [w, setW] = useState(() => Math.min(max, Math.max(min, Number(localStorage.getItem('ph.w.' + key)) || def)));
  const start = useRef<{ x: number; w: number } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    start.current = { x: e.clientX, w }; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    const move = (ev: MouseEvent) => { if (!start.current) return; const d = ev.clientX - start.current.x; setW(Math.min(max, Math.max(min, start.current.w + (side === 'left' ? -d : d)))); };
    const up = () => { start.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); setW(x => { localStorage.setItem('ph.w.' + key, String(x)); return x; }); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const set = (x: number) => { const v = Math.min(max, Math.max(min, x)); setW(v); localStorage.setItem('ph.w.' + key, String(v)); };
  /** 双击复位；键盘 ←/→ 每次 16px（Shift 64px），Home/End 到最小/最大 */
  const reset = () => set(def);
  const onKeyDown = (e: React.KeyboardEvent) => { const step = e.shiftKey ? 64 : 16; const dir = side === 'left' ? -1 : 1;
    if (e.key === 'ArrowLeft') { e.preventDefault(); set(w - dir * step); } else if (e.key === 'ArrowRight') { e.preventDefault(); set(w + dir * step); } else if (e.key === 'Home') set(min); else if (e.key === 'End') set(max); else if (e.key === 'Enter') reset(); };
  return { width: w, onMouseDown, reset, onKeyDown, min, max };
}
