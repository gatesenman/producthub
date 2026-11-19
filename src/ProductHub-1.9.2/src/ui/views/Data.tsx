import React, { useRef, useState } from 'react';
import { Download, Upload, FileSpreadsheet, FileJson, FileText, Merge, Loader2 } from 'lucide-react';
import { api } from '../api';
import { useToast, useAsync, useMeta, useActions } from '../App';
import { Page, Card } from '../components/Page';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Logo } from '../components/Logo';

function FilePick({ accept, onFile, label, testId }: { accept: string; onFile: (f: File) => void; label: string; testId?: string }) {
  const ref = useRef<HTMLInputElement>(null); const [drag, setDrag] = useState(false);
  return <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
    className={'flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center text-xs text-muted-foreground transition-colors ' + (drag ? 'border-brand bg-brand-soft' : '')}>
    <Upload className="h-5 w-5" /><span>拖拽文件到此处，或</span><Button size="sm" variant="outline" onClick={() => ref.current?.click()}>{label}</Button>
    <input ref={ref} type="file" accept={accept} className="hidden" data-testid={testId} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} /></div>;
}
export function DataView() {
  const toast = useToast(); const meta = useMeta(); const a = useActions();
  const dups = useAsync(() => api<any[][]>('/api/duplicates'), []);
  const [result, setResult] = useState<any>(null); const [busy, setBusy] = useState(false);
  const imp = async (f: File, kind: 'products' | 'sources') => { const ext = f.name.split('.').pop()!.toLowerCase(); setBusy(true);
    try { const r = kind === 'sources' ? await api('/api/sources/import', { raw: await f.text() }) : await api('/api/import?format=' + (ext === 'xls' ? 'xlsx' : ext), { raw: await f.arrayBuffer() }); setResult(r); toast('导入完成'); dups.reload(); a.refreshStatus(); } catch (er) { toast('导入失败：' + (er as Error).message, 'err'); } finally { setBusy(false); } };
  const merge = async (into: string, from: string) => { await api('/api/products/merge', { body: { into, from } }); toast('已合并'); dups.reload(); };
  const icons: Record<string, any> = { csv: FileText, xlsx: FileSpreadsheet, json: FileJson };
  return (
    <Page title="导入导出" desc="CSV / Excel / JSON 互通；按规范化官网生成 UUIDv5 稳定 GUID 自动去重" testId="data">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card title="导出产品库" desc="含 GUID、分类、标签、AI 总结、发布次数；JSON 含完整版本记录">
          <div className="flex flex-col gap-1.5">{['csv', 'xlsx', 'json'].map(f => { const I = icons[f]; return <Button key={f} variant="outline" className="justify-start" asChild><a href={'/api/export?format=' + f} data-testid={'export-' + f}><I />导出为 {f.toUpperCase()}<Download className="ml-auto" /></a></Button>; })}</div></Card>
        {!meta.readOnly && <Card title="导入产品" desc="列名支持中文（名称、网址、简介…）或英文字段名；重复产品自动合并为新版本">
          <FilePick accept=".csv,.xlsx,.xls,.json" label="选择文件（CSV / Excel / JSON）" onFile={f => imp(f, 'products')} testId="import-file" />
          {busy && <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在导入…</div>}
          {result && <div className="mt-2 flex flex-wrap gap-1.5 text-xs"><Badge variant="outline">共 {result.total}</Badge><Badge variant="success">新增 {result.inserted}</Badge>{result.updated !== undefined && <Badge variant="brand">更新 {result.updated}</Badge>}{!!result.skipped && <Badge variant="warning">跳过 {result.skipped}</Badge>}</div>}</Card>}
        {!meta.readOnly && <Card title="导入监控来源" desc="CSV 列：序号, 名称, 网址, 类别, 地区/语言, 简介, 提交方式, 流量/知名度, 核验状态"><FilePick accept=".csv" label="选择来源 CSV" onFile={f => imp(f, 'sources')} /></Card>}
        <Card className="lg:col-span-3" title={<span className="flex items-center gap-2">疑似重复（同名不同网址）{dups.data && <Badge variant="secondary">{dups.data.length} 组</Badge>}</span>} desc="相同官网已自动合并；以下为同名但域名不同的候选，确认后可手动合并">
          {dups.loading ? <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div> :
            <div className="divide-y rounded-lg border">{dups.data?.slice(0, 60).map((g, i) => <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-1.5"><div className="space-y-1">{g.map((p: any) => <div key={p.guid} className="flex min-w-0 items-center gap-2"><Logo p={p} size={18} /><span className="font-medium">{p.name}</span><span className="truncate font-mono text-2xs text-muted-foreground">{p.url || p.dedup_key}</span></div>)}</div>
              {!meta.readOnly && <Button size="sm" variant="outline" onClick={() => merge(g[0].guid, g[1].guid)}><Merge />合并</Button>}</div>)}
              {dups.data && !dups.data.length && <div className="py-8 text-center text-xs text-muted-foreground">没有发现疑似重复</div>}</div>}
        </Card>
      </div>
    </Page>
  );
}
