import React, { useEffect, useState } from 'react';
import { Sun, Moon, Monitor, Loader2, Download, RefreshCw, FileUp } from 'lucide-react';
import { api } from '../api';
import { useToast, useActions } from '../App';
import { Page } from '../components/Page';
import { Button } from '../components/ui/button';
import { Input, Label } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { cn } from '@/lib/utils';
import { vUrl, vRequired, vRange } from '@/lib/validate';
import { DeltaUpdate } from './DeltaUpdate';
import { NetSettings } from './NetSettings';
const Err = ({ id, e }: { id: string; e: string }) => e ? <p id={id} role="alert" data-testid={id} className="text-xs text-destructive">{e}</p> : null;

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 py-5 md:grid-cols-[240px_1fr]"><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{desc}</p></div><div className="max-w-xl space-y-3">{children}</div></div>;
}
export function SettingsView({ onSaved }: { onSaved: () => void }) {
  const toast = useToast(); const a = useActions(); const [s, setS] = useState<any>(null); const [key, setKey] = useState(''); const [busy, setBusy] = useState(false); const [orig, setOrig] = useState<any>(null); const [armed, setArmed] = useState(false); const [saving, setSaving] = useState(false);
  const load = () => api<any>('/api/settings').then(x => { setS(x); setOrig(x); }).catch(e => toast('读取设置失败：' + (e as Error).message, 'err', { action: { label: '重试', run: load } }));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  if (!s) return <Page title="设置" desc="AI 服务、网络与代理、增量更新、外观与数据" testId="settings"><div className="mx-auto max-w-4xl space-y-3 py-5">{[0, 1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}</div></Page>;
  const err = { base: vUrl(s['ai.baseUrl'], true), model: vRequired(s['ai.model'], '模型名称'), batch: vRange(s['scheduler.batch'], 1, 50, '每批来源数') || (String(s['scheduler.batch'] ?? '').trim() === '' ? '必填' : '') };
  const aiDirty = !!key || s['ai.baseUrl'] !== orig?.['ai.baseUrl'] || s['ai.model'] !== orig?.['ai.model']; const schedDirty = String(s['scheduler.batch']) !== String(orig?.['scheduler.batch']);
  const save = async () => { if (err.base || err.model || err.batch) return; setSaving(true); try { await api('/api/settings', { body: { 'ai.baseUrl': s['ai.baseUrl'].trim(), 'ai.model': s['ai.model'].trim(), 'scheduler.batch': s['scheduler.batch'], ...(key ? { 'ai.apiKey': key } : {}) } }); toast('设置已保存'); setKey(''); onSaved(); load(); } catch (e) { toast('保存失败：' + (e as Error).message, 'err', { action: { label: '重试', run: save } }); } finally { setSaving(false); } };
  const batch = async () => { setBusy(true); try { const r = await api<any>('/api/analyze-batch', { body: { limit: 50 } }); toast(`已分析 ${r.analyzed} 个产品`); } catch (e) { toast('批量总结失败：' + (e as Error).message, 'err', { action: { label: '重试', run: batch } }); } finally { setBusy(false); } };
  const themes = [['system', '跟随系统', Monitor], ['light', '浅色', Sun], ['dark', '深色', Moon]] as const;
  return (
    <Page title="设置" desc="AI 服务、网络与代理、增量更新、外观与数据" testId="settings">
      <div className="mx-auto max-w-4xl divide-y">
        <Section title="外观" desc="浅色 / 深色 / 跟随系统；也可用 Ctrl+Shift+L 快速切换">
          <div className="grid grid-cols-3 gap-2">{themes.map(([v, l, I]) => <button key={v} aria-pressed={a.theme.theme === v} data-testid={'theme-' + v} onClick={() => a.theme.setTheme(v)} className={cn('flex flex-col items-center gap-2 rounded-lg border p-3 text-xs transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', a.theme.theme === v && 'border-brand ring-1 ring-brand')}>
            <div className={cn('flex h-12 w-full items-end gap-1 rounded-md border p-1.5', v === 'dark' ? 'bg-zinc-900' : v === 'light' ? 'bg-white' : 'bg-gradient-to-r from-white to-zinc-900')}><div className="h-full w-3 rounded-sm bg-zinc-400/40" /><div className="h-2/3 flex-1 rounded-sm bg-zinc-400/30" /></div><span className="flex items-center gap-1"><I className="h-3.5 w-3.5" />{l}</span></button>)}</div>
        </Section>
        <Section title="AI 服务" desc="OpenAI 兼容接口：OpenAI / DeepSeek / 通义千问 / Moonshot / 本地 Ollama。未配置时自动降级为本地离线算法。">
          <div className="space-y-1"><Label htmlFor="set-base">Base URL</Label><Input id="set-base" data-testid="set-base" value={s['ai.baseUrl']} aria-invalid={!!err.base || undefined} aria-describedby="set-base-err" onChange={e => setS({ ...s, 'ai.baseUrl': e.target.value })} /><Err id="set-base-err" e={err.base} /></div>
          <div className="space-y-1"><Label htmlFor="set-model">模型</Label><Input id="set-model" data-testid="set-model" value={s['ai.model']} aria-invalid={!!err.model || undefined} aria-describedby="set-model-err" onChange={e => setS({ ...s, 'ai.model': e.target.value })} /><Err id="set-model-err" e={err.model} /></div>
          <div className="space-y-1"><Label className="flex items-center gap-2">API Key {s['ai.apiKeySet'] ? <Badge variant="success">已设置 {s['ai.apiKeyMasked']}</Badge> : <Badge variant="outline">未设置</Badge>}</Label><Input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-…（也可用环境变量 OPENAI_API_KEY）" /></div>
          <div className="flex items-center gap-2"><Button variant="brand" data-testid="set-save-ai" onClick={save} disabled={!aiDirty || !!err.base || !!err.model || saving}>{saving && <Loader2 className="animate-spin" />}保存</Button>
            {s['ai.apiKeySet'] && <Button variant={armed ? 'destructive' : 'outline'} data-testid="clear-key" onClick={async () => { if (!armed) return setArmed(true); setArmed(false); await api('/api/settings', { body: { 'ai.apiKey': '' } }); toast('API Key 已清除'); onSaved(); load(); }}>{armed ? '再次点击确认清除' : '清除 Key'}</Button>}
            {aiDirty && <span className="text-xs text-muted-foreground">有未保存的修改</span>}</div>
        </Section>
        <Section title="网络与代理" desc="抓取、公开存档、图片和 AI 请求都走这里：代理（跟随系统 / 手动 HTTP·SOCKS5 / 不用）、超时、重试、并发、请求间隔与 User-Agent。">
          <NetSettings toast={toast} />
        </Section>
        <Section title="来源调度" desc="调度器每分钟检查到期来源（按各来源抓取频率），失败来源自动 3 倍退避。">
          <div className="space-y-1"><Label htmlFor="set-batch">每批抓取来源数（1–50）</Label><Input id="set-batch" data-testid="set-batch" type="number" min={1} max={50} className="w-32" value={s['scheduler.batch']} aria-invalid={!!err.batch || undefined} aria-describedby="set-batch-err" onChange={e => setS({ ...s, 'scheduler.batch': e.target.value })} /><Err id="set-batch-err" e={err.batch} /></div>
          <Button variant="outline" onClick={save} disabled={!schedDirty || !!err.batch || saving}>保存</Button>
        </Section>
        <Section title="增量更新" desc="不必重装 GB 级安装包：拿到增量包（更新地址或本地文件）即可把新数据合并进本地库。按数据版本号顺序衔接、SHA256 校验、断点续传，失败自动回滚。不覆盖收藏、筛选、备注与手动添加的产品。">
          <DeltaUpdate s={s} setS={setS} orig={orig} toast={toast} onChanged={() => { onSaved(); load(); a.refreshStatus(); }} />
        </Section>
        <Section title="批量 AI 总结" desc="为尚未总结的产品生成总结与多维分析（每次 50 个）。">
          <Button variant="outline" disabled={busy} onClick={batch}>{busy && <Loader2 className="animate-spin" />}{busy ? '分析中…' : '开始批量总结'}</Button>
        </Section>
        <Section title="数据" desc="单个 SQLite 文件与图片缓存目录，可直接备份。">
          <code className="block rounded-md bg-muted px-3 py-2 font-mono text-xs">{s.dataDir}</code>
        </Section>
        <Section title="帮助" desc="重新查看首次启动引导，或查阅使用手册（安装目录 docs/使用手册.md）"><Button variant="outline" size="sm" onClick={() => a.showOnboarding()} data-testid="rerun-onboarding">重新显示新手引导</Button></Section>
      </div>
    </Page>
  );
}
