battery-historian
=================

Battery Historian is a tool to analyze battery consumers using Android "bugreport" files.

# ./historian.py -p monsoon.out bugreport.txt

# TO USE: (see also usage() below)
# adb shell dumpsys batterystats --enable full-wake-history  (post-KitKat only)
# adb shell dumpsys batterystats --reset
# optionally start monsoon/power monitor logging:
#   if device/host clocks are not synced, run historian.py -v
#   cts/tools/utils/monsoon.py --serialno 2294 --hz 1 --samples 100000 \
#   -timestamp | tee monsoon.out
# ...let device run a while...
# stop monsoon.py
# adb bugreport > bugreport.txt
# ./historian.py -p monsoon.out bugreport.txt
