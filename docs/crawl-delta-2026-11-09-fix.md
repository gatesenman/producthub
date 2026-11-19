# 产品库失败修复 + 增量报告（至 2026-11-09，Asia/Shanghai）

## 总览
| 指标 | 本轮修复前 | 本轮修复后 | 变化 |
|---|---:|---:|---:|
| 产品总数 | 1,409,942 | **1,451,507** | **+41,565** |
| 相对今日首轮增量前（1,386,886） | — | — | 当日累计 **+64,621** |

- **时间（Asia/Shanghai）**：约 2026-11-09 11:02 → 11:26
- **未打包、未整库备份**（磁盘约 28G 可用）
- **工作库**：`data/crawl/producthub.db`

## 本轮修了什么

### 1. Product Hunt（缺口 10-21～今天）
- 日榜 Cloudflare 仍挡；改用 **多分类 Atom** `https://www.producthunt.com/feed?category=…`（约 30 个分类）。
- 去重后约 1,176 条；**新产品 +263**；来源产品数 336,468 → **336,731**。
- 覆盖日期已含 10-21～11-07 一带；日榜页本身仍属「暂不可修」。

### 2. Startup Ranking（原 0 产品）
- **根因**：选择器失效（旧规则对不上 `a.rnk-name`）；Node `fetch` 易 403，**curl 可通**。
- **修复**：按 `top` / `top/{n}`（60 页）+ `/startup/new` + 多国榜抓取；规则改为 `a.rnk-name`。
- **去重 bug**：目录站 URL 被压成 `host:startupranking.com` 同一 GUID → 已把 `startupranking.com` 等加入 `SHARED_HOSTS`，按 path 去重后重导入。
- **结果**：来源产品 **0 → 6,083**（本轮新产品约 +6,083）。

### 3. HuntScreens
- 用 EN sitemap `https://huntscreens.com/sitemaps/en`（约 26,204 产品 URL）。
- 同样修了目录站去重后重导入；来源产品 23,670 → **49,872**（含与历史条目可能的近重，全局产品净增主要来自新 GUID）。

### 4. OpenFuture AI（浅抓曾 403）
- 首页/分类 curl 可访问；sitemap_tool.xml 多次超时放弃。
- 抓 212 个 `/ai-tools/*` 分类页上的 `/tool/`；规则已更新。
- 来源产品 16,193 → **16,907**（+714）。

### 5. Ecomm Design（浅抓 403）
- 改 **WP REST**：`/wp-json/wp/v2/{website,tool,app}`。
- 入库约 4,715 行；**新产品 +3,739**；来源产品 4,618 → **8,532**。

### 6. MCP Registry
- 页上限提高到跑完；**598 页全部 latest**；来源产品 61,000 → **64,699**（本轮脚本内约 +3,505 新产品）。

### 7. GitHub / BetaList / 通用来源
- GitHub `stars≥100 created:2026-10-01..今天`：约 +762 新产品。
- BetaList 60 页：约 +293 新产品。
- 35 个高价值通用来源浅抓：多为更新，少量新（如 Uneed +3）。

### 8. 代码修复
- `src/server/util.ts`：`SHARED_HOSTS` 增加 `startupranking.com` / `openfuture.ai` / `huntscreens.com` / `saashub.com` / `alternativeto.net` / `betalist.com` / `libhunt.com` / `g2.com` / `capterra.com` / `ecomm.design` 等，避免目录站 path 被压成单产品。
- 脚本：`scripts/crawl-delta-fix.ts`（API/Atom/通用）+ curl 管道 JSON + `ingest-json.ts`。

## 主要来源变化（本轮）
| seq | 来源 | 前 | 后 | 说明 |
|---:|---|---:|---:|---|
| 366 | HuntScreens.com | 23,670 | 49,872 | sitemap + 去重修复 |
| 125 | Official MCP Registry | 61,000 | 64,699 | 拉完全量 latest |
| 131 | Startup Ranking | 0 | 6,083 | 选择器+curl+去重 |
| 339 | Ecomm Design | 4,618 | 8,532 | WP REST |
| 1 | Product Hunt | 336,468 | 336,731 | 多分类 Atom |
| 211 | GitHub | 22,210 | 22,990 | stars≥100 窗口 |
| 2 | BetaList | 28,228 | 28,558 | 60 页 |
| 411 | OpenFuture AI | 16,193 | 16,907 | 分类页 |

## 仍失败 / 暂不可修（及原因）

### 需官方 API / 网络封锁
| 来源 | 原因 |
|---|---|
| Reddit 各子版 (165–172) | Reddit 网络级 403，需官方 API + OAuth |
| IT桔子 | HTTP 412 / 反爬，需登录 |

### Cloudflare / Vercel 长期拦（含 sitemap）
| 来源 | 原因 |
|---|---|
| SourceForge / Trustpilot / SelectHub / SpotSaaS / Startup Buffer / Saaspo | CF 403 |
| SaaSHub / LibHunt / AlternativeTo / Capterra / Software Advice / SoftwareWorld / Serchen / Awesome Indie | CF Just a moment；sitemap 同挡；**已有大量存量，增量暂不可** |
| NoCode.Tech / Tools.so / EveryDev.ai | Vercel Security Checkpoint / 429 |
| F6S | 浏览器挑战页 |
| Thingtesting 主站 | CF 403；sitemap 有但偏消费品牌，非软件产品库重点 |
| YourStory / GeekWire / 极客公园 / EU-Startups / e27 | 403 |

### 空页 / 非产品列表 / 按规则跳过
| 来源 | 原因 |
|---|---|
| 即刻 / 酷安 / 产品沉思录 / 36氪 / FWOL | empty / fetch failed / 非稳定产品列表 |
| DEV / Hashnode / 思否 / 少数派 / 爱范儿 / TechNode / Pandaily / Sidebar / Starter Story 等 | **新闻/社区/故事站**，本轮按规则不入库文章 |
| Product Hunt 日榜 HTML | CF；已用 Atom 分类补近月 |

### 浅抓 empty 但已有存量（非真实失败）
WebCatalog / OSCHINA / aiopenminds / Tools AI Online / Forinov 等：本轮列表页空或超时，**product_count 仍很大**，不计入「0 产品失败」。

## 磁盘
- 修复过程中可用约 **28G**（根分区 ~101G/128G，79%）。
- 已删临时 sitemap 与大 delta（mcp/github/hs 全量 JSON）；未动 `release/`。

## 产物
- 库：`data/crawl/producthub.db`
- 日志：`logs/crawl-delta-fix.log`、`logs/ingest-curl-fix*.log`
- 摘要：`data/delta/fix-summary.json`、`data/delta/fix-ph.json`、`fix-*-curl.json`（部分）
- 脚本：`scripts/crawl-delta-fix.ts`

## 建议（未执行）
1. 用户说先不打包 → **未打安装包**；装包仍是旧库时需另开打包任务。
2. HuntScreens 新旧 GUID 可能有近重，后续可跑一轮「同名+同官网」合并。
3. SaaSHub 等大目录若要增量，需浏览器过 CF 或历史 Common Crawl，不适合在磁盘紧时硬刚。
