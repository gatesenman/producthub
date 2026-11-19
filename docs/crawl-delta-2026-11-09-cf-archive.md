# Cloudflare 公开存档回退实跑报告（2026-11-09，Asia/Shanghai）

## 总览

| 指标 | 数值 |
|---|---:|
| 库产品数（前） | 1,493,371 |
| 库产品数（后） | **1,493,831** |
| 本轮净增 | **+460** |
| 挑战绕过 | **无**（未引入 FlareSolverr / cloudscraper / 指纹对抗） |
| 打包 | 否 |

工作库：`data/crawl/producthub.db`  
管道模块：`src/server/archive-fallback.ts`  
实跑：`scripts/crawl-delta-cf-archive.ts` + 本轮预拉 Wayback 快照补入库  
方案文档：`docs/Cloudflare-公开通道方案.md`  
摘要：`data/delta/cf-archive-summary.json`

## 原则

只走公开合法通道：直连（非挑战时）、Wayback `available`/快照、Common Crawl 索引 + WARC Range。  
**不**求解 CF/Turnstile/JS challenge，不碰 `cf_clearance`。

## 各源结果

| 来源 | 通道 | 新增产品 | 来源 product_count | 说明 |
|---|---|---:|---:|---|
| **SourceForge** | direct（偶通）+ **Wayback** 目录/分类/分页快照 | **+253** | **253**（原 0） | REST 仍 403/404；分类页快照可解析 `/projects/{slug}` |
| **AlternativeTo** | **Wayback** 2026-10-08 首页快照 | **+127** | 88,972 | 直连仍 Just a moment；实跑时 available 429，用预拉快照增量 |
| **SaaSHub** | **Wayback** 2026-10-21 首页快照 | **+80** | 153,004 | 同上；首页产品链过滤 `best-*` / `*-alternatives` |
| F6S | — | 0 | 0 | 200 但是 Checking your browser；Wayback **无** companies 快照；CC 504 |
| Tools.so | — | 0 | 0 | 直连失败；归档无产品列表 |
| NoCode.Tech | — | 0 | 0 | 429 Checkpoint |
| SelectHub / SpotSaaS / Startup Buffer / Saaspo | — | 0 | 0 | CF；公开存档未解析出产品 |
| EU-Startups | — | 0 | 0 | CF；无产品目录产出 |
| Trustpilot software | — | 0 | 0 | CF Verifying Connection |
| IT桔子 | — | 0 | 0 | HTTP 412；归档无可用列表 |

## 证据摘要

- SourceForge 直连：`directory/` 本环境偶发 HTTP 200（非挑战），解析 25 条；随后 Wayback 分类快照补齐至 253。
- Wayback `available` 在密集调用后出现 **HTTP 429**；模块已加 600ms 间隔 + 429 单次退避。
- Common Crawl：新索引（2026-43 等）对通配/部分精确查询 **504**；`CC-MAIN-2024-51` 精确 URL 曾成功（ATO 首页 WARC 206），本轮补跑时亦 504。管道保留「新→中→旧索引」轮询与 WARC Range 拉取。
- `sourceforge.net` 已加入 `SHARED_HOSTS`，按 `/projects/{slug}` 路径去重（避免整站并成一条）。

## 软件改动

| 文件 | 作用 |
|---|---|
| `src/server/archive-fallback.ts` | CF 检测、Wayback/CC 回退、站点解析器、统一 `resolveViaPublicArchives` |
| `scripts/crawl-delta-cf-archive.ts` | 优先源 + 其余 CF 源实跑入库 |
| `src/server/util.ts` | `SHARED_HOSTS` + sourceforge.net / f6s.com |
| `docs/Cloudflare-公开通道方案.md` | 原则与管道说明 |

## 仍无公开通道的源

F6S、Tools.so、NoCode.Tech、SelectHub、SpotSaaS、Startup Buffer、Saaspo、EU-Startups、Trustpilot、IT桔子。

（AlternativeTo / SaaSHub 本轮已用 Wayback 快照做出增量，不再算「完全无通道」，但直连仍被 CF 挡，后续增量依赖归档节奏与 available 配额。）

## 建议

1. 对 SourceForge 继续用 Wayback 分页/分类快照加深（注意 available 限流）。
2. Common Crawl 优先 **精确 URL** + 较旧索引；通配易 504。
3. 用户未要求打包 → **未打安装包**。
