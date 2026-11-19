#!/bin/bash
# v1.4：打包版 Electron（Xvfb）—— 首页一句话搜索 + 真实键盘输入自然语言搜索 / 对比
# 用法：xvfb-run -a -s "-screen 0 1440x900x24" bash scripts/electron-shots-v14.sh
APP=/workspace/product-hub/release/linux-unpacked/product-hub; OUT=/workspace/product-hub/screenshots
grab() { python3 -c "from PIL import ImageGrab; ImageGrab.grab(xdisplay=None).save('$1')"; }
rm -rf /tmp/eph4
PH_DATA=/tmp/eph4 PH_NO_SCHEDULER=1 PH_QUERY="noonboard" $APP --no-sandbox --disable-gpu >/tmp/electron.log 2>&1 & EP=$!
sleep 10; grab "$OUT/E7-桌面版-首页一句话找产品.png"
xdotool mousemove 640 232 click 1; sleep 0.5; xdotool type --delay 60 "meeting notes ai"; xdotool key Return; sleep 3
xdotool mousemove 1300 880; sleep 0.5; grab "$OUT/E8-桌面版-搜索结果为什么匹配.png"
kill $EP; sleep 1.5; pkill -f linux-unpacked/product-hub
