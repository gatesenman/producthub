# ProductHub v1.8.1

补丁包：修复 v1.8.0 端到端测试中的 4 个 P1。

## 变更
1. 「alternative to / 类似 X」排序：优选真实官网为目标、压低类目名与替代品清单页、提高 alt_rel 与目标简介关键词亲和。
2. 大库冷启动：有 FTS 时跳过全量内存倒排；RSS 约 0.4–0.5GB。
3. 找相似：纳入 alt_rel、过滤泛化名。
4. 性能单测阈值按本机暖搜索调整。

## 校验
- Vitest 145/145
- crawl 冒烟：alternative to notion / findSimilar(notion.com) / warm 跳过全量索引
