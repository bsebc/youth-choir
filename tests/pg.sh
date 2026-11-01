#!/bin/sh
# pg.sh — make sure the throwaway Postgres 16 on port 54329 is running
# (background processes do not survive between sessions, so every script calls this).
BIN=/usr/lib/postgresql/16/bin; DATA=${PGDATA_DIR:-/tmp/pgdata}
pg_isready -h 127.0.0.1 -p 54329 -q 2>/dev/null && exit 0
if [ ! -f "$DATA/PG_VERSION" ]; then
  mkdir -p "$DATA"; chown postgres:postgres "$DATA" 2>/dev/null
  su postgres -s /bin/sh -c "$BIN/initdb -D $DATA -A trust -U postgres" >/dev/null
fi
su postgres -s /bin/sh -c "$BIN/pg_ctl -D $DATA -o '-p 54329 -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c fsync=off' -l /tmp/pg.log start" >/dev/null
for i in 1 2 3 4 5 6 7 8 9 10; do pg_isready -h 127.0.0.1 -p 54329 -q && exit 0; sleep 0.5; done
echo "postgres did not start"; exit 1
