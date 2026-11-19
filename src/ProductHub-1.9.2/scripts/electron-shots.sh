#!/bin/bash
# v1.3：用 Xvfb 运行打包后的 Electron（release/linux-unpacked），截取整个 X 屏幕，证明无边框窗口 + 自绘标题栏 + 新界面
# 用法：xvfb-run -a -s "-screen 0 1440x900x24" bash scripts/electron-shots.sh
set -x
APP=/workspace/product-hub/release/linux-unpacked/product-hub
OUT=/workspace/product-hub/screenshots
grab() { python3 -c "from PIL import ImageGrab; ImageGrab.grab(xdisplay=None).save('$1')"; }
run() { # $1 data dir  $2 query  $3 out  $4 delay
  PH_DATA=$1 PH_NO_SCHEDULER=1 PH_QUERY="$2" $APP --no-sandbox --disable-gpu >/tmp/electron.log 2>&1 & EP=$!
  sleep $4; grab "$3"; kill $EP; sleep 1.5; pkill -f linux-unpacked/product-hub; sleep 0.5
}
rm -rf /tmp/eph1 /tmp/eph0
run /tmp/eph0 "" "$OUT/E1-桌面版-首次启动引导.png" 9
run /tmp/eph1 "noonboard" "$OUT/E2-桌面版-首页.png" 9
run /tmp/eph1 "view=products&noonboard" "$OUT/E3-桌面版-产品库.png" 8
run /tmp/eph1 "view=analytics&noonboard" "$OUT/E4-桌面版-分析与来源重叠.png" 8
run /tmp/eph1 "view=sources&noonboard" "$OUT/E5-桌面版-来源与规则合并标题.png" 8
# E6：真实键鼠交互（xdotool）——点击一行打开详情，再 Ctrl+A 全选，出现批量操作条
PH_DATA=/tmp/eph1 PH_NO_SCHEDULER=1 PH_QUERY="view=products&noonboard" $APP --no-sandbox --disable-gpu >/tmp/electron.log 2>&1 & EP=$!
sleep 8; xdotool mousemove 520 230 click 1; sleep 1.2; xdotool key ctrl+a; sleep 1; xdotool mousemove 1200 880; sleep 0.5
grab "$OUT/E6-桌面版-多选批量与详情.png"; kill $EP; sleep 1.5; pkill -f linux-unpacked/product-hub
