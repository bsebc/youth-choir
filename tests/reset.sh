#!/bin/sh
# reset.sh <db> <senior|youth> [new]  — rebuild one local database: the Supabase
# stand-in, the mirror of the live schema as of 2026-11-01 (before that day's
# fixes), the sample data, and with "new" every ../supabase/migrations file in order.
set -e
cd "$(dirname "$0")"
DB=$1; CHOIR=$2
PSQL="psql -h 127.0.0.1 -p ${PGPORT:-54329} -U postgres -q -v ON_ERROR_STOP=1"
$PSQL -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null 2>&1
STORE=/tmp/harness-storage/$DB
rm -rf "$STORE"
node seed.mjs "$CHOIR" "$STORE" > /tmp/seed-$DB.sql
SENIOR=false; [ "$CHOIR" = senior ] && SENIOR=true
$PSQL -d "$DB" -v senior=$SENIOR -f sql/00_supabase.sql -f sql/10_live_baseline.sql -f /tmp/seed-$DB.sql >/dev/null
if [ "$3" = new ]; then
  for f in ${MIGRATIONS:-../supabase/migrations}/*.sql; do
    [ -f "$f" ] || continue
    $PSQL -1 -d "$DB" -f "$f" >/dev/null || { echo "migration failed: $f"; exit 1; }
  done
fi
echo "reset $DB ($CHOIR${3:+, $3})"
