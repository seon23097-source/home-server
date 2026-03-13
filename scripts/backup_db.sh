#!/bin/bash
set -e

BACKUP_DIR=/data/backups/postgres
DATE=$(date +%Y%m%d_%H%M%S)
LOG=/app/logs/backup_db.log

mkdir -p $BACKUP_DIR

echo "=== DB 백업 시작: $(date) ===" >> $LOG

docker exec postgres pg_dump -U ${DB_USER:-dbuser} -Fc ${DB_NAME:-maindb} \
  | gzip > $BACKUP_DIR/maindb_$DATE.dump.gz

if [ $? -eq 0 ]; then
  echo "백업 성공: maindb_$DATE.dump.gz" >> $LOG
else
  echo "❌ 백업 실패!" >> $LOG
  exit 1
fi

find $BACKUP_DIR -name "maindb_*.dump.gz" -mtime +7 -delete

echo "=== 백업 완료: $(date) ===" >> $LOG
