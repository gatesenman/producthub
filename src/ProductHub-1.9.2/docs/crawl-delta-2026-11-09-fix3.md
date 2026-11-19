# 产品库失败修复 + 软件侧修透报告（第三轮，至 2026-11-09，Asia/Shanghai）

## 总览
| 指标 | 本轮修复前 | 本轮修复后 | 变化 |
|---|---:|---:|---:|
| 产品总数 | 1,456,559 | **1,493,371** | **+36,812** |
| 相对今日首轮增量前（1,386,886） | — | — | 当日累计 **+106,485** |
| 0 产品来源 | 46 | **40** | **-6** |

- **时间（Asia/Shanghai）**：约 2026-11-09 15:40 → 15:59
- **未打包、未整库备份、未传电脑**（根分区可用约 **27G**）
- **工作库**：`data/crawl/producthub.db`

## 本轮修了什么（来源）

### 1. e27（原 0 → 38,796）★ 最大修复
- **根因**：旧规则打主站/新闻；公开 JSON API 一直可用。
- **入口**：`https://e27.co/api/startups?page=&length=100`（`totalstartupcount≈38813`）。
- **修复**：全部分页入库；官网优先 `metas.website`，否则用 e27 startup 页。
- **结果**：去重约 38,802 → **新产品 +38,796**；来源 `product_count=38796`，`last_status=ok`。

### 2. Reddit 各子版（原网络 403）
- **根因**：`reddit.com` / `old.reddit.com` 本环境 HTTP 403；官方 API 需 OAuth。
- **入口**：第三方公开归档 `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=…&sort=desc`。
- **修复**：链出帖入库；过滤 reddit/imgur/youtube 等宿主；标题解析 + 主机名回退命名。
- **结果**（修复文件名哈希碰撞后重跑）：
  | 来源 | 产品数 |
  |---|---:|
  | r/SideProject | 84 |
  | r/IMadeThis | 35 |
  | r/SaaS | 6 |
  | r/startups | 1 |
  | r/alphaandbetausers / indiehackers / microsaas / EntrepreneurRideAlong | 仍 0（Arctic 该板近期几乎无链出帖/空） |

### 3. YourStory（原 CF 403 → 63）
- **根因**：曾被拦；现主站 `/companies` HTML 可抓到公司 slug（搜索页偏 CSR 空壳）。
- **结果**：公司页 **63** 条入库；`last_status=ok`。

### 4. CHIP Downloads 加深
- 分类已抓尽本环境可见分页；**本轮无新增**（存量 1,668 保持）。

### 5. 通用来源续补
| 来源 | 新产品 | 说明 |
|---|---:|---|
| GitHub stars≥50 近窗 | +154 | search API |
| Product Hunt 分类 Atom | +8 | 多为更新 |
| BetaList | +0 | 列表选择器几乎无命中 |

### 6. 数据质量
- 删除名称 `Alternatives to …` 清单页及无 URL 噪声名（Home/About/Privacy…）：**删除 2,313**。
- 检索侧：`isGenericProductName` 加强匹配 `Alternatives to …`。
- 库内 `Alternatives to %` 剩余：**0**。

## 软件侧改动（已落地，未打包）

| 问题 | 改动 | 大库实测（≈149 万） |
|---|---|---|
| 分类浏览缺复合索引 | `idx_products_cat_updated (category, updated_at DESC)` 写入 schema + 已建 | 分类页 **~14 ms**（原 0.4–1.7 s） |
| 「类似 X」2–3 s | FTS 候选 1500→**900**；simMatrix 不读 description；qNorm 外提；**60s 结果缓存** | findSimilar(Notion) cold **~407–663 ms**，warm **0 ms** |
| analytics 首次慢 | 标签改为高票抽样；来源榜改读 `sources.product_count`；`ai_summary` 全表计数改为抽样估计 | libraryAnalytics cold **~2.1 s**（原常 8–15 s），warm **0–1 ms** |
| 增量更新下载 | （上轮已落地，本轮未改）设置页 URL/本地包合并 | — |

