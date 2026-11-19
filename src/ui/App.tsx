import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api';
import { useTheme, useAsync } from './lib/hooks';
import { TooltipProvider } from './components/ui/tooltip';
import { SidebarProvider, useSidebar } from './components/ui/sidebar';
import { AppSidebar, NavSel } from './components/AppSidebar';
import { TitleBar } from './components/TitleBar';
import { StatusBar } from './components/StatusBar';
import { CommandPalette } from './components/CommandPalette';
import { AIPanel } from './components/AIPanel';
import { Toaster, type ToastItem } from './components/Toaster';
import { ProductsView } from './views/Products';
import { AnalyticsView } from './views/Analytics';
import { SourcesHub } from './views/SourcesHub';
import { HomeView } from './views/Home';
import { DesignView } from './views/Design';
import { Onboarding } from './components/Onboarding';
import { DEV } from './components/AppSidebar';
import { DataView } from './views/Data';
import { SettingsView } from './views/Settings';
import { Skeleton } from './components/ui/skeleton';
import { CompareView } from './views/Compare';

export type Meta = { version: string; readOnly: boolean; aiEnabled: boolean; aiModel: string; categories: { id: string; name: string; parent: string | null }[]; tagGroups: Record<string, string[]>; fields: Record<string, { label: string; kind: string }>; ops: Record<string, string> };
export const MetaCtx = React.createContext<Meta | null>(null);
export type ToastOpts = { action?: { label: string; run: () => void }; duration?: number };
export const ToastCtx = React.createContext<(s: string, kind?: 'ok' | 'err', opts?: ToastOpts) => void>(() => {});
export type AppActions = { go: (view: string) => void; openProduct: (guid: string) => void; openAI: (p?: any) => void; toggleAI: () => void; addProduct: () => void; nav: NavSel; setNav: (n: NavSel) => void; refreshStatus: () => void; theme: ReturnType<typeof useTheme>; goSources: (o?: { status?: string; tab?: string }) => void; openPalette: () => void; showOnboarding: () => void; search: (q: string, chips?: string[]) => void; compare: (guids: string[]) => void };
export const ActionsCtx = React.createContext<AppActions>(null as any);
export const useMeta = () => React.useContext(MetaCtx)!;
export const useToast = () => React.useContext(ToastCtx);
export const useActions = () => React.useContext(ActionsCtx);
export { useAsync };
export function catName(meta: Meta, id?: string) { return meta.categories.find(c => c.id === id)?.name || '其他'; }

/** 信息架构：Ctrl+1…7 依次为 首页 / 产品库 / 我的关注 / 来源与规则 / 分析与报告 / 导入导出 / 设置 */
export const VIEWS = ['home', 'products', 'favorites', 'sources', 'analytics', 'data', 'settings'] as const;

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const reloadMeta = () => api<Meta>('/api/meta').then(setMeta);
  useEffect(() => { reloadMeta(); }, []);
  if (!meta) return <div className="flex h-full flex-col"><div className="h-10 border-b" /><div className="flex flex-1"><div className="w-[248px] border-r p-3 space-y-2">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div><div className="flex-1 p-4 space-y-2">{Array.from({ length: 14 }, (_, i) => <Skeleton key={i} className="h-7" />)}</div></div></div>;
  return <MetaCtx.Provider value={meta}><TooltipProvider delayDuration={300}><SidebarProvider><Shell reloadMeta={reloadMeta} /></SidebarProvider></TooltipProvider></MetaCtx.Provider>;
}

