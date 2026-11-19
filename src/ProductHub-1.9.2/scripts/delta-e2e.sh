#!/bin/bash
# 增量更新端到端一键回归：打 Linux 解包版（不含种子）→ 准备客户端基线库与更新源 → Electron 实机 E2E（xvfb）
#   bash scripts/delta-e2e.sh <since-ISO> [big=60000]
set -e
cd "$(dirname "$0")/.."
export PATH="/home/box/opt/node-v22.20.0-linux-x64/bin:$PATH"
SINCE=${1:-2026-11-09T15:08:00.000Z}; BIG=${2:-60000}; WORK=/tmp/ph-delta-e2e
npm run build >/tmp/ph-e2e-build.log 2>&1
python3 - <<'PY'
import json
d=json.load(open('package.json'))['build']; d['extraResources']=[]; d['directories']={'output':'/tmp/ph-release-e2e'}; d['linux']['target']=['dir']; d['compression']='store'
json.dump(d,open('/tmp/eb-e2e.json','w'),ensure_ascii=False)
PY
rm -rf /tmp/ph-release-e2e && npx electron-builder --linux dir --x64 --config /tmp/eb-e2e.json >/tmp/eb-e2e.log 2>&1
npx tsx tests/e2e/delta-e2e-prep.ts --main data/crawl/producthub.db --since "$SINCE" --out $WORK --big $BIG > /tmp/ph-e2e-prep.log 2>&1
rm -rf screenshots/delta-e2e
xvfb-run -a -s "-screen 0 1440x900x24" node tests/e2e/delta-e2e.mjs --app /tmp/ph-release-e2e/linux-unpacked/product-hub --work $WORK