涉及文件：
- `src/server/db.ts`（复合索引）
- `src/server/ai.ts`（findSimilar / libraryAnalytics）
- `src/server/util.ts`（SHARED_HOSTS + e27/yourstory）
- `src/server/search/text.ts`（Alternatives to 名过滤）
- `scripts/crawl-delta-fix3.ts` / `scripts/create-cat-idx.ts` / `scripts/perf-fix3.ts`

## 仍失败 / 真正死结（附本轮证据）

以下均在本轮用 **直连 + sitemap/API 变体 + Wayback CDX（短超时）** 再验；**能合法公开拿到产品列表的已修**；剩余确认无法在本环境稳定获取。

### A. Cloudflare / 挑战页 / 连接失败（无法公开列表）
| 来源 | 证据（摘要） |
|---|---|
| Tools.so | `tools.so` / `www.tools.so` / sitemap → HTTP **0**（连不上）；Wayback CDX 同超时 |
| NoCode.Tech | 主站/sitemap → **429** Vercel Checkpoint HTML |
| SourceForge | directory / rest / sitemap → **403**「Just a moment…」 |
| SelectHub / SpotSaaS / Startup Buffer / Saaspo / EU-Startups | 主站/sitemap/RSS → **403** CF |
| Trustpilot software 类目 | **403**「Verifying Connection」 |
| SaaSHub / AlternativeTo | 主站/sitemap → **403** Just a moment（**已有大量存量，增量仍不可**） |
| F6S | `/companies` → 200 但是「Checking your browser」挑战页；sitemap → 400 |
| IT桔子 | `itjuzi.com` / `m.itjuzi.com` → **412** 反爬 |

### B. 可访问但非软件产品目录（按规则不入库）
| 来源 | 证据 |
|---|---|
| Thingtesting | 200 + sitemap/brands 可开；内容为 **消费品牌**（Owala/Chewy…），非软件库重点 |
| GeekWire Startup List | feed 200；startup-list 无稳定产品目录 → **新闻站** |
| DEV / Hashnode / Sidebar / Starter Story / 少数派 / 爱范儿 / EnGadget / PR TIMES / Inc42 / vc.ru / 鸟哥笔记 / 思否 / 人人都是产品经理 等 | `last_status=ok` 但 **product_count=0**：规则判定为社区/新闻/故事，浅抓不入库文章 |

### C. 空页 / 站点不可用
| 来源 | 证据 |
|---|---|
| 即刻 / 酷安 / 产品沉思录 / 36氪 / 虎嗅 / FWOL | empty / fetch failed / 无稳定公开产品列表 |
| 极客公园 | 仍 403 |
| Reddit 4 板（alphaandbetausers / indiehackers / microsaas / EntrepreneurRideAlong） | Arctic 公开归档 **page1 即空或无链出帖**；官方 Reddit 仍 403 |

### D. 已绕过但仍有缺口
| 项 | 说明 |
|---|---|
| Product Hunt 日榜 HTML | 仍 CF；继续用分类 Atom |
| Common Crawl CDX | 本轮查询 **504/超时**，未作为可靠增量通道 |
| CHIP | 本环境可见分页已吃满；官网更深页未再吐新 UUID |

## 磁盘与产物
- 可用约 **27G**；已清 `data/delta/fix3-tmp`；未动 `release/`。
- 摘要：`data/delta/fix3-summary.json`（主跑；Reddit 重跑另计入库）
- 日志：`logs/crawl-delta-fix3.log`、`logs/crawl-delta-fix3-reddit.stdout`、`logs/perf-fix3b.log`
- 报告：`docs/crawl-delta-2026-11-09-fix3.md`

## 建议（未执行）
1. 用户要求先不打包 → **未打安装包**；装上后才会带新库 + 性能/增量更新代码。
2. Reddit 空板若要坚持，需官方 API token（用户自备）或浏览器过挑战后的会话（本任务不采用）。
3. SaaSHub/AlternativeTo 等大目录增量仍依赖过 CF 或历史快照；磁盘紧时不建议硬刚 Common Crawl 大包。
