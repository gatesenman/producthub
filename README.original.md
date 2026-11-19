# 统一产品库（Product Hub）

跨平台桌面应用：自动监控 240+ 产品发布/导航网站，抓取新产品入库，去重合并、版本记录、AI 总结与多维分析、相似产品检索、复杂筛选、导入导出，并提供只读的内部预览网站。

- 技术栈：**Electron 33 + React 18 + TypeScript + SQLite（sql.js / WebAssembly，无原生依赖，三端一致）**
- 作者 / 使用者：GAOSICHUN · 界面语言：简体中文 · 当前版本 **v1.4.0**（[更新日志](CHANGELOG.md) · [使用手册](docs/使用手册.md) · [设计系统](docs/设计系统.md)）

## 3 步快速开始

1. **下载安装**：Windows 双击 `ProductHub-Setup-1.4.0-win-x64.exe`（一键安装，自动创建桌面快捷方式并启动；不想安装可用 `-portable.exe`）；Linux 运行 `chmod +x ProductHub-1.4.0-linux-x86_64.AppImage && ./ProductHub-1.4.0-linux-x86_64.AppImage`。
2. **跟着引导走 3 步**：首次启动出现欢迎引导 → 预置数据（2,865 个产品、241 个来源）已自动加载 → AI Key 可选，留空直接「暂不配置」。
3. **开始使用**：在首页大搜索框用一句话描述要找的产品（如「帮团队做会议纪要的AI工具，支持中文」），结果按相关度排序并解释为什么匹配，本地不够时自动联网搜索；勾选 2–5 个产品可并排对比。首页还能看「今日新增」和来源健康；`Ctrl/⌘+K` 搜产品或「找 X 的竞品」；在产品上点 ☆ 关注，它再次发布时首页会提醒。

> 从源码运行：`npm install && npm run app`（构建并启动桌面版）；内部预览网站：`npm run build && npm run preview`。

---

## 1. 功能对照表

| # | 需求 | 实现 |
|---|------|------|
| 1 | 跨端桌面程序 | Electron，Linux（AppImage / tar.gz）、Windows（NSIS 安装包 / 便携版）、macOS（dmg / zip，x64 + arm64） |
| 2 | 定期增量更新 | 内置调度器每分钟检查到期来源（每个来源可设：每小时 / 6h / 12h / 每天 / 每周），每批 N 个；内容哈希比对，只记录新增/变化；失败来源 3 倍退避 |
| 3 | 历史数据预缓存 | `data/seed/producthub.db` + `data/seed/images/` 随安装包分发，首次启动复制到用户数据目录（真实抓取 240 个来源得到的数据） |
| 4 | 软件风格 UI | shadcn/ui 设计系统：无边框窗口 + 自绘标题栏、分组侧栏（工作台/分类/标签/来源/管理）、首页、可调宽详情分栏、状态栏、命令面板、浅/深色 |
| 5 | 产品信息完整 | GUID、名称、官网、域名、一句话简介、详细描述、分类、标签、平台、定价、开发者、国家/地区、发布日期、首次收录、最近出现、票数、发布次数、Logo（本地缓存）、AI 总结、AI 多维分析、来源方式、备注 |
| 6 | 标准分类 / 标签 | 23 个两级分类（AI → 写作/图像视频/智能体，开发者工具 → 无代码…）+ 5 组标签（商业模式、平台、目标用户、阶段、技术），关键词自动归类与打标 |
| 7 | 版本记录 | `product_versions` 表：同一产品在不同网站 / 不同时间的每次发布都保留快照、票数、链接，详情页时间轴展示 |
| 8 | 内部预览网站 | 同一套 UI 的 Web 版，`--readonly` 只读模式（写接口返回 403，隐藏编辑入口） |
| 9 | AI 自动总结 / 多维分析 | 总结 + 6 维评分（创新度、市场潜力、成熟度、热度、壁垒、变现）+ 目标用户、商业模式、核心功能、竞品；雷达图展示；全库统计看板 |
| 10 | AI 右侧滑出面板 | `Ctrl/⌘+J` 或右上角按钮；展示当前产品的相似产品（向量相似度 + 分类 + 标签加权）并支持自然语言检索问答 |
| 11 | 导入导出 | CSV（UTF-8 BOM，Excel 可直接打开）/ Excel xlsx / JSON（含版本记录）；导出可带当前筛选；导入支持中英文列名、自动去重；来源 CSV 导入 |
| 12 | 复杂筛选 | 普通表单查询（关键词/分类/标签/来源 + 更多条件：地区、商业模式、日期范围、票数、发布次数、收录方式、AI 总结、首次收录、关注）；后端保留 AND/OR/NOT 条件树引擎，API 可直接传入 |
| 13 | 端到端交付 | 源码 + 测试 + Linux 构建产物 + Win/mac 构建命令 + 截图 + 本文档 |
| 14 | 自定义监控 / 规则定义 | 任意网址添加为监控来源；规则模式 auto / rss / html / jsonld / json；“抓取规则工作台”可 **AI 生成规则** → 编辑 JSON → 测试预览 → 保存到来源 |
| 15 | 测试 / 图片缓存 | 单元 + 集成 66 个用例、Playwright E2E 10 个场景；图片按 URL SHA-1 缓存在本地 `images/`，离线可显示 |
| 16 | 手动添加 | “＋ 添加产品”表单，支持分类与标签选择；与已有产品官网相同时自动合并为新版本 |
| 17 | 去重 / GUID | 来源与产品都使用 **UUIDv5** 稳定 GUID：产品按“规范化官网域名”（去 www、去 utm/ref 跟踪参数；GitHub/App Store 等共享域名按路径）生成，没有官网时按名称；另有“同名不同域名”疑似重复列表可一键合并 |