function Shell({ reloadMeta }: { reloadMeta: () => void }) {
  const meta = useMeta(); const theme = useTheme(); const sidebar = useSidebar();
  const [view, setView] = useState(() => new URLSearchParams(location.search).get('view') || 'home');
  const [srcTab, setSrcTab] = useState('list'); const [srcStatus, setSrcStatus] = useState('');
  const [onboard, setOnboard] = useState(false);
  useEffect(() => { if (!meta.readOnly && !new URLSearchParams(location.search).has('noonboard')) api<any>('/api/settings').then(st => { if (!st['app.onboarded']) setOnboard(true); }).catch(() => {}); }, []);
  const [nav, setNav] = useState<NavSel>({ kind: 'all' });
  const [selected, setSelected] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false); const [aiContext, setAiContext] = useState<any>(null);
  const [palette, setPalette] = useState(false); const [adding, setAdding] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [rulesTarget, setRulesTarget] = useState<any>(null);
  const [searchSig, setSearchSig] = useState<{ q: string; chips?: string[]; n: number } | null>(null);
  const [cmp, setCmp] = useState<string[]>(() => (new URLSearchParams(location.search).get('guids') || '').split(',').filter(Boolean));
  const status = useAsync(() => api<any>('/api/status'), []);
  useEffect(() => { const t = setInterval(status.reload, 15000); return () => clearInterval(t); }, []);
  const dismissToast = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), []);
  const toast = useCallback((s: string, kind: 'ok' | 'err' = 'ok', opts: ToastOpts = {}) => { const id = Date.now() + Math.random(); setToasts(t => [...t.slice(-3), { id, s, kind, action: opts.action }]); setTimeout(() => dismissToast(id), opts.duration ?? (opts.action ? 6000 : kind === 'err' ? 5000 : 3500)); }, []);
  const go = (v: string) => {
    if (v === 'favorites') { setNav({ kind: 'favorite', label: '我的关注' }); setView('products'); return; }
    if (v === 'products') { setNav(n => n.kind === 'favorite' ? { kind: 'all' } : n); }
    if (v === 'rules') { setSrcTab('rules'); setView('sources'); return; }
    if (v === 'sources') setSrcTab('list');
    setView(v);
  };
  const actions: AppActions = {
    go, nav, theme, refreshStatus: status.reload, openPalette: () => setPalette(true), showOnboarding: () => setOnboard(true),
    goSources: (o = {}) => { setSrcStatus(o.status || ''); setSrcTab(o.tab || 'list'); setView('sources'); },
    setNav: n => { setNav(n); setView('products'); },
    openProduct: g => { setView('products'); setSelected(g); },
    openAI: p => { if (p) setAiContext(p); setAiOpen(true); },
    toggleAI: () => setAiOpen(o => !o),
    search: (q, chips) => { setNav({ kind: 'all' }); setView('products'); setSearchSig(x => ({ q, chips, n: (x?.n || 0) + 1 })); },
    compare: guids => { setCmp(guids.slice(0, 5)); setView('compare'); },
    addProduct: () => { if (!meta.readOnly) { setView('products'); setAdding(x => x + 1); } },
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
      if (mod && k === 'k') { e.preventDefault(); setPalette(p => !p); }
      else if (mod && k === 'j') { e.preventDefault(); setAiOpen(o => !o); }
      else if (mod && k === 'b') { e.preventDefault(); sidebar.toggle(); }
      else if (mod && k === 'n') { e.preventDefault(); actions.addProduct(); }
      else if (mod && /^[1-7]$/.test(k)) { e.preventDefault(); go(VIEWS[+k - 1]); }
      else if (mod && e.shiftKey && k === 'l') { e.preventDefault(); theme.cycle(); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });
  return (
    <ToastCtx.Provider value={toast}><ActionsCtx.Provider value={actions}>
      <div className="flex h-full flex-col">
        <TitleBar onPalette={() => setPalette(true)} aiOpen={aiOpen} />
        <div className="flex min-h-0 flex-1">
          <AppSidebar view={view} status={status.data} />
          <main className="flex min-w-0 flex-1 flex-col" style={{ marginRight: aiOpen ? 'var(--ai-w, 380px)' : 0, transition: 'margin-right .2s ease' }}>
            {view === 'products' && <ProductsView selected={selected} setSelected={setSelected} addSignal={adding} searchSignal={searchSig} onCompare={actions.compare} />}
            {view === 'compare' && <CompareView guids={cmp} setGuids={setCmp} />}
            {view === 'analytics' && <AnalyticsView />}
            {view === 'home' && <HomeView />}
            {view === 'sources' && <SourcesHub tab={srcTab} setTab={setSrcTab} status={srcStatus} ruleTarget={rulesTarget} onEditRule={(s: any) => { setRulesTarget(s); setSrcTab('rules'); }} />}
            {view === 'design' && DEV && <DesignView />}
            {view === 'data' && <DataView />}
            {view === 'settings' && <SettingsView onSaved={() => { reloadMeta(); status.reload(); }} />}
          </main>
        </div>
        <StatusBar status={status.data} aiOpen={aiOpen} />
        <AIPanel open={aiOpen} onOpenChange={setAiOpen} context={aiContext} onPick={(p: any) => setAiContext(p)} />
        <CommandPalette open={palette} onOpenChange={setPalette} />
        <Toaster toasts={toasts} dismiss={dismissToast} />
        <Onboarding open={onboard} onClose={() => { setOnboard(false); toast('引导已暂停，下次启动会从这一步继续'); }} onDone={(ai) => { setOnboard(false); setView('home'); if (ai) { reloadMeta(); toast('已连接大模型'); } }} />
      </div>
    </ActionsCtx.Provider></ToastCtx.Provider>
  );
}
