import React, { useEffect, useState } from 'react';
import { Sparkles, Play, Save, Loader2, Info } from 'lucide-react';
import { api } from '../api';
import { useToast, useAsync, useMeta } from '../App';
import { Page, Card } from '../components/Page';
import { Button } from '../components/ui/button';
import { Input, Textarea, Label } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { vUrl, vJson } from '@/lib/validate';

const MODES = ['auto', 'rss', 'html', 'jsonld', 'json'];
/** 规则 JSON 校验：语法 + 关键字段 */
export function ruleError(text: string) { const e = vJson(text); if (e) return e; if (!text.trim()) return '规则不能为空'; const r = JSON.parse(text); if (typeof r !== 'object' || Array.isArray(r) || !r) return '规则须为 JSON 对象'; if (r.mode && !MODES.includes(r.mode)) return `mode 只能是 ${MODES.join(' / ')}`; if (r.listUrl && vUrl(r.listUrl)) return 'listUrl 不是有效网址'; if (r.maxItems != null && !(Number(r.maxItems) >= 1 && Number(r.maxItems) <= 500)) return 'maxItems 需在 1–500 之间'; return ''; }

const TEMPLATE = { mode: 'html', listUrl: '', itemSelector: 'article', fields: { name: { selector: 'h3' }, url: { selector: 'a', attr: 'href' }, description: { selector: 'p' }, image: { selector: 'img', attr: 'src' } }, followDetail: true, maxItems: 30 };
export function RulesView({ target }: { target: any }) {
  const toast = useToast(); const meta = useMeta();
  const sources = useAsync(() => api<any[]>('/api/sources'), []);
  const [sourceGuid, setSourceGuid] = useState(target?.guid || ''); const [url, setUrl] = useState(target?.url || ''); const [hint, setHint] = useState('');
  const [ruleText, setRuleText] = useState(target?.rule_json ? JSON.stringify(JSON.parse(target.rule_json), null, 2) : JSON.stringify({ ...TEMPLATE, listUrl: target?.url || '' }, null, 2));
  const [preview, setPreview] = useState<any[] | null>(null); const [msg, setMsg] = useState<{ text: string; ai?: boolean } | null>(null); const [busy, setBusy] = useState('');
  useEffect(() => { const s = sources.data?.find(x => x.guid === sourceGuid); if (s && s.guid !== target?.guid) { setUrl(s.url); setRuleText(s.rule_json ? JSON.stringify(JSON.parse(s.rule_json), null, 2) : JSON.stringify({ ...TEMPLATE, listUrl: s.url }, null, 2)); } }, [sourceGuid]);
  const jsonErr = ruleError(ruleText); const urlErr = vUrl(url);
  const parse = () => jsonErr ? (document.querySelector<HTMLElement>('[data-testid=rule-json]')?.focus(), null) : JSON.parse(ruleText);
  const gen = async () => { setBusy('gen'); setMsg(null); try { const r = await api<any>('/api/rules/generate', { body: { url, hint } }); setRuleText(JSON.stringify(r.rule, null, 2)); setPreview(r.preview); setMsg({ text: r.message, ai: r.mode === 'ai' }); } catch (e) { setMsg({ text: '生成失败：' + (e as Error).message }); } finally { setBusy(''); } };
  const test = async () => { const rule = parse(); if (!rule) return; setBusy('test'); try { const r = await api<any>('/api/rules/test', { body: { rule, url: rule.listUrl || url } }); setPreview(r.items); setMsg({ text: `测试命中 ${r.count} 条` }); } catch (e) { setMsg({ text: '测试失败：' + (e as Error).message }); } finally { setBusy(''); } };
  const save = async () => { const rule = parse(); if (!rule || !sourceGuid) return toast('请先选择要保存到的来源', 'err'); await api('/api/sources/' + sourceGuid, { method: 'PATCH', body: { rule_json: rule } }); toast('规则已保存'); sources.reload(); };
  return (
    <Page title="抓取规则" testId="rules" desc={`输入列表页地址，AI 分析页面结构生成 CSS 选择器规则；支持 RSS / JSON-LD / JSON API / HTML。${meta.aiEnabled ? '' : '当前为离线模式，使用本地启发式推断。'}`}>
      <div className="grid min-h-full grid-cols-1 gap-3 lg:grid-cols-[minmax(380px,1fr)_minmax(320px,1fr)]">
        <Card>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>绑定来源</Label><Select testId="rule-source" value={sourceGuid} onValueChange={setSourceGuid} placeholder="不绑定，仅测试" options={(sources.data || []).map(s => ({ value: s.guid, label: (s.seq ? s.seq + '. ' : '') + s.name }))} /></div>
              <div className="space-y-1"><Label>列表页 URL</Label><Input value={url} onChange={e => setUrl(e.target.value)} data-testid="rule-url" placeholder="https://" aria-invalid={!!urlErr || undefined} aria-describedby="rule-url-err" />{urlErr && <p id="rule-url-err" className="text-xs text-destructive" data-testid="rule-url-err">{urlErr}</p>}</div>
            </div>
            <div className="space-y-1"><Label>给 AI 的提示（可选）</Label><Input value={hint} onChange={e => setHint(e.target.value)} placeholder="例如：只抓取今日发布的产品卡片" /></div>
            <div className="flex gap-1.5"><Button variant="brand" onClick={gen} disabled={!url || !!urlErr || !!busy} data-testid="rule-generate">{busy === 'gen' ? <Loader2 className="animate-spin" /> : <Sparkles />}{busy === 'gen' ? '分析中…' : 'AI 生成规则'}</Button>
              <Button variant="outline" onClick={test} disabled={!!busy || !!jsonErr} data-testid="rule-test">{busy === 'test' ? <Loader2 className="animate-spin" /> : <Play />}测试规则</Button>
              <Button variant="outline" onClick={save} disabled={!sourceGuid || !!jsonErr} title={!sourceGuid ? '请先在「绑定来源」中选择来源' : undefined}><Save />保存到来源</Button></div>
            {msg && <div data-testid="rule-msg" className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">{msg.ai !== undefined && <Badge variant={msg.ai ? 'brand' : 'secondary'}>{msg.ai ? 'AI' : '本地'}</Badge>}{msg.text}</div>}
            <div className="space-y-1"><div className="flex items-center justify-between"><Label>规则 JSON</Label>{jsonErr ? <span className="text-xs text-destructive" role="alert" data-testid="rule-json-err">{jsonErr}</span> : <span className="text-xs text-success">格式正确</span>}</div><Textarea rows={18} aria-invalid={!!jsonErr || undefined} value={ruleText} onChange={e => setRuleText(e.target.value)} spellCheck={false} data-testid="rule-json" className="bg-zinc-950 font-mono text-xs leading-5 text-zinc-100 dark:bg-black/40" /></div>
            <details className="text-xs text-muted-foreground"><summary className="flex cursor-pointer items-center gap-1"><Info className="h-3.5 w-3.5" />规则字段说明</summary><pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{`mode: auto | rss | html | jsonld | json
listUrl: 列表页地址
itemSelector: 每个产品卡片的 CSS 选择器（html 模式）
jsonPath: JSON 数组路径，如 data.items（json 模式）
fields.{name,url,tagline,description,image,votes,date}:
  { selector: 子元素选择器, attr: 取属性(href/src/text), regex: 正则提取 }
followDetail: 是否进入详情页提取官网链接/OG 信息
maxItems: 每次最多抓取条数`}</pre></details>
          </div>
        </Card>
        <Card title={<span className="flex items-center gap-2">抓取预览 {preview && <Badge variant="brand">{preview.length}</Badge>}</span>}>
          <div data-testid="rule-preview" className="divide-y">{preview?.map((p, i) => <div key={i} className="flex gap-3 py-2"><span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span><div className="min-w-0 flex-1"><div className="truncate font-medium">{p.name}</div><div className="line-clamp-2 text-xs text-muted-foreground">{p.tagline || p.description?.slice(0, 140)}</div><div className="truncate font-mono text-2xs text-muted-foreground/80">{p.url || p.detailUrl}</div></div></div>)}
            {!preview && <div className="flex flex-col items-center gap-2 py-16 text-xs text-muted-foreground"><Sparkles className="h-8 w-8 stroke-1" />生成或测试规则后在此预览抓取结果</div>}</div>
        </Card>
      </div>
    </Page>
  );
}
