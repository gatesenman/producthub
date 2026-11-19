# 产品库增量抓取报告（至 2026-11-09，Asia/Shanghai）

## 总览
| 指标 | 抓取前 | 抓取后 | 变化 |
|---|---:|---:|---:|
| 产品总数 | 1,386,886 | 1,409,942 | **+23,056** |
| 版本记录 | 2,179,783 | 2,234,509 | +54,726 |
| 来源 last_status=ok | 605 | 605 | — |
| 来源仍失败/空（0 产品） | 44 | 44 | — |

- **起止时间（Asia/Shanghai）**：约 2026-11-09 10:22 → 2026-11-09 10:50
- **新增产品**：23,056（当日 `created_at` 全部计入本次）
- **合并/更新**（按 upsert 计，含已有产品补字段/新版本）：约 32,539
- **备份**：`data/backups/pre-delta-2026-11-09.json`（元数据快照；磁盘紧未做整库拷贝）
- **安装包**：本次**未**重打；只更新了 `data/crawl/producthub.db`。若要把新库打进安装包，需另开打包任务。

## 本轮抓取方式
1. **API/专用适配器**（`scripts/crawl-delta-today.ts --phase=api`，Node 22 + better-sqlite3 prebuild）
   - Hacker News Show HN（Algolia，自 2026-10-20）
   - GitHub 高星仓库（`created:2026-10-01..今天`，stars≥200）
   - Official MCP Registry（官方 API；安全上限 500 页 ×100，本轮满页）
   - BetaList 近 40 页
2. **Product Hunt**：榜单页 Cloudflare 拦截；改用公开 Atom `https://www.producthunt.com/feed`（约 50 条近两日）+ HuntScreens 首页镜像入库
3. **通用来源**（`crawlSource`，优先高价值 ok 来源 60 个，并发 3）
4. 跳过新闻/媒体来源；Reddit / SourceForge / Trustpilot / IT桔子等稳定失败源未死磕

## 主要来源增量（product_count 变化 Top）
| seq | 来源 | 前 | 后 | Δ |
|---:|---|---:|---:|---:|
| 125 | Official MCP Registry | 40,518 | 61,000 | +20,482 |
| 211 | GitHub Trending / Topics | 20,328 | 22,210 | +1,882 |
| 2 | BetaList | 27,225 | 28,228 | +1,003 |
| 366 | HuntScreens.com | 23,455 | 23,670 | +215 |
| 162 | Hacker News – Show HN | 86,236 | 86,379 | +143 |
| 422 | PeerPush | 19,368 | 19,472 | +104 |
| 508 | ToolScout AI | 4,132 | 4,219 | +87 |
| 426 | PoweredbyAI | 6,225 | 6,300 | +75 |
| 533 | WhatTheAI | 26,189 | 26,249 | +60 |
| 369 | IndieHackerStacks | 5,827 | 5,878 | +51 |
| 597 | Not Human Search | 5,603 | 5,653 | +50 |
| 392 | magicbox.tools | 5,341 | 5,390 | +49 |
| 619 | Toolio AI | 5,505 | 5,549 | +44 |
| 305 | BestofAI | 13,086 | 13,123 | +37 |
| 1 | Product Hunt | 336,434 | 336,468 | +34 |

## 本轮浅抓失败（已有存量，状态已恢复为 ok）
这些目录首页/列表被 403/429，历史数据仍在库中；未阻塞整体增量。

| seq | 来源 | 错误 |
|---:|---|---|
| 48 | SaaSHub | HTTP 403 |
| 210 | LibHunt | HTTP 403 |
| 47 | AlternativeTo | HTTP 403 |
| 84 | SoftwareWorld | HTTP 403 |
| 75 | SaaSworthy | HTTP 429 |
| 80 | Serchen | HTTP 403 |
| 411 | OpenFuture AI | HTTP 403 |
| 69 | Capterra | HTTP 403 |
| 339 | Ecomm Design | HTTP 403 |
| 71 | Software Advice | HTTP 403 |
| 301 | Awesome Indie | HTTP 403 |
| 115 | EveryDev.ai | HTTP 429 |

## 仍失败 / 0 产品来源（enabled，长期）
多因 Cloudflare/403/429、需登录或官方 API、或属媒体站（本轮按规则跳过新闻源）。

