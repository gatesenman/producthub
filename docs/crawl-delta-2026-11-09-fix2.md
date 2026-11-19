# 产品库失败修复 + 增量报告（第二轮，至 2026-11-09，Asia/Shanghai）

## 总览
| 指标 | 本轮修复前 | 本轮修复后 | 变化 |
|---|---:|---:|---:|
| 产品总数 | 1,451,507 | **1,456,559** | **+5,052** |
| 相对今日首轮增量前（1,386,886） | — | — | 当日累计 **+69,673** |

- **时间（Asia/Shanghai）**：约 2026-11-09 15:22 → 15:29
- **未打包、未整库备份**（根分区可用约 **27G**）
- **工作库**：`data/crawl/producthub.db`
- **0 产品来源**：47 → **46**（CHIP Downloads 已补上）

## 本轮修了什么

### 1. Setapp（原 RSS 抓成博客，仅 157）
- **根因**：规则走 `setapp.com/rss`（博客）；应用目录在 sitemap。
- **修复**：`https://setapp.com/sitemap/sitemap.xml` 抽 `/apps/{slug}`；`SHARED_HOSTS` 加入 `setapp.com`。
- **结果**：去重应用 482 → **新产品 +482**；来源产品 157 → **639**。

### 2. CHIP Downloads（原 0）
- **根因**：旧入口 `/downloads` 几乎无列表；真实目录为 `/download/{category}/` 分页。
- **修复**：14 个软件分类分页抓取（跳过模板/文书类）；URL 写成 `chip.de/d/{uuid}` 以便目录站去重。
- **结果**：来源产品 **0 → 1,668**（全为新产品）。部分分类分页在「本页新增为 0」时提前停止，后续若要可再加深。

### 3. aiopenminds.com（浅抓 empty，存量 12,467）
- **修复**：`sitemap-tools.xml`（约 13,218 个 `/tool|en/tool`）；对来源已有品名跳过，避免与历史 null-URL 存量撞成双份。
- **结果**：新产品 **+704**；来源 12,467 → **13,171**（跳过已有名 12,508）。

### 4. 开源中国 OSCHINA（浅抓 empty，存量 68,608）
- **修复**：`sitemap-projects.xml?page=1..2`（约 69,099 URL）；同样按品名跳过已有。
- **结果**：新产品 **+136**；来源 → **68,744**（跳过 68,946）。

### 5. Tools AI Online（浅抓 empty，存量 5,883）
- **修复**：`https://www.tools-ai.online/sitemap.xml` 中 `/tools/{slug}`（约 7,149）。
- **结果**：新产品 **+1,188**；来源 → **7,071**。

### 6. WebCatalog（浅抓 empty）
- **修复**：`/en/apps` + `/en/apps/popular` 抽应用 slug；已有名跳过。
- **结果**：新产品 **+88**；来源 → **19,916**。列表页覆盖有限，无全站字母表。

### 7. 通用来源今日续补
| 来源 | 新产品 | 说明 |
|---|---:|---|
| Official MCP Registry | +779 | 续跑 80 页 latest |
| BetaList | +5 | 前 30 页 |
| Product Hunt Atom | +1 | 多分类 feed（多为更新） |
| GitHub | +1 | stars≥50 近窗（多为更新） |

### 8. 代码
- `src/server/util.ts`：`SHARED_HOSTS` 增加 `setapp.com` / `chip.de` / `aiopenminds.com` / `oschina.net` / `webcatalog.io` / `tools-ai.online`。
- `src/server/ai.ts`：`findSimilar` FTS 候选 3000→**1500**；结果行改为一次 `IN` 批量取出（减轻「类似 X」单次查询开销）。
- 脚本：`scripts/crawl-delta-fix2.ts`。

## 主要来源变化（本轮）
| seq | 来源 | 前 | 后 | 说明 |
|---:|---|---:|---:|---|
| 567 | CHIP Downloads | 0 | 1,668 | 分类分页 |
| 506 | Tools AI Online | 5,883 | 7,071 | sitemap |
| 125 | Official MCP Registry | 64,699 | 65,504 | 续跑 |
| 266 | aiopenminds.com | 12,467 | 13,171 | sitemap-tools |
| 238 | Setapp | 157 | 639 | apps sitemap |
| 215 | 开源中国 OSCHINA | 68,608 | 68,744 | 项目 sitemap 增量 |
| 58 | WebCatalog | 19,828 | 19,916 | 列表页 |

## 仍失败 / 暂不可修（及原因）

### 需官方 API / 登录
| 来源 | 原因 |
|---|---|
| Reddit 各子版 (165–172) | 网络级 403，需官方 API + OAuth |
| IT桔子 | HTTP 412 / 反爬，需登录 |
| Forinov | 登录墙 |

### Cloudflare / Vercel 长期拦
| 来源 | 原因 |
|---|---|
| SourceForge / Trustpilot / SelectHub / SpotSaaS / Startup Buffer / Saaspo | CF 403 |
| SaaSHub / LibHunt / AlternativeTo / Capterra / Software Advice / Awesome Indie | CF Just a moment；已有大量存量 |
| NoCode.Tech / Tools.so / EveryDev.ai | Vercel Checkpoint / 429 / 超时 |
| F6S | 浏览器挑战页 |
| EU-Startups | RSS/主站均 CF 403 |
| Thingtesting 主站 | CF 403；sitemap 偏消费品牌 |

### 按规则跳过（非产品目录）
| 来源 | 原因 |
|---|---|
| e27 / YourStory / GeekWire / 极客公园 | RSS 可通，但是新闻站 |
| DEV / Hashnode / Sidebar / Starter Story / PR TIMES / EnGadget 等 | 社区/故事/公关/新闻 |
| 即刻 / 酷安 / 产品沉思录 / FWOL / 36氪 / 虎嗅 等 | 空页或非稳定产品列表 |
| Product Hunt 日榜 HTML | CF；继续用分类 Atom |

## 磁盘与产物
- 可用约 **27G**；已删 `data/delta/fix2-tmp`；未动 `release/`。
- 摘要：`data/delta/fix2-summary.json`
- 日志：`logs/crawl-delta-fix2.log`
- 报告：`docs/crawl-delta-2026-11-09-fix2.md`

## 建议（未执行）
1. 用户要求先不打包 → **未打安装包**。
2. CHIP 部分分类分页可再加深（本轮约 1.7k，官网分类页数更多）。
3. WebCatalog 若有全量目录 API/sitemap，可再补一轮。
4. 硬 CF 站点若要增量，需浏览器过挑战或 Common Crawl，磁盘紧时不建议硬刚。
