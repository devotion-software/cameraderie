#!/bin/sh
# Bootstraps a single-node Garage cluster on first boot (layout, bucket, key),
# then runs the server in the foreground. Garage's CLI has no "just start as
# a single node" flag, so this does by hand what that would do — safe to
# re-run: each step is idempotent / ignores "already done" errors.
set -eu

BUCKET="${GARAGE_DEFAULT_BUCKET:-cameraderie}"
ACCESS_KEY="${GARAGE_DEFAULT_ACCESS_KEY:-minioadmin}"
SECRET_KEY="${GARAGE_DEFAULT_SECRET_KEY:-minioadminminioadmin}"

/garage server &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' TERM INT

echo 'garage-entrypoint: waiting for admin API...'
until /garage status >/dev/null 2>&1; do sleep 1; done

NODE_ID=$(/garage status | awk '/NO ROLE ASSIGNED/ { print $1; exit }')
if [ -n "${NODE_ID:-}" ]; then
  echo "garage-entrypoint: assigning single-node layout to $NODE_ID"
  /garage layout assign -z dc1 -c 1G "$NODE_ID"
  /garage layout apply --version 1
else
  echo 'garage-entrypoint: layout already assigned, skipping'
fi

/garage bucket create "$BUCKET" 2>&1 | grep -v 'already exists' || true
/garage key import "$ACCESS_KEY" "$SECRET_KEY" --yes -n local-dev 2>&1 | grep -v 'already exists' || true
/garage bucket allow --read --write --owner "$BUCKET" --key "$ACCESS_KEY"

echo 'garage-entrypoint: bootstrap complete'
wait "$SERVER_PID"
