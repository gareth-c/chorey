#!/bin/sh
set -e

# The data dir may be a bind mount created by the host (commonly root:root
# on first run on Linux hosts) — fix ownership before dropping to the
# unprivileged `node` user so the app can write its SQLite file regardless
# of how the host directory came to exist.
chown -R node:node "${DATA_DIR:-/app/data}"

exec su-exec node "$@"
