# E2E 测试续跑笔记（v1.8）

完成时间：2026-10-29 Asia/Shanghai  
状态：**已完成** → 报告 `docs/E2E测试报告-v1.8.md`

## 进度
- [x] 功能清单（README/手册/views/sidebar）
- [x] npm ci + native rebuild + build
- [x] vitest：143/144（v15-perf 失败）
- [x] playwright：23/23
- [x] API sweep + 大库搜索 + 截图
- [x] 小修：VERSION 1.8.0、xlsx 截断
- [x] 报告已写

## 服务（若续测）
- RW seed：`node dist-server/server.js --port 8787 --data /tmp/ph-e2e-manual --no-scheduler`
- RO：`--readonly --port 8788 --data /tmp/ph-e2e-ro`
- 大库：`--readonly --port 8791 --data data/crawl`（冷启动慢、吃内存）

## 勿删
- data/backups、data/crawl
