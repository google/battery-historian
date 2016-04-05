#!/bin/bash
PACKAGE=$1
BASEDIR=$(dirname $0)
DATE=$(date "+%y\%m\%d-%H:%M:%S")
LOGFILE=$BASEDIR/output/batstat_$DATE.txt
HTMLFILE=$BASEDIR/output/batstat_$DATE.html
BROWSER=chromium-browser

mkdir output >/dev/null

if ! which adb >/dev/null; then
    echo Adb not found 
    exit
fi

if ! which python >/dev/null; then
    echo Python not found 
    exit
fi

if ! which $BROWSER >/dev/null; then
    BROWSER=firefox
fi

adb shell dumpsys batterystats $PACKAGE > $LOGFILE
python $BASEDIR/scripts/historian.py $LOGFILE > $HTMLFILE
$BROWSER $HTMLFILE
