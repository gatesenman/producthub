# 统一产品库 v1.7.0 抓取报告（2026-10-21）

## 总量
- 产品总数：**607,639**（v1.6 发布时 496,413；本轮继续前 604,354）
- Product Hunt（seq 1）：**336,917**

## 本轮（v1.7）各来源新增 / 合并
| 来源 | 方式 | 新增 | 合并入已有 |
|---|---|---|---|
| Product Hunt | leaderboard 全量回溯（4,714 天） | 5,846 | 55,488 |
| AIbase | Common Crawl 索引 | 1,796 | 0 |
| Software Advice | Common Crawl 索引 | 900 | 3,510 |
| Findstack | Common Crawl 索引 | 286 | 2,088 |
| TrustRadius | Common Crawl 索引 | 68 | 58 |
| Capterra | Common Crawl 索引 | 0 | 8,401 |
| G2 | Common Crawl 索引 | 0 | 5 |
| WebCatalog | 详情页描述（20k） | 782 | 19,217 |
| SaaSworthy | 详情页描述（20k） | 2,257 | 17,743 |
| Serchen | 详情页描述（20k） | 405 | 19,593 |

（此前 v1.6 continue 阶段：MCP Registry +37,974、WebCatalog +17,467、SaaSworthy +16,961、Serchen +16,096、SoftwareWorld +14,340、Capterra(CC) +3,088 等，详见 crawl-continue-v16.md）

## 去重
按目录详情链接（同一来源内）合并：SaaSworthy −7,096、Serchen −956、WebCatalog −1,003，合计 −9,055；抽样核对均为同一详情页。
修正 983 个带 “Features, Reviews & Pricing” 后缀的名称。
注意：不按“首个 URL”去重（会误合并共享仓库/主机的 MCP 服务器）。

## 仍失败 / 跳过
SourceForge、SelectHub、SpotSaaS、Thingtesting、Startup Buffer、NoCode.Tech、Trustpilot、F6S、Saaspo、Tools.so（CC 无有效数据或被拦截）；即刻、酷安、产品沉思录、IT桔子、FWOL；Reddit（需官方 API）；Owler/GetLatka/Glama 按要求跳过。PH leaderboard 有 24 天失败（ph/lb-errors.log）。

## 备份
- data/backups/producthub-pre-v17-20261021.db（导入前）
- data/backups/producthub-pre-dedupe-v17.db（去重前）
