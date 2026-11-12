#!/usr/bin/env bash
# Deploys one commit of bigmoostache/retroback to the OVH VM (vm-1).
#
# Installed as /opt/retroback/deploy.sh and run by the CI deploy key, which
# authorized_keys pins to this script (command=...,restrict). The commit SHA
# arrives in SSH_ORIGINAL_COMMAND; run by hand with the SHA as $1.
#
# Steps: fetch the commit, sync it into /opt/retroback/app (keeps .env,
# node_modules and build outputs), install, generate Prisma, migrate, build
# the web app, restart retroback.service, then wait for /api/ops.
set -euo pipefail

REPO_URL=https://github.com/bigmoostache/retroback.git
BASE=/opt/retroback
SRC=$BASE/src
APP=$BASE/app

sha=${1:-${SSH_ORIGINAL_COMMAND:-}}
sha=${sha#deploy }
if [[ ! $sha =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: deploy.sh <40-char commit sha>" >&2
  exit 2
fi

exec 9>"$BASE/deploy.lock"
flock -w 600 9 || { echo "another deploy holds the lock" >&2; exit 1; }

echo "== fetch $sha"
[[ -d $SRC/.git ]] || git clone --quiet "$REPO_URL" "$SRC"
git -C "$SRC" fetch --quiet origin main
git -C "$SRC" checkout --quiet --force --detach "$sha"

echo "== sync"
rsync -a --delete \
  --exclude /.git --exclude /.env --exclude node_modules \
  --exclude /web/dist --exclude /engine/src/generated \
  "$SRC/" "$APP/"

cd "$APP"
echo "== install"
CI=true pnpm install --frozen-lockfile
echo "== prisma"
pnpm db:generate
pnpm --filter engine exec prisma migrate deploy
echo "== web build"
pnpm --filter web build

echo "== restart"
sudo systemctl restart retroback
for _ in $(seq 1 30); do
  if curl -sf http://127.0.0.1:7979/api/ops >/dev/null; then
    echo "$sha" > "$BASE/DEPLOYED"
    echo "== deployed $sha"
    exit 0
  fi
  sleep 1
done
echo "retroback did not answer on :7979 after restart" >&2
sudo journalctl -u retroback -n 40 --no-pager >&2
exit 1
