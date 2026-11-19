# v1.6 续抓进度（2026-10-21）

## 结果
| 指标 | 冻结版 v1.6 | 现在 | 变化 |
|---|---|---|---|
| 产品 | 496,413 | 604,354 | +107,941 |
| Product Hunt 产品 | 330,369 | 331,362 | +993 |
| PH 公开 slug（sitemap+CDX+榜单合并） | 356,276 | 354,858* | 榜单补全 2,529/4,715 天 |

*重新合并时，用榜单的 post→product 别名把重复项归并了，所以去重后数量略少；有 993 个 slug 是首次出现。

## 本次修复的来源（之前失败，现在有数据）
| 来源 | 方式 | 新增产品 | 归并到已有 |
|---|---|---|---|
| Official MCP Registry | 官方 API v0/servers（latest） | 37,974 | 9,581 |
| WebCatalog | sitemap（en/apps，上限 2 万）+ 详情 6k | 17,467 | 2,532 |
| SaaSworthy | product sitemap（上限 2 万）+ 详情 6k | 16,961 (+780†) | 3,039 |
| Serchen | companies-a..c sitemap（上限 2 万）+ 详情 6k | 16,096 (+61) | 3,904 |
| SoftwareWorld | software-profile sitemap（上限 2 万，详情页有 CF，只有名称） | 14,340 | 5,660 |
| Capterra | Common Crawl 索引（7 个 crawl） | 3,088 | 5,313 |
| Software Advice | Common Crawl 索引（2 个 crawl） | 179 | 682 |
| G2 | Common Crawl 索引（G2 屏蔽 CCBot，只有 5 条 URL） | 2 | 3 |

†补充详情时，详情页名称与 slug 名称不一致，产生少量重复记录。

## 仍失败的来源
- Cloudflare / 403（Common Crawl 索引还在跑，Wayback 当前从本机 TLS 握手失败，rc=35）：Findstack、SourceForge、TrustRadius、SelectHub、SpotSaaS、Thingtesting、Startup Buffer、Saaspo、F6S、Tools.so、NoCode.Tech（429）
- JS 渲染 / 需要登录，没有可用入口：即刻、酷安、产品沉思录、AIbase、IT桔子（412）、FWOL（连接失败）、Trustpilot（企业评价站，正在用 CC 拿 /review/域名）
- Reddit 8 个子版块：跳过，需要官方 API 凭证
- Owler / GetLatka / Glama：按要求不再占用抓取额度

## Product Hunt
- 本次 sitemaps_v3 只有 posts_sitemap 0–4 还在（52,624 个 slug），与已有集合相比 0 个新 slug；products_* 系列已下线。
- 榜单（leaderboard）恢复 200：单线程、2.5 秒间隔、遇 429 退避，从最新日期往前抓（`/workspace/ph/lb2.py`，可断点续跑），已完成 2,529/4,715 天。
- CDX 没有重扫：Wayback 当前不可达；上次 CDX 共 261,163 个 slug。
- 没有 API 时，PH 最多还能补约 2 万（榜单剩余天数），其余约 5 万需要 API token。

## 建议
1. 等后台任务跑完再合并一次：`lb2.py`（PH 榜单）、`/workspace/extra/cc.py`（CC 索引，其余来源）、`dirharvest.py`（目录详情）。然后执行 `python3 /workspace/ph/merge.py`，再用 `scripts/ingest-json.ts` 导入。
2. PH 要接近完整，需要 API token（GraphQL v2，按日期范围分页）。这比继续爬公开页面划算。
3. 产品数已比冻结版多约 10.8 万，安装包需要重新打包才能包含这些数据（本次未打包）。
4. 新导入的 sitemap/CC 记录大多只有名称和来源链接，可以之后跑一次 enrich 补全简介。

备份：`data/backups/producthub-pre-continue-20261021.db`（续抓前）

## v1.7 收尾
见 docs/crawl-report-v17.md（最终 607,639 产品，PH 336,917）。