- **62 Tools.so** (`tools.so`) — empty: 
- **64 NoCode.Tech** (`nocode.tech`) — error: HTTP 429
- **67 SourceForge** (`sourceforge.net`) — error: HTTP 403
- **78 Trustpilot** (`trustpilot.com`) — error: HTTP 403
- **79 SelectHub** (`selecthub.com`) — error: HTTP 403
- **83 SpotSaaS** (`spotsaas.com`) — error: HTTP 403
- **88 Thingtesting** (`thingtesting.com`) — error: HTTP 403
- **128 F6S** (`f6s.com`) — empty: 
- **131 Startup Ranking** (`startupranking.com`) — ok: 
- **135 Startup Buffer** (`startupbuffer.com`) — error: HTTP 403
- **152 EU-Startups** (`eu-startups.com`) — error: HTTP 403
- **154 e27** (`e27.co`) — error: HTTP 403
- **155 IT桔子** (`itjuzi.com`) — error: HTTP 412
- **165 Reddit r/SideProject** (`reddit.com`) — error: Reddit HTTP 403（被 Reddit 网络封锁）
- **166 Reddit r/startups** (`reddit.com`) — error: Reddit HTTP 403（被 Reddit 网络封锁）
- **167 Reddit r/SaaS** (`reddit.com`) — error: Reddit HTTP 403（被 Reddit 网络封锁）
- **168 Reddit r/IMadeThis** (`reddit.com`) — error: Reddit HTTP 403（被 Reddit 网络封锁）
- **169 Reddit r/alphaandbetausers** (`reddit.com`) — error: Reddit HTTP 403（被 Reddit 网络封锁）
- **170 Reddit r/indiehackers** (`reddit.com`) — error: Reddit HTTP 403（被 Reddit 网络封锁）
- **171 Reddit r/microsaas** (`reddit.com`) — error: Reddit HTTP 403（被 Reddit 网络封锁）
- **172 Reddit r/EntrepreneurRideAlong** (`reddit.com`) — error: Reddit HTTP 403（被 Reddit 网络封锁）
- **174 DEV Community** (`dev.to`) — ok: 
- **175 Hashnode** (`hashnode.com`) — ok: 
- **180 即刻** (`web.okjike.com`) — empty: 
- **182 SegmentFault 思否** (`segmentfault.com`) — ok: 
- **183 人人都是产品经理** (`woshipm.com`) — ok: 
- **184 酷安** (`coolapk.com`) — empty: 
- **185 vc.ru** (`vc.ru`) — ok: 
- **186 鸟哥笔记** (`niaogebiji.com`) — ok: 
- **187 Sidebar** (`sidebar.io`) — ok: 
- **189 Starter Story** (`starterstory.com`) — ok: 
- **194 YourStory** (`yourstory.com`) — error: HTTP 403
- **195 Inc42** (`inc42.com`) — ok: 
- **196 GeekWire Startup List** (`geekwire.com`) — error: HTTP 403
- **198 少数派** (`sspai.com`) — ok: 
- **200 产品沉思录** (`pmthinking.com`) — empty: 
- **203 36氪** (`36kr.com`) — empty: 
- **204 爱范儿** (`ifanr.com`) — ok: 
- **205 极客公园** (`geekpark.net`) — error: HTTP 403
- **207 TechNode 动点科技** (`technode.com`) — ok: 
- **208 Pandaily** (`pandaily.com`) — ok: 
- **221 Saaspo** (`saaspo.com`) — error: HTTP 403
- **240 FWOL 分类目录** (`fwol.cn`) — error: fetch failed
- **611 Setting up the launchpad** (`speakerdeck.com`) — ok: 

典型稳定失败：SourceForge / Trustpilot / SelectHub / SpotSaaS / Thingtesting / Startup Buffer / NoCode.Tech / Tools.so / F6S / Saaspo / IT桔子 / Reddit 各子版 / 即刻 / 酷安 / 产品沉思录 / FWOL 等。

## Product Hunt 说明
- 日榜 `leaderboard/daily/...` 与 sitemap 当前 Cloudflare「Just a moment」拦截（Playwright Chrome 亦未过）。
- 本轮用官方 Atom feed 补到 **2026-11-07/08** 附近新产品（+34 新产品）。
- **2026-10-21～11-06** 的 PH 日更仍缺口；若要补全，建议配置 Product Hunt API token，或等 CF 放行后再跑 `ph-delta-lb`。

## MCP 说明
- API 翻页安全上限 500 页，本轮拿到 50,000 条并 upsert；来源产品数 40,518 → 61,000。
- 若 Registry 总量继续增长，下次可提高页上限或做 cursor 断点续跑。

## 产物路径
- 工作库：`data/crawl/producthub.db`
- 增量 JSON：`data/delta/`（hn/github/mcp/ph-feed/huntscreens + summary）
- 日志：`logs/crawl-delta-api.log`、`logs/crawl-delta-sources.log`、`logs/ingest-ph-hs.log`
- 脚本：`scripts/crawl-delta-today.ts`、`scripts/ph-delta-lb.py`、`scripts/ph-delta-lb.mjs`

## 建议
1. **建议重打安装包**，否则用户安装的仍是旧库（约 138.7 万），不含本次 +2.3 万。
2. 若要补 PH 缺口：提供 PH API token，或稍后重试榜单。
3. SaaSHub / LibHunt / AlternativeTo 等大目录浅抓被拦，不影响已有数据；深度增量可继续走 sitemap/Common Crawl 历史管道，不必阻塞发版。
