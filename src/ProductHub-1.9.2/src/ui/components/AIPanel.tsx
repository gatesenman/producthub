import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send, Loader2, MessageSquare, Square, RotateCcw, AlertCircle, Copy } from 'lucide-react';
import { api } from '../api';
import { useMeta, catName, useActions } from '../App';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Skeleton } from './ui/skeleton';
import { useSidebar } from './ui/sidebar';
import { Logo } from './Logo';
import { useResizable } from '../lib/hooks';
import { Tip } from './ui/tooltip';

type Msg = { role: 'user' | 'ai'; text: string; products?: any[]; state?: 'streaming' | 'done' | 'stopped' | 'error'; q?: string };
export function AIPanel({ open, onOpenChange, context, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; context: any; onPick: (p: any) => void }) {
  const meta = useMeta(); const a = useActions(); const sb = useSidebar();
  const [similar, setSimilar] = useState<any[] | null>(null); const [msgs, setMsgs] = useState<Msg[]>([]); const [q, setQ] = useState(''); const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null); const rs = useResizable('ai', 380, 320, 640, 'left');
  useEffect(() => { document.documentElement.style.setProperty('--ai-w', rs.width + 'px'); }, [rs.width]);
  // 窄屏打开 AI 面板时临时收起侧栏，关闭后自动恢复
  const auto = React.useRef(false);
  useEffect(() => { if (open && window.innerWidth < 1600 && !sb.collapsed) { auto.current = true; sb.setCollapsed(true); } else if (!open && auto.current) { auto.current = false; sb.setCollapsed(false); } }, [open]);
  useEffect(() => { if (context?.guid) { setSimilar(null); api<any[]>(`/api/products/${context.guid}/similar?limit=12`).then(setSimilar).catch(() => setSimilar([])); } }, [context?.guid]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);
  // 流式呈现：请求返回后按字逐段输出（约 60 字/帧），可随时「停止」；失败显示错误与「重试」
  const ctl = useRef<{ abort: AbortController; timer?: any } | null>(null);
  const patchLast = (f: (m: Msg) => Msg) => setMsgs(ms => { const c = [...ms]; c[c.length - 1] = f(c[c.length - 1]); return c; });
  const stop = () => { const c = ctl.current; if (!c) return; c.abort.abort(); clearInterval(c.timer); ctl.current = null; setBusy(false); patchLast(m => m.role === 'ai' ? { ...m, state: 'stopped' } : m); };
  const ask = async (text = q, retry = false) => { if (!text.trim() || busy) return; setQ('');
    setMsgs(m => [...(retry ? m.slice(0, -1) : [...m, { role: 'user' as const, text }]), { role: 'ai', text: '', state: 'streaming', q: text }]); setBusy(true);
    const abort = new AbortController(); ctl.current = { abort };
    try { const r = await api<any>('/api/ai/ask', { body: { question: text }, signal: abort.signal }); const full: string = r.answer || '（没有找到相关结果）'; let i = 0;
      await new Promise<void>(res => { const t = setInterval(() => { if (abort.signal.aborted) { clearInterval(t); return res(); } i = Math.min(full.length, i + 6); patchLast(m => ({ ...m, text: full.slice(0, i) }));
        if (i >= full.length) { clearInterval(t); patchLast(m => ({ ...m, state: 'done', products: r.products })); res(); } }, 16); if (ctl.current) ctl.current.timer = t; });
    } catch (e) { if ((e as Error).name !== 'AbortError') patchLast(m => ({ ...m, state: 'error', text: (e as Error).message })); }
    finally { if (ctl.current?.abort === abort) ctl.current = null; setBusy(false); } };
  useEffect(() => () => stop(), []);
  const Item = ({ p }: { p: any }) => <button className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { onPick(p); a.openProduct(p.guid); }}>
    <Logo p={p} size={26} /><div className="min-w-0 flex-1"><div className="truncate font-medium">{p.name}</div><div className="line-clamp-2 text-xs text-muted-foreground">{p.tagline || p.domain}</div><div className="text-2xs text-muted-foreground/80">{catName(meta, p.category)}</div></div>
    <Badge variant="brand" className="tabular-nums" title="相似度">{Math.round(p.score * 100)}%</Badge></button>;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent width={rs.width} data-testid="ai-panel" onEscapeKeyDown={() => onOpenChange(false)}>
        <div onMouseDown={rs.onMouseDown} onDoubleClick={rs.reset} onKeyDown={rs.onKeyDown} tabIndex={0} role="separator" aria-orientation="vertical" aria-label="调整 AI 面板宽度" aria-valuenow={rs.width} className="absolute inset-y-0 -left-1 w-2 cursor-col-resize outline-none transition-colors duration-fast hover:bg-brand/30 focus-visible:bg-brand/40" title="拖动调整宽度 · 双击复位" />
        <div className="flex h-10 items-center gap-2 border-b px-3"><Sparkles className="h-4 w-4 text-brand" /><SheetTitle className="text-sm font-semibold">AI 助手</SheetTitle><Badge variant="outline">{meta.aiEnabled ? meta.aiModel : '离线语义检索'}</Badge><div className="flex-1" /><Button variant="ghost" size="icon" aria-label="关闭 AI 面板" onClick={() => onOpenChange(false)}><X /></Button></div>
        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
          {context && <section className="mb-3"><div className="px-2 pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">与「{context.name}」相似</div>
            <div data-testid="similar-list">{similar === null ? Array.from({ length: 5 }, (_, i) => <div key={i} className="flex gap-2 p-2"><Skeleton className="h-6 w-6" /><div className="flex-1 space-y-1"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3" /></div></div>)
              : similar.length ? similar.map(p => <Item key={p.guid} p={p} />) : <div className="px-2 text-xs text-muted-foreground">暂无相似产品</div>}</div></section>}
          <section><div className="flex items-center gap-1 px-2 pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground"><MessageSquare className="h-3 w-3" />对话检索</div>
            {!msgs.length && <div className="flex flex-wrap gap-1.5 px-2">{['有哪些 AI 写作工具？', '面向开发者的开源工具', '和 Notion 类似的笔记产品', '视频生成相关产品'].map(s => <button key={s} onClick={() => ask(s)} className="rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{s}</button>)}</div>}
            <div aria-live="polite" aria-busy={busy}>{msgs.map((m, i) => <div key={i} data-testid={m.role === 'ai' ? 'ai-msg' : 'user-msg'} data-state={m.state} className={m.role === 'user' ? 'flex justify-end px-2 py-1' : 'px-2 py-1'}>
              {m.role === 'user' ? <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-primary-foreground">{m.text}</div>
                : m.state === 'error' ? <div role="alert" className="flex items-start gap-2 rounded-2xl rounded-bl-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" /><div className="flex-1"><div className="font-medium text-foreground">回答失败</div><div className="text-muted-foreground">{m.text}</div></div><Button size="sm" variant="outline" className="h-6" onClick={() => ask(m.q!, true)} data-testid="ai-retry"><RotateCcw />重试</Button></div>
                : <div className="group/msg relative whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-muted px-3 py-2 leading-6">{m.text || <span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在检索产品库…</span>}
                    {m.state === 'streaming' && m.text && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-foreground/60" aria-hidden />}
                    {m.state === 'stopped' && <span className="ml-1 text-2xs text-muted-foreground">（已停止）</span>}
                    {m.state === 'done' && <button aria-label="复制回答" onClick={() => navigator.clipboard?.writeText(m.text)} className="absolute -right-1 -top-1 rounded-md border bg-background p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity duration-fast hover:text-foreground focus-visible:opacity-100 group-hover/msg:opacity-100"><Copy className="h-3 w-3" /></button>}</div>}
              {m.products?.slice(0, 6).map(p => <Item key={p.guid} p={p} />)}</div>)}</div><div ref={end} />
          </section>
        </div>
        <form className="flex gap-1.5 border-t p-2" onSubmit={e => { e.preventDefault(); ask(); }}><Input placeholder="描述你想找的产品…" value={q} onChange={e => setQ(e.target.value)} data-testid="ai-input" />{busy ? <Tip label="停止生成"><Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={stop} data-testid="ai-stop"><Square className="fill-current" /></Button></Tip> : <Tip label="发送 (Enter)"><Button size="icon" className="h-8 w-8" disabled={!q.trim()} data-testid="ai-send"><Send /></Button></Tip>}</form>
      </SheetContent>
    </Sheet>
  );
}
