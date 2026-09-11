#!/usr/bin/env bash
# Бэкап базы данных: снимок в ./backups, хранит последние KEEP_BACKUPS штук, старые удаляет.
#
# Запускать из корня проекта (там, где docker-compose.yml и .env):
#   bash deploy/backup.sh
#
# Для автоматических ежедневных бэкапов — добавить в crontab (crontab -e), например
# каждый день в 3:00 ночи:
#   0 3 * * * cd /root/mailer && bash deploy/backup.sh >> backups/backup.log 2>&1
# (путь /root/mailer поменять на реальный путь к проекту на сервере)

set -euo pipefail
cd "$(dirname "$0")/.."

KEEP_BACKUPS=14

if [ ! -f .env ]; then
  echo "Не найден .env в $(pwd) — запускайте скрипт из корня проекта" >&2
  exit 1
fi

set -a
source .env
set +a

mkdir -p backups
TS=$(date +%Y%m%d-%H%M%S)
FILE="backups/backup-$TS.sql"

docker compose exec -T db pg_dump -U "${POSTGRES_USER:-mailer}" "${POSTGRES_DB:-mailer}" > "$FILE"
gzip "$FILE"

echo "Бэкап сохранён: $FILE.gz"

# Оставляем только последние KEEP_BACKUPS файлов, остальные удаляем
ls -1t backups/backup-*.sql.gz 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm --
