# Cloudflare 防护：公开通道方案（不过挑战）

> 时区：Asia/Shanghai · 适用：ProductHub 抓取侧 · 版本随 1.8.2 代码库

## 原则（硬边界）

**禁止**：Cloudflare / Turnstile / JS challenge 求解、`cf_clearance` 窃取、FlareSolverr、cloudscraper、undetected-chromedriver「过 CF」、代理农场打挑战、伪造指纹专门对抗 WAF。

**允许**：官方/公开 API、RSS/Atom、sitemap（直连可用时）、Wayback Machine（CDX / `available` + 快照页）、Common Crawl（`collinfo` + CDX 索引 + WARC Range 片段）、已验证第三方公开归档（如 Arctic Shift Reddit）、镜像站、站点自有数据导出。

产品库规则不变：**只收产品/软件/工具条目**，不收新闻文章。

## 管道（软件已落地）

模块：`src/server/archive-fallback.ts`  
实跑脚本：`scripts/crawl-delta-cf-archive.ts`

```
直连探测
  ├─ 非挑战页 → 解析产品候选（channel=direct）
  └─ 挑战 / 403 / 412 / 429 checkpoint
        ├─ Wayback available → 快照 HTML → 站点解析器
        ├─ Wayback CDX（较长超时 + 重试；可能暂时离线）
        └─ Common Crawl
              ├─ collinfo.json 取最新若干索引
              ├─ 精确 URL 查询（通配易 504，精确更稳）
              └─ data.commoncrawl.org WARC Range → gunzip → HTML
```

挑战识别（`isChallengeHtml`）：`Just a moment` / `Checking your browser` / `Verifying Connection` / `cf-browser-verification` / Vercel Checkpoint / IT桔子类 412 反爬文案等。

## 站点解析器

| 来源 | 解析要点 |
|---|---|
| SourceForge | `/projects/{slug}/` 锚文本（目录/分类快照） |
| AlternativeTo | `/software/{slug}/` |
| SaaSHub | `/` 或 `/app/{slug}` 产品链 |
| F6S | `/companies` 及公司 slug（归档常缺失） |

统一产出：`{ name, url, description?, source, channel }`，入库走现有 `upsertProduct` 去重。

## 适用与局限

| 情况 | 预期 |
|---|---|
| Wayback 有近期目录/列表快照 | 可增量补产品（SourceForge 已验证） |
| 仅首页 CSR 壳、列表靠 XHR | 快照产品少，需更多历史分类页 |
| Common Crawl 索引 504 | 换旧索引 + **精确 URL**；通配不稳定 |
| Wayback「Temporarily Offline」 | 等恢复；可用 `available` API 作弱依赖 |
| 站点从未被归档且无公开 API | **无公开通道**，报告标明，不绕挑战 |

## 本轮命令

```bash
export PATH="/home/box/opt/node-v22.20.0-linux-x64/bin:$PATH"
cd /workspace/product-hub
npx tsx scripts/crawl-delta-cf-archive.ts
# 或 --only=sourceforge,alternativeto
```

报告：`docs/crawl-delta-2026-11-09-cf-archive.md`  
摘要：`data/delta/cf-archive-summary.json`