## 2. 快速开始

```bash
npm install
npm start                 # 构建并启动桌面版
```

开发模式（热更新）：`npm run dev`（后端 8787 + Vite 前端）。

### 内部预览网站（只读）

```bash
npm run build
node dist-server/server.js --readonly --port 8788 --data ./data/runtime   # 访问 http://<本机IP>:8788
```

可读写的 Web 版服务：`node dist-server/server.js --port 8787`。参数：`--data 数据目录` `--host 0.0.0.0` `--no-scheduler`。

### AI 配置

在「设置」页填写，或用环境变量：

```bash
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.openai.com/v1   # 兼容 DeepSeek / 通义 / Moonshot / Ollama 等
export OPENAI_MODEL=gpt-4o-mini
```

未配置 Key 时**自动降级**：相似检索用本地特征哈希向量（英文词 + 中文二元组，256 维），总结/分析用规则模板，规则生成用启发式 DOM 结构推断。界面右上角显示“AI 离线模式 / AI 在线”。

## 3. 构建安装包

```bash
npm run dist:linux   # release/ProductHub-1.0.0-linux-x86_64.AppImage, .tar.gz
npm run dist:win     # release/ProductHub-Setup-1.0.0-win-x64.exe（NSIS 安装包）+ ProductHub-1.0.0-win-x64-portable.exe（便携版）
                     # 可在 Windows 上执行，也可在装有 wine 的 Linux 上交叉构建（本次交付即在 Linux 上构建，未签名）
npm run dist:mac     # release/ProductHub-1.0.0-mac-*.dmg / .zip，需在 macOS 上执行（签名/公证需配置 Apple 证书 CSC_LINK 等环境变量）
```

### 本次交付的构建产物

| 文件 | 说明 |
|---|---|
| `ProductHub-1.0.0-linux-x86_64.AppImage` | Linux 单文件可执行（`chmod +x` 后双击运行） |
| `ProductHub-1.0.0-linux-x64.tar.gz` | Linux 解压即用 |
| `ProductHub-Setup-1.0.0-win-x64.exe` | Windows 安装包（未签名，首次运行 SmartScreen 需点“仍要运行”） |
| `ProductHub-1.0.0-win-x64-portable.exe` | Windows 便携版 |
| macOS | 需在 Mac 上执行 `npm install && npm run dist:mac` |

## 4. 数据与目录

```
src/server/      后端（Node）：db.ts 数据库 · products.ts 入库/去重/版本 · crawler.ts 抓取与规则 · ai.ts AI/向量/分析
                 filter.ts 复杂筛选编译 · importexport.ts 导入导出 · scheduler.ts 增量调度 · server.ts REST API · taxonomy.ts 分类标签
src/ui/          前端（React）：views/ 各页面 · components/ 筛选器、AI 面板
electron/        桌面壳（启动内嵌服务，窗口加载本地 UI）
data/sources.csv 用户提供的 241 个监控来源
data/seed/       预缓存历史数据库与图片（npm run seed 重新生成，约 10 分钟）
screenshots/     关键界面截图（node scripts/screenshots.mjs 生成）
tests/           unit / integration / e2e
```

