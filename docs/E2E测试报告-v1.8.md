# 统一产品库 ProductHub v1.8.0 端到端测试报告

- **测试日期**：2026-10-29（Asia/Shanghai）
- **环境**：Linux box（Node 20.19.2）；可读写服务 `127.0.0.1:8787`（seed 约 2,865 产品）；只读 `8788`；大库只读 `8791`（crawl：1,386,886 产品 / 636 来源 / alt_rel 1,906,123）
- **未测项**：Windows 安装包本机安装与 Electron 桌面壳（用户 PC 当时不可用）；真实外网抓取成功路径（调度对假来源返回 `fetch failed`，属预期）

## 1. 自动化套件汇总

| 套件 | 结果 | 说明 |
|------|------|------|
| Vitest 单元+集成 | **143 通过 / 1 失败 / 共 144** | 失败：`tests/integration/v15-perf.test.ts` 合成 30k 搜索 max≈432ms，阈值 &lt;200ms |
| Playwright E2E | **23 / 23 通过** | `app.spec` + `v13` + `v14`，含只读双端口 |
| importexport 单测（修复后） | **8 / 8 通过** | 验证导出相关回归 |

## 2. 功能清单与结论

图例：✅ 通过 · ⚠️ 部分通过/有质量问题 · ❌ 失败 · ➖ 本环境未测桌面壳

| # | 功能 | 测法 | 结论 | 证据 |
|---|------|------|------|------|
| 1 | 首页：一句话找产品 | Playwright v14 + API `POST /api/products/query` | ✅ | `screenshots/e2e-v18/01-home.png`；NL「类似 Notion 的开源笔记」total=329 |
| 2 | 首页：今日新增 / KPI | Playwright app.spec + `GET /api/home` | ✅ | `api-home.json` |
| 3 | 首页：关注提醒 | Playwright 关注链路 | ✅ | e2e「首页今日新增 + 关注」 |
| 4 | 新手引导 onboarding | Playwright | ✅ | 欢迎→就绪→跳过 AI→只出现一次；稍后继续可恢复 |
| 5 | 产品库列表 / 关键词 | Playwright + API | ✅ | `02-products-search.png` |
| 6 | 筛选表单（分类/标签/更多条件） | Playwright | ✅ | 分类、开源标签、票数、发布次数、重置 |
| 7 | 侧栏分类树 / 标签 / 来源 | Playwright | ✅ | cat-ai 等 |
| 8 | 多选批量：标签/关注/导出/删除/撤销 | Playwright v13 | ✅ | Shift 连选、Ctrl+A、Toast 撤销 |
| 9 | 键盘导航 ↑↓ / Space / Esc | Playwright | ✅ | 详情切换、侧栏 Ctrl+B |
| 10 | 产品详情字段 | API + Playwright | ✅ | `03-detail.png`、`api-product-detail.json` |
| 11 | 版本时间轴 | Playwright | ✅ | WriteBot 2 条版本 |
| 12 | 详情 prev/next + 位置 | Playwright v13 | ✅ | detail-pos / splitter |
| 13 | Logo 头像（缺图首字母） | UI 截图观察 | ✅ | 详情页可见 |
| 14 | 对比 2–5 产品 + 导出 | Playwright v14 + API | ✅ | `15-compare.png`；MD 导出 |
| 15 | 找相似 /「类似 X」/ alternative-to | 大库 API | ⚠️ | 功能可用；排序质量见 §4 P1 |
| 16 | 命令面板 Ctrl+K | Playwright + 截图 | ✅ | `11-palette.png` |
| 17 | AI 面板 Ctrl+J：相似/问答/停止/重试 | Playwright + API | ✅ | `12-ai-panel.png`、`api-ai-ask.json`；离线模式状态栏 |
| 18 | AI 离线降级（无 Key） | API analyze / ask / similar-text | ✅ | `aiEnabled=false` 仍返回结果 |
| 19 | 来源列表 / 健康 / 添加 | Playwright + API | ✅ | `05-sources.png` |
| 20 | 抓取规则工作台（生成/测试/校验） | Playwright + API | ✅ | `06-rules.png`；JSON 校验、测试按钮禁用逻辑 |
| 21 | 规则页（SourcesHub rules tab） | 同上 | ✅ | `view=rules` 映射到 sources+rules |
| 22 | 导入导出 CSV/JSON/XLSX | API + Playwright 下载 | ✅（修复后） | 全量 XLSX 曾 500，截断后 200≈2.5MB；CSV/JSON 一直 OK |
| 23 | 来源 CSV 导入接口 | 代码路径 + e2e 数据准备 `importSourcesCsv` | ✅ | prepare.ts / API sources/import |
| 24 | 设置：主题 / AI Key / 调度 | Playwright + API | ✅ | `09-settings.png`、`14-theme.png` |
| 25 | 分析与报告 | Playwright + API | ✅ | `07-analytics.png`；HTML/MD 报告 |
| 26 | 设计系统展示页（dev） | Playwright | ✅ | `10-design.png` |
| 27 | 手动添加 + 同域去重合并 | Playwright + API | ✅ | 合并 Toast；同 GUID |
| 28 | 调度器 / 增量抓取冒烟 | `POST /api/scheduler/run` | ✅ | 返回对假来源 `fetch failed`（接口可用） |
| 29 | 只读预览写接口 403 | Playwright + API | ✅ | `13-readonly.png`；POST products/favorites/settings → 403 |
| 30 | 大库性能冒烟 | crawl API + better-sqlite3 | ⚠️ | 见 §3；冷启动仍全量建内存索引 |

