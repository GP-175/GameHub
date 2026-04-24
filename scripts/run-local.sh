#!/usr/bin/env bash
set -euo pipefail
cd /srv/gamehub
exec node local-server.mjs
