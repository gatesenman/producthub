# P1 修复笔记（v1.8.1）

## 状态
- **代码/安装包**：已完成（box 本地）
- **交付 PC**：待传（机器间歇 unreachable）；制品与校验已备好

## 根因与修复
1. **alternative to notion**
   - 根因：按 pop 选中「alternatives to Notion」清单页；类目名与真实产品等权
   - 改动：`targetQuality` 优选域名贴合/非清单页；`isGenericProductName`/`looksLikeAlternativesList` 沉底；alt_rel 权重↑；目标简介 token 亲和
   - 文件：`search/text.ts` `search/engine.ts` `search/fts.ts`
2. **大库冷启动**
   - 根因：`server.ts` warm 无条件全量 `buildIndex`
   - 改动：`useFts` 为真时跳过；冒烟 RSS≈0.4GB，日志 `[warm] FTS 已启用，跳过全量内存索引`
   - 文件：`server.ts`
3. **findSimilar**
   - 改动：alt_rel 强加权、过滤泛化名、宽泛类目（ai）降权、无 alt 时需额外信号
   - 文件：`ai.ts`
4. **v15-perf**
   - 预 `syncFts` + 预热后再测；阈值 max search &lt;800ms / browse &lt;300ms
   - 文件：`tests/integration/v15-perf.test.ts`

## 验证
- Vitest **145/145**
- crawl 冒烟：`alternative to notion` similarTo→notion.com；首屏无类目名；AppFlowy/Slite 等靠前
- findSimilar(notion.com)：Logseq/Obsidian Canvas/Slite/ClickUp…；无 Eleven Labs 类噪声
- warm 跳过全量索引；RSS≈0.4GB

## 制品（box）
| 文件 | 大小 | SHA256 |
|------|------|--------|
| `release/ProductHub-Setup-1.8.1-win-x64.exe` | 1055961117 | f1cdbbc8680510edc7335bd05a74fb178aa8ae9b11a69b1643cdf474264c18a8 |
| `release/ProductHub-源代码-1.8.1.zip` | 2192662 | 5295e7605ff7946c4fba1c76ed04f3d0fe007294f6eed90c658cd79beb7694a9 |

分片：`/workspace/v181/deliv/v181s/s000–s125`（8MB）+ `v181z/z000`
合并脚本：`/workspace/v181/join-verify.ps1`（UTF-8 BOM）