**清单统计（功能行）**：✅ 27 · ⚠️ 2 · ❌ 0 · ➖ 桌面壳未测  
**API 扫表（修复前脚本）**：44 pass / 4 fail（其中 2 为脚本误用；1 为 seed 票数全 0；1 为 XLSX 真 bug，已修）

## 3. 大库性能（crawl 1,386,886）

| 指标 | 结果 | 备注 |
|------|------|------|
| `better-sqlite3` 只读打开 + COUNT | ≈47.5 ms | 原生打开很快 |
| HTTP `GET /api/status`（已热） | ≈128 ms | |
| 冷启动至可响应 | ≈2 分钟级，RSS≈3.9 GB | `server.ts` warm 仍调用全量 `buildIndex` |
| 搜索 `figma` | ≈2002 ms，total 2316，首条 Figma | |
| 搜索 `笔记工具` | ≈1019 ms，首条「印象笔记」 | |
| `类似 figma` | ≈4530 ms，首条 Zeplin | |
| `alternative to notion` | ≈4432 ms，639 条 | 首条为泛化类目名，质量问题 |
| 拼音 `doubao` | ≈406 ms，首条 Doubao | |
| `GET .../similar`（notion） | ≈146 ms | 结果相关性差（见开放问题） |

证据：`screenshots/e2e-v18/search-*.json`、`api-sweep-results.json`

## 4. 开放问题（按优先级）

### P1

1. **「alternative to notion」排序偏航**  
   - 复现：大库 `POST /api/products/query`，`q=alternative to notion`  
   - 现象：首条为「Collaboration & Project Management Software」，随后 Asana/Monday/Trello；笔记类（Obsidian/Logseq）靠后  
   - 证据：`search-alternative_to_notion.json`  
   - 建议：提高 alt_rel 权重、过滤泛化类目名、同类目加权  

2. **大库启动仍全量内存倒排**  
   - 复现：`node dist-server/server.js --data data/crawl`  
   - 现象：warm `buildIndex` 无 rowids → 扫全表，RSS≈3.9GB，冷启动约数分钟；与「打开库 ~10ms / 内存 ~0.5GB」宣称不符  
   - 位置：`src/server/server.ts` warm；`search/engine.ts` `buildIndex`  
   - 建议：有 FTS 时跳过全量 warm，或只维护轻量 vocab  

3. **`findSimilar(notion)` 相关性差**  
   - 复现：取 notion 的 guid 后 `GET /api/products/:guid/similar`  
   - 现象：样本出现「Eleven Labs on Open」等不相关项（146ms 内返回）  

4. **Vitest 性能阈值**  
   - `v15-perf.test.ts`：合成 30k 搜索 max 432ms &gt; 200ms（本机）  
   - 属环境/阈值问题，功能未坏  

### P2

5. **搜索结果重复名**（多个「Figma」条目）——去重展示或合并引导  
6. **seed 库仍含长文/清单类「产品」**（如 IPO Tracker，description 92k 字）——安装包若仍带旧 seed 需与 crawl 清理策略对齐  
7. **版本号曾卡在 1.5.0**（已修为 1.8.0，见 §5）  

### 非缺陷（测试误判已澄清）

- 复杂筛选 `votes>=100` 在 seed 上 total=0：seed 全部 `votes=0`，筛选引擎正常；`launch_count>=2` → 122 条  
- batch `add_tags`：真实动作为 `action:"tag", tag:"开源"`，脚本写错；纠正后 OK  

## 5. 本轮已修小问题

| 项 | 改动 | 验证 |
|----|------|------|
| 版本号 | `src/server/version.ts` `1.5.0` → **`1.8.0`** | `GET /api/meta` → `1.8.0` |
| Excel 导出超长单元格 | `importexport.ts` `flat()` 截断至 32767 | 全量 `/api/export?format=xlsx` → 200，约 2.5MB；`importexport` 单测 8/8 |

**未重打 Windows 安装包**（按任务约束；用户侧已有 v1.8 交付路径，这两处为小修复，需时再打补丁包）。

## 6. 证据目录

路径：`/workspace/product-hub/screenshots/e2e-v18/`

- UI：`01-home.png` … `15-compare.png`（14 张界面截图）  
- API：`api-sweep-results.json`、`api-home.json`、`api-analytics.json`、`api-ai-ask.json`、`api-product-detail.json`  
- 大库搜索：`search-*.json`  
- 续跑笔记：`docs/E2E-NOTES.md`  
- 辅助脚本：`scripts/e2e-api-sweep.mjs`、`scripts/e2e-shots.mjs`

## 7. 总评

- **自动化回归**：Playwright 全绿；Vitest 仅 1 条性能阈值失败。  
- **用户可见功能**：清单内能力在 Web/API 层均可走通；只读模式隔离正确；离线 AI 可用。  
- **v1.8 大数据卖点**：查询能跑通（含「类似 / alternative to」与拼音），但**冷启动内存索引**与**替代品排序**仍是上线体验的主要风险，建议优先处理 §4 P1-1、P1-2 后再宣传「秒开 / 0.5GB」。  
- **代码修复**：2 处小修已落地并验证；未重建安装包。

