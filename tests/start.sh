#!/bin/sh
# start.sh <port> <db> [site]  — (re)start one local stack in the background:
# the API stand-in plus the site's files on http://127.0.0.1:<port>
cd "$(dirname "$0")"
./pg.sh
PORT=$1; DB=$2; SITE=${3:-..}
[ -f /tmp/choir-$PORT.pid ] && kill "$(cat /tmp/choir-$PORT.pid)" 2>/dev/null
sleep 0.3
PORT=$PORT PGDB=$DB SITE=$(cd "$SITE" && pwd) STORE=/tmp/harness-storage/$DB nohup node server.mjs > /tmp/choir-$PORT.log 2>&1 &
echo $! > /tmp/choir-$PORT.pid
sleep 1
head -1 /tmp/choir-$PORT.log
