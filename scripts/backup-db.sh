#!/bin/bash
# Daily database backup for Cromwell OS
# Keeps last 30 days of backups

BACKUP_DIR="/Users/majidaljassas/cromwell-os/backups"
PG_BIN="/opt/homebrew/opt/postgresql@17/bin"
DB="cromwell_os"
PORT=51214
USER="postgres"

mkdir -p "$BACKUP_DIR"

# Create backup
FILENAME="cromwell_os_$(date +%Y%m%d_%H%M%S).sql"
$PG_BIN/pg_dump -p $PORT -U $USER $DB > "$BACKUP_DIR/$FILENAME"

if [ $? -eq 0 ]; then
  echo "$(date): Backup saved: $FILENAME ($(du -h "$BACKUP_DIR/$FILENAME" | cut -f1))"

  # Delete backups older than 30 days
  find "$BACKUP_DIR" -name "cromwell_os_*.sql" -mtime +30 -delete
else
  echo "$(date): BACKUP FAILED"
fi
