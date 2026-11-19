import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../api';
import { useMeta, useToast } from '../App';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Input, Textarea, Label } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Button } from '../components/ui/button';
import { cn } from '@/lib/utils';
import { vRequired, vUrl } from '@/lib/validate';

/** 字段容器：标签 + 控件 + 内联错误/提示（错误通过 aria-describedby 关联） */
export const F = ({ label, children, span, error, hint, id }: { label: string; children: React.ReactNode; span?: boolean; error?: string; hint?: string; id?: string }) => <div className={cn('flex flex-col gap-1', span && 'col-span-2')}><Label htmlFor={id}>{label}</Label>{children}
  {error ? <p id={id && id + '-err'} role="alert" data-testid={id && id + '-err'} className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}</div>;
const blank = () => ({ name: '', url: '', tagline: '', description: '', category: '', tags: [] as string[], platforms: [], pricing: '', maker: '', country: '', launch_date: new Date().toISOString().slice(0, 10), logo_url: '', notes: '' });
export function ProductFormDialog({ open, onOpenChange, initial, guid, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: any; guid?: string; onDone: (p: any) => void }) {
  const meta = useMeta(); const toast = useToast();
  const [f, setF] = useState<any>(blank()); const [busy, setBusy] = useState(false); const [touched, setTouched] = useState<Record<string, boolean>>({}); const [tried, setTried] = useState(false);
  useEffect(() => { if (open) { setF({ ...blank(), ...(initial || {}) }); setTouched({}); setTried(false); } }, [open]);
  const errs: Record<string, string> = { name: vRequired(f.name, '名称'), url: vUrl(f.url), logo_url: vUrl(f.logo_url) };
  const show = (k: string) => (touched[k] || tried) ? errs[k] : '';
  const blur = (k: string) => () => setTouched(t => ({ ...t, [k]: true }));
  const inv = (k: string) => ({ 'aria-invalid': !!show(k) || undefined, 'aria-describedby': show(k) ? 'f-' + k + '-err' : undefined, id: 'f-' + k, onBlur: blur(k), className: show(k) ? 'border-destructive focus-visible:ring-destructive/40' : undefined });
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }));
  const toggle = (v: string) => setF((x: any) => ({ ...x, tags: x.tags.includes(v) ? x.tags.filter((y: string) => y !== v) : [...x.tags, v] }));
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setTried(true); const bad = Object.keys(errs).find(k => errs[k]); if (bad) { document.getElementById('f-' + bad)?.focus(); return; } setBusy(true);
    try { const r = guid ? await api('/api/products/' + guid, { method: 'PATCH', body: f }) : await api<any>('/api/products', { body: { ...f, category: f.category || undefined } }); onDone(guid ? { guid, ...r } : r); } catch (er) { toast(String((er as Error).message), 'err'); } finally { setBusy(false); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px]">
        <DialogHeader><DialogTitle>{guid ? '编辑：' + (initial?.name || '') : '手动添加产品'}</DialogTitle><DialogDescription>官网与已有产品相同时，会自动合并为该产品的一次新发布。</DialogDescription></DialogHeader>
        <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col" data-testid="product-form">
          <div className="min-h-0 flex-1 space-y-5 overflow-auto px-5 py-4">
            <section><h4 className="mb-2 text-xs font-semibold">基本信息</h4><div className="grid grid-cols-2 gap-3">
              <F label="名称 *" id="f-name" error={show('name')}>{<Input autoFocus value={f.name} onChange={set('name')} data-testid="f-name" {...inv('name')} />}</F>
              <F label="官网 URL" id="f-url" error={show('url')} hint="用于去重：同一官网会合并为同一产品">{<Input value={f.url || ''} onChange={set('url')} placeholder="https://" data-testid="f-url" {...inv('url')} />}</F>
              <F label="一句话简介" span>{<Input value={f.tagline || ''} onChange={set('tagline')} data-testid="f-tagline" />}</F>
              <F label="详细描述" span>{<Textarea rows={3} value={f.description || ''} onChange={set('description')} />}</F></div></section>
            <section><h4 className="mb-2 text-xs font-semibold">分类与标签</h4><div className="grid grid-cols-2 gap-3">
              <F label="分类">{<Select testId="f-category" value={f.category || ''} onValueChange={v => setF((x: any) => ({ ...x, category: v }))} options={meta.categories.map(c => ({ value: c.id, label: (c.parent ? '　' : '') + c.name }))} placeholder="自动识别" />}</F>
              <F label="定价">{<Input value={f.pricing || ''} onChange={set('pricing')} placeholder="如：免费 / $9/月" />}</F></div>
              <div className="mt-3 space-y-1.5 rounded-lg border p-3">{Object.entries(meta.tagGroups).map(([g, ts]) => <div key={g} className="flex flex-wrap items-center gap-1"><span className="w-16 shrink-0 text-xs text-muted-foreground">{g}</span>{ts.map(t =>
                <button type="button" key={t} onClick={() => toggle(t)} className={cn('rounded-md border px-1.5 text-xs leading-[20px] transition-colors', f.tags.includes(t) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent')}>{t}</button>)}</div>)}</div></section>
            <section><h4 className="mb-2 text-xs font-semibold">其他</h4><div className="grid grid-cols-2 gap-3">
              <F label="开发者/团队">{<Input value={f.maker || ''} onChange={set('maker')} />}</F><F label="国家/地区">{<Input value={f.country || ''} onChange={set('country')} />}</F>
              <F label="发布日期">{<Input type="date" value={f.launch_date || ''} onChange={set('launch_date')} />}</F><F label="Logo/图片 URL" id="f-logo_url" error={show('logo_url')}>{<Input value={f.logo_url || ''} onChange={set('logo_url')} {...inv('logo_url')} />}</F>
              <F label="备注" span>{<Textarea rows={2} value={f.notes || ''} onChange={set('notes')} />}</F></div></section>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" variant="brand" disabled={busy} data-testid="f-submit">{busy && <Loader2 className="animate-spin" />}保存</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
