import React, { useEffect, useState } from 'react';
import { Loader2, FlaskConical, Globe2, RotateCcw, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../api';
import { Button } from '../components/ui/button';
import { Input, Label, Textarea } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';

export const METHOD_OPTS = [['auto', '自动（按顺序回退）'], ['api', '官方 API'], ['rss', 'RSS / Atom'], ['sitemap', 'Sitemap'], ['html', '静态页面'], ['browser', '浏览器网页'], ['archive', '公开存档']].map(([value, label]) => ({ value, label }));
export const METHOD_SHORT: Record<string, string> = { auto: '自动', api: 'API', rss: 'RSS', sitemap: 'Sitemap', html: '静态页', browser: '浏览器', archive: '存档' };
const PROXY_OPTS = [{ value: 'inherit', label: '按全局设置' }, { value: 'proxy', label: '走代理' }, { value: 'direct', label: '不走代理（直连）' }];
export const INTERVAL_OPTS = [[0, '只手动'], [60, '每小时'], [360, '每 6 小时'], [720, '每 12 小时'], [1440, '每天'], [10080, '每周']].map(([v, l]) => ({ value: String(v), label: String(l) }));

/** 每源抓取设置：方式 / 代理 / 入口 / Key / 限速 / 浏览器规则 / 会话；单源测试；打开内置浏览器登录 */
export function SourceSettingsDialog({ guid, onClose, toast, onSaved, browser }: { guid: string | null; onClose: () => void; toast: (m: string, k?: any) => void; onSaved: () => void; browser: boolean }) {
  const [d, setD] = useState<any>(null); const [f, setF] = useState<any>(null); const [key, setKey] = useState(''); const [busy, setBusy] = useState(''); const [test, setTest] = useState<any>(null);
  const load = () => guid && api<any>(`/api/sources/${guid}/settings`).then(x => { setD(x); setF({ ...x.settings, enabled: !!x.source.enabled, interval_min: x.source.interval_min, entryUrls: (x.settings.entryUrls || []).join('\n'), fieldsJson: x.settings.browser?.fields ? JSON.stringify(x.settings.browser.fields, null, 1) : '' }); }).catch(e => toast(e.message, 'err'));
  useEffect(() => { setD(null); setF(null); setKey(''); setTest(null); load(); }, [guid]);
  const b = f?.browser || {}; const setB = (p: any) => setF({ ...f, browser: { ...b, ...p } });
  const body = () => { let fields: any; if (f.fieldsJson?.trim()) { try { fields = JSON.parse(f.fieldsJson); } catch { throw new Error('字段规则不是合法 JSON'); } }
    const { enabled, interval_min, fieldsJson, apiKeySet, apiKeyMasked, ...st } = f; return { enabled, interval_min, settings: { ...st, entryUrls: String(f.entryUrls || '').split('\n'), browser: { ...b, ...(fields ? { fields } : {}) }, ...(key ? { apiKey: key } : {}) } }; };
  const save = async () => { setBusy('save'); try { await api(`/api/sources/${guid}/settings`, { method: 'PUT', body: body() }); toast('来源设置已保存'); setKey(''); onSaved(); load(); } catch (e) { toast('保存失败：' + (e as Error).message, 'err'); } finally { setBusy(''); } };
  const runTest = async (method?: string) => { setBusy('test'); setTest(null); try { await api(`/api/sources/${guid}/settings`, { method: 'PUT', body: body() }); setTest(await api<any>(`/api/sources/${guid}/test`, { body: { method } })); onSaved(); } catch (e) { toast('测试失败：' + (e as Error).message, 'err'); } finally { setBusy(''); } };
  const openBrowser = async () => { try { await api('/api/browser/open', { body: { guid } }); toast('已打开内置浏览器：登录或完成验证后关闭窗口，之后抓取会用这个会话'); } catch (e) { toast((e as Error).message, 'err'); } };
  const reset = async () => { await api(`/api/sources/${guid}/settings`, { method: 'DELETE' }); toast('已恢复默认设置'); onSaved(); load(); };
  const st = d?.stats;
  return <Dialog open={!!guid} onOpenChange={o => !o && onClose()}><DialogContent className="max-w-3xl" data-testid="source-settings">
    <DialogHeader><DialogTitle>来源设置 · {d?.source.name || '…'}</DialogTitle><DialogDescription className="truncate">{d?.source.url}{d?.note && <span className="ml-2 text-brand">· {d.note}</span>}</DialogDescription></DialogHeader>
    {!f ? <div className="space-y-2 p-5">{[0, 1, 2].map(i => <div key={i} className="h-10 animate-pulse rounded bg-muted" />)}</div> :
    <div className="max-h-[66vh] space-y-4 overflow-auto px-5 py-4 text-sm">
      {st && <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs" data-testid="ss-stats">
        <span>最近状态：</span>{d.source.last_status === 'ok' ? <Badge variant="success">正常</Badge> : d.source.last_status ? <Badge variant={d.source.last_status === 'empty' ? 'warning' : 'destructive'}>{st.last_label || d.source.last_status}</Badge> : <Badge variant="outline">未抓取</Badge>}
        <span className="text-muted-foreground">成功 {st.ok} 次 · 失败 {st.fail} 次{st.consecutive_fail > 1 ? `（连续 ${st.consecutive_fail} 次）` : ''}{st.last_method ? ` · 上次方式：${METHOD_SHORT[st.last_method] || st.last_method}` : ''}{d.source.last_crawl_at ? ` · ${new Date(d.source.last_crawl_at).toLocaleString('zh-CN')}` : ''}</span>
        {d.source.last_error && <div className="w-full truncate text-muted-foreground" title={d.source.last_error}>原因：{d.source.last_error.replace(/^\[\w+\]\s*/, '')}</div>}</div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="flex items-center gap-2 pt-5"><Checkbox checked={!!f.enabled} onCheckedChange={v => setF({ ...f, enabled: !!v })} data-testid="ss-enabled" />启用</label>
        <div className="space-y-1"><Label>抓取频率</Label><Select value={String(f.interval_min)} onValueChange={v => setF({ ...f, interval_min: +v })} options={INTERVAL_OPTS} /></div>
        <div className="space-y-1"><Label>最多条数</Label><Input type="number" min={1} max={2000} value={f.maxItems} onChange={e => setF({ ...f, maxItems: +e.target.value })} /></div>
        <div className="space-y-1"><Label>最多页数</Label><Input type="number" min={1} max={50} value={f.maxPages} onChange={e => setF({ ...f, maxPages: +e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label>抓取方式</Label><Select testId="ss-method" value={f.method} onValueChange={v => setF({ ...f, method: v })} options={METHOD_OPTS} />
          <p className="text-xs text-muted-foreground">自动：官方 API → RSS → 静态页面 → 浏览器网页 → Sitemap → 公开存档，前一个失败就换下一个</p></div>
        <div className="space-y-1"><Label>代理</Label><Select testId="ss-proxy" value={f.proxy} onValueChange={v => setF({ ...f, proxy: v })} options={PROXY_OPTS} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label>自定义入口 URL（可选）</Label><Input value={f.entryUrl} onChange={e => setF({ ...f, entryUrl: e.target.value })} placeholder={d.source.url} /></div>
        <div className="space-y-1"><Label>请求间隔（毫秒，留空按全局）</Label><Input type="number" value={f.intervalMs ?? ''} onChange={e => setF({ ...f, intervalMs: e.target.value === '' ? null : +e.target.value })} /></div>
      </div>
      <details className="rounded-md border px-3 py-2" open={['api', 'rss', 'sitemap'].includes(f.method)}><summary className="cursor-pointer text-xs font-medium">官方 API / RSS / Sitemap</summary><div className="mt-2 grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1"><Label>API 地址（可用 {'{apiKey}'}、{'{ymd-7}'} 等占位）</Label><Input value={f.apiUrl} onChange={e => setF({ ...f, apiUrl: e.target.value })} placeholder="https://api.example.com/v1/products" /></div>
        <div className="space-y-1"><Label>JSON 列表路径</Label><Input value={f.jsonPath} onChange={e => setF({ ...f, jsonPath: e.target.value })} placeholder="data.items" /></div>
        <div className="space-y-1"><Label className="flex items-center gap-2">API Key / Token {f.apiKeySet ? <Badge variant="success">已设置 {f.apiKeyMasked}</Badge> : <Badge variant="outline">未设置</Badge>}</Label><Input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="只存在本机" autoComplete="off" data-testid="ss-apikey" /></div>
        <div className="space-y-1"><Label>Key 放在哪个请求头（留空 = Authorization: Bearer）</Label><Input value={f.apiKeyHeader} onChange={e => setF({ ...f, apiKeyHeader: e.target.value })} placeholder="x-api-key" /></div>
        <div className="space-y-1"><Label>RSS 地址</Label><Input value={f.rssUrl} onChange={e => setF({ ...f, rssUrl: e.target.value })} placeholder="{url}/feed" /></div>
        <div className="space-y-1"><Label>Sitemap 地址</Label><Input value={f.sitemapUrl} onChange={e => setF({ ...f, sitemapUrl: e.target.value })} placeholder="https://example.com/sitemap.xml" /></div>
      </div></details>
      <details className="rounded-md border px-3 py-2" open={f.method === 'browser'}><summary className="cursor-pointer text-xs font-medium">浏览器网页模式（内置浏览器渲染真实页面）</summary><div className="mt-2 grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1"><Label>入口页面（一行一个；可用 {'{yyyy}/{m}/{d}'} 表示今天）</Label><Textarea rows={2} value={f.entryUrls} onChange={e => setF({ ...f, entryUrls: e.target.value })} placeholder={d.source.url} data-testid="ss-entry-urls" /></div>
        <div className="space-y-1"><Label>卡片选择器（留空自动识别）</Label><Input value={b.itemSelector || ''} onChange={e => setB({ itemSelector: e.target.value })} placeholder="section[data-container]" data-testid="ss-item-selector" /></div>
        <div className="space-y-1"><Label>等待出现的元素</Label><Input value={b.waitSelector || ''} onChange={e => setB({ waitSelector: e.target.value })} placeholder="与卡片选择器相同即可" /></div>
        <div className="space-y-1"><Label>自动滚动次数</Label><Input type="number" min={0} max={60} value={b.scrolls ?? 3} onChange={e => setB({ scrolls: +e.target.value })} /></div>
        <div className="space-y-1"><Label>加载后等待（毫秒）</Label><Input type="number" min={0} max={60000} value={b.waitMs ?? 2500} onChange={e => setB({ waitMs: +e.target.value })} /></div>
        <div className="space-y-1"><Label>“下一页 / 加载更多”按钮选择器</Label><Input value={b.nextSelector || ''} onChange={e => setB({ nextSelector: e.target.value })} placeholder="button.load-more" /></div>
        <div className="space-y-1"><Label>会话</Label><Select value={f.session} onValueChange={v => setF({ ...f, session: v })} options={[{ value: 'shared', label: '共用内置浏览器会话' }, { value: 'isolated', label: '本源独立会话' }]} /></div>
        <div className="col-span-2 space-y-1"><Label>字段规则（JSON，可选）：name / url / tagline / description / image / votes</Label><Textarea rows={3} className="font-mono text-xs" value={f.fieldsJson} onChange={e => setF({ ...f, fieldsJson: e.target.value })} placeholder={'{"name":{"selector":"h3"},"url":{"selector":"a","attr":"href"}}'} /></div>
        <div className="col-span-2 space-y-1"><Label>提取脚本（可选，在页面里运行，return 数组 [{'{name,url,tagline,image}'}]）</Label><Textarea rows={2} className="font-mono text-xs" value={b.script || ''} onChange={e => setB({ script: e.target.value })} placeholder={"return [...document.querySelectorAll('.card')].map(c => ({ name: c.querySelector('h3')?.innerText, url: c.querySelector('a')?.href }))"} /></div>
        <label className="flex items-center gap-2"><Checkbox checked={!!f.showOnChallenge} onCheckedChange={v => setF({ ...f, showOnChallenge: !!v })} />遇到人机验证时弹出窗口让我处理</label>
        <label className="flex items-center gap-2"><Checkbox checked={!!b.keepDetailAsUrl} onCheckedChange={v => setB({ keepDetailAsUrl: !!v })} />站内详情页也当作产品网址</label>
      </div></details>
      <div className="flex flex-wrap gap-4 text-xs">
        <label className="flex items-center gap-2"><Checkbox checked={!!f.archiveFallback} onCheckedChange={v => setF({ ...f, archiveFallback: !!v })} />都失败时改走公开存档（Wayback / Common Crawl）</label>
        <label className="flex items-center gap-2"><Checkbox checked={!!f.requireExternalUrl} onCheckedChange={v => setF({ ...f, requireExternalUrl: !!v })} />只收带外部产品链接的条目</label>
      </div>
      {test && <div className="rounded-md border text-xs" data-testid="ss-test-result">
        <div className="flex items-center gap-2 border-b px-3 py-2 font-medium">{test.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}{test.ok ? `测试通过：用「${METHOD_SHORT[test.method]}」抓到 ${test.found} 条（未入库）` : `测试失败：${test.reason}`}<span className="ml-auto text-muted-foreground">{(test.ms / 1000).toFixed(1)}s</span></div>
        <div className="flex flex-wrap gap-1 border-b px-3 py-1.5">{test.attempts.map((a: any, i: number) => <Badge key={i} variant={a.ok ? 'success' : 'outline'} title={a.message}>{METHOD_SHORT[a.method]} {a.ok ? a.count + ' 条' : '✗ ' + (a.message || '').slice(0, 30)}</Badge>)}</div>
        {test.sample?.slice(0, 6).map((x: any, i: number) => <div key={i} className="truncate px-3 py-1"><span className="font-medium">{x.name}</span> <span className="text-muted-foreground">{x.tagline || ''} {x.url || x.detailUrl || ''}</span></div>)}</div>}
    </div>}
    <DialogFooter className="flex-wrap">
      <Button variant="ghost" size="sm" onClick={reset} disabled={!f}><RotateCcw />恢复默认</Button>
      {browser && <Button variant="outline" size="sm" onClick={openBrowser} disabled={!f} data-testid="ss-open-browser"><Globe2 />在内置浏览器中打开（登录 / 验证）</Button>}
      <div className="flex-1" />
      <Button variant="outline" size="sm" onClick={() => runTest()} disabled={!f || !!busy} data-testid="ss-test">{busy === 'test' ? <Loader2 className="animate-spin" /> : <FlaskConical />}单源测试</Button>
      <Button variant="brand" size="sm" onClick={save} disabled={!f || !!busy} data-testid="ss-save">{busy === 'save' && <Loader2 className="animate-spin" />}保存</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}
