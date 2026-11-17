#!/bin/sh
# Daily copy of the SIO database (see deploy/README.md, "Base de datos"): a pg_dump of it in
# BACKUPS, one file a day, those older than KEEP_DAYS removed. Run by cron as root:
#   /etc/cron.d/boiasomorrostro-backup:  30 3 * * * root /opt/boiasomorrostro/deploy/postgres/backup.sh
# Restore one: docker exec -i boia-db pg_restore -U boia -d boia --clean < boia-<date>.dump
set -eu
BACKUPS=${BACKUPS:-/var/backups/boiasomorrostro}
KEEP_DAYS=${KEEP_DAYS:-30}
# Readable by the group of the server's folder (/opt/boiasomorrostro), to download them, and nobody else
GROUP=$(stat -c %G "$(dirname "$0")/../..")
mkdir -p "$BACKUPS"
chgrp "$GROUP" "$BACKUPS"
chmod 750 "$BACKUPS"
FILE="$BACKUPS/boia-$(date +%F).dump"
docker exec boia-db pg_dump -U boia -Fc boia > "$FILE.tmp"
chgrp "$GROUP" "$FILE.tmp"
chmod 640 "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
find "$BACKUPS" -name 'boia-*.dump' -mtime +"$KEEP_DAYS" -delete