用户数据目录：Linux `~/.config/统一产品库/data`，Windows `%APPDATA%\统一产品库\data`，macOS `~/Library/Application Support/统一产品库/data`（菜单「文件 → 打开数据目录」）。数据库为单个 SQLite 文件 `producthub.db`，可直接用任何 SQLite 工具打开。

### 抓取规则示例

```json
{
  "mode": "html",
  "listUrl": "https://example.com/new",
  "itemSelector": "article.product-card",
  "fields": {
    "name": { "selector": "h3" },
    "url": { "selector": "a", "attr": "href" },
    "description": { "selector": "p.tagline" },
    "image": { "selector": "img", "attr": "src" },
    "votes": { "selector": ".votes", "regex": "(\\d+)" }
  },
  "followDetail": true,
  "maxItems": 30
}
```

`auto` 模式会依次尝试：页面声明的 RSS/Atom → 常见 feed 路径 → JSON-LD ItemList → 启发式重复结构推断；成功后把发现的规则写回该来源。`followDetail` 会进入详情页提取真正的官网外链与 og 图片/描述（过滤社交链接、站内链接和在多个条目中重复出现的赞助链接）。

## 5. 测试

```bash
npm test              # Vitest：单元 + 集成（136 个用例）
npx tsx scripts/search-eval.ts [--holdout]   # 搜索质量评测（v1.4，46 条评测集 + 12 条留出集）
npx playwright install chromium   # 首次（或使用本机 Chrome，配置中 channel: 'chrome'）
npm run build && npm run test:e2e # Playwright E2E（23 个场景，包含只读预览站点；联网部分用 --web-fixtures 本地样本）
```

## 6. 已知限制

- **v1.4 找产品**：中文需求匹配英文产品依赖内置中英同义词词典（约 90 组）。词典没覆盖的说法（如「电子签名」「图片压缩」）在离线模式下可能找不到，留出集 Recall@10 只有 45%（调参集为 94%）；配置大模型 Key 后由模型扩展同义词。详见 `docs/找产品-v1.4.md`。
- 联网搜索依赖公开页面：DuckDuckGo HTML 会间歇性弹出反爬验证（会显示为“被反爬验证拦截”），GitHub 搜索在未登录时每分钟限 10 次，Product Hunt 是 JS 渲染页面，所以没有接入。
- 官网补齐采用启发式提取：资讯类“产品”（新闻文章）会提取出媒体公司的信息；定价表由 JS 渲染的网站拿不到价格档位。

- Product Hunt、Peerlist、YourStory 等部分站点有反爬（403/Cloudflare）或为纯 JS 渲染，自动模式无法抓取；可在规则工作台改用其官方 RSS / API（json 模式）或配置 AI 生成规则。
- 来源列表中包含新闻媒体类站点（36氪、TechCrunch 等），其 RSS 条目是文章而非产品，会以“产品”形式入库；可在来源监控中停用或在筛选器中按渠道排除。
- 离线模式下的分类/分析基于关键词规则，准确度有限；配置大模型 Key 后效果显著提升。
- 未内置无头浏览器渲染（体积考虑），JS 渲染站点需使用其 API/RSS。

## v1.1.0 界面重设计

- 设计系统：shadcn/ui（Tailwind + Radix），zinc 中性色，浅色 / 深色 / 跟随系统（设置 → 外观，或 Ctrl+Shift+L）。
- 桌面化外壳：无边框窗口 + 自绘标题栏（最小化/最大化/关闭），底部状态栏（同步状态、AI 模式、计数）。
- 左侧栏：产品库 / 分类 / 标签 / 来源 / 工具分组，可折叠分类树，计数徽标，顶部搜索，可收起为图标栏（Ctrl+B）。
- 普通表单查询：关键词、分类、标签、来源渠道 + 【查询】【重置】，“更多条件”含地区、商业模式、发布日期范围、票数、发布次数、收录方式、AI 总结。
- 虚拟滚动表格（表头吸顶、滚动加载）、可拖宽详情分栏、AI 助手右侧 Sheet（可拖宽）、右键菜单、骨架屏。
- 快捷键：Ctrl/⌘+K 命令面板，Ctrl+J AI 助手，Ctrl+B 侧栏，Ctrl+N 添加产品，Ctrl+F 搜索，Ctrl+1–6 切换页面，↑↓ 切换产品，Esc 关闭详情。
- 设计走查报告：docs/UI走查报告.md。
