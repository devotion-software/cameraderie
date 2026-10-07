#!/usr/bin/env bash
#
# Dump MariaDB and upload the gzipped backup to R2. Run from cron on the host.
#
# Prerequisites:
#   - The MariaDB container is running (service name cameraderie-mariadb-1).
#   - rclone is installed and configured with a remote named "r2" pointing at
#     your Cloudflare R2 account (rclone config → type s3 → provider Cloudflare).
#   - MARIADB_* and R2_BUCKET are exported (e.g. `set -a; . /path/to/.env; set +a`).
#
# Example cron (daily at 03:15, keep 14 days on R2 via a bucket lifecycle rule):
#   15 3 * * * cd /opt/cameraderie && set -a && . ./.env && set +a && ./scripts/backup-db.sh >> /var/log/cameraderie-backup.log 2>&1
#
set -euo pipefail

CONTAINER="${MARIADB_CONTAINER:-cameraderie-mariadb-1}"
DB="${MARIADB_DATABASE:-cameraderie}"
USER="${MARIADB_USER:-cameraderie}"
PASS="${MARIADB_PASSWORD:?MARIADB_PASSWORD must be set}"
BUCKET="${R2_BUCKET:?R2_BUCKET must be set}"
REMOTE="${RCLONE_REMOTE:-r2}"

TS="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
FILE="${TMP}/cameraderie-${DB}-${TS}.sql.gz"

echo "[backup] dumping ${DB} from ${CONTAINER} …"
docker exec -i "${CONTAINER}" mariadb-dump \
  --single-transaction --quick --routines --triggers \
  -u"${USER}" -p"${PASS}" "${DB}" | gzip -9 > "${FILE}"

echo "[backup] uploading to ${REMOTE}:${BUCKET}/backups/ …"
rclone copy "${FILE}" "${REMOTE}:${BUCKET}/backups/"

rm -rf "${TMP}"
echo "[backup] done: backups/$(basename "${FILE}")"
