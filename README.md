battery-historian
=================

Battery Historian is a tool to analyze battery consumers using Android "bugreport" files.

./historian.py -p monsoon.out bugreport.txt

TO USE: (see also usage() below)
 adb shell dumpsys batterystats --enable full-wake-history  (post-KitKat only)
 adb shell dumpsys batterystats --reset
 optionally start monsoon/power monitor logging:
   if device/host clocks are not synced, run historian.py -v
   cts/tools/utils/monsoon.py --serialno 2294 --hz 1 --samples 100000 \
   -timestamp | tee monsoon.out
 ...let device run a while...
 stop monsoon.py
 adb bugreport > bugreport.txt
 ./historian.py -p monsoon.out bugreport.txt


# Tips

If you like to see the battery history data with KitKat and below devices, fork the battery-historian and then run the following:

$ adb shell dumpsys batterystats --reset

>> run some test. either manual or with espresso, or monkeyrunner ... <<

$ adb bugreport > bugreport.txt
$ ./historian.py bugreport.txt > out.html

>> open out.html with your favorite browser <<
If you generated a power consumption file with either monsoon or any other tool, you can add this file (lines of ) by passing it with the -p parameter

Edit A better and faster way to get the bugreport is by using:

/# create battery stats table
adb shell dumpsys batterystats > bugreport
/# append the creation time, which is way more accurate
echo "== dumpstate: `adb shell date +'%Y-%m-%d %H:%M:%S'`" >> bugreport