## 交付目标
`C:\Users\Administrator\GrokBot-Apps\产品速查\`
机器：`02e378fb-1bc8-4756-a34b-e375a9056b26`（优先）/ `c23d0e57-…`（备用）
校验通过后再删 v1.8.0；用 `.ps1 -File`，勿在 bash 内联 `$`。

## 时间线
- 19:33–19:39 打 NSIS 成功（packaged PE 0x8664，linux .node 已恢复）
- 19:41+ PC CopyFromBox 间歇 unreachable，等待重试

## 交付尝试（续）
- 小文件 CopyFromBox 偶发成功；8MB 分片与 2MB zip 在机器「假在线」时失败（Shell 偶通、CopyFromBox 失败）
- 已 >30min 间歇 unreachable；按约定停止交付，制品留在 box，脚本/分片就绪
- 恢复后：先 CopyFromBox s000–s125 → `GrokBot-Apps\v181s\`，z000 → `v181z\`，再跑 join-verify（需改路径到 ASCII 目录或移入 产品速查）

## Delivery progress (v1.8.1) — Asia/Shanghai

- Box artifacts OK: exe 1055961117 / f1cdbbc8…18a8; zip 2192662 / 5295e760…94a9
- CopyFromBox: 8MB and ≥512KB often "unreachable"; 64KB stable (short bursts). Using `/workspace/v181/deliv64/` (s##### ×16113, z##### ×34).
- 2026-10-29 ~23:59 CST: zip parts z00000–z00033 all on PC `GrokBot-Apps\v181z`. Installer parts not started (v181s empty of s*).
- Staging ASCII: `C:\Users\Administrator\GrokBot-Apps\v181s` / `v181z`. Final: `产品速查\ProductHub-安装包-1.8.1.exe` + `ProductHub-源代码-1.8.1.zip`.
- Do not delete 1.8.0 until join+SHA verify OK.
- 2026-10-30 ~00:05 CST: ZIP delivered+verified on PC (ProductHub-源代码-1.8.1.zip 2192662 / 5295e760…94a9). Installer via 128KB packs q0000–q8056 (8057 files, sum=1055961117) under v181s; q0000–q0002 copied; 8MB/256KB CopyFromBox fail; parallel≥2 often unreachable; use sequential 128KB + 60–120s backoff.
- 2026-10-30 CST: q0000–q0034 on PC (35/8057 ×128KB). ZIP verified in 产品速查. 1.8.0 not deleted yet. Next: continue q0035+ sequential; join exe only at 8057/8057.
- 2026-10-30 ~00:55 CST: installer packs q0000–q0099 on PC (100/8057). Resumed from q0066. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 CST: installer packs q0000–q0199 on PC (200/8057). Sequential CopyFromBox stable this stretch. No join yet.
- 2026-10-30 CST: installer packs q0000–q0299 on PC (300/8057 ≈3.7%). Channel stable sequential. No join yet.
- 2026-10-30 CST: installer packs q0000–q0399 on PC (400/8057 ≈5.0%). Still sequential; no join.
- 2026-10-30 ~01:32 CST: installer packs q0000–q0499 on PC (500/8057 ≈6.2%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~01:45 CST: installer packs q0000–q0599 on PC (600/8057 ≈7.4%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~01:50 CST: installer packs q0000–q0699 on PC (700/8057 ≈8.7%). Resumed from q0659. Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~01:55 CST: installer packs q0000–q0799 on PC (800/8057 ≈9.9%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~02:00 CST: installer packs q0000–q0899 on PC (900/8057 ≈11.2%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~02:05 CST: installer packs q0000–q0999 on PC (1000/8057 ≈12.4%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~02:10 CST: installer packs q0000–q1099 on PC (1100/8057 ≈13.7%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~02:13 CST: installer packs q0000–q1199 on PC (1200/8057 ≈14.9%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~02:18 CST: installer packs q0000–q1299 on PC (1300/8057 ≈16.1%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~02:23 CST: installer packs q0000–q1399 on PC (1400/8057 ≈17.4%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~02:28 CST: installer packs q0000–q1499 on PC (1500/8057 ≈18.6%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~02:34 CST: installer packs q0000–q1599 on PC (1600/8057 ≈19.9%). Sequential CopyFromBox stable (q1557 abort verified landed on PC). ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~02:40 CST: installer packs q0000–q1699 on PC (1700/8057 ≈21.1%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~02:47 CST: installer packs q0000–q1799 on PC (1800/8057 ≈22.3%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~02:55 CST: installer packs q0000–q1899 on PC (1900/8057 ≈23.6%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~03:01 CST: installer packs q0000–q1999 on PC (2000/8057 ≈24.8%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~03:07 CST: installer packs q0000–q2099 on PC (2100/8057 ≈26.1%). Sequential CopyFromBox stable. ZIP already verified — not re-copied. No join yet.
- 2026-10-30 ~03:50 CST: switched to 32MB blocks (B*), all parts on PC; joined ProductHub-安装包-1.8.1.exe size 1055961117 SHA256 f1cdbbc8…c18a8 OK. Deleted 1.8.0 exe/zip, v181s, v181big. Leftovers not deleted: GrokBot-Apps\v181chunks, inventory-v181.ps1, join-verify-v181.ps1, join_verify.py, mkdirs-v181.ps1, progress-v181.ps1, tiny-probe.txt. Note zip 1.8.1 on PC is 2192662 bytes.
