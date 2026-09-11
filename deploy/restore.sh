#!/usr/bin/env bash
# Восстановление БД из бэкапа, сделанного deploy/backup.sh.
#
# Использование (из корня проекта):
#   bash deploy/restore.sh backups/backup-20260911-030000.sql.gz
#
# ВНИМАНИЕ: перезаписывает текущую базу данных полностью.

set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Использование: bash deploy/restore.sh backups/backup-ДАТА.sql.gz" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "Не найден .env в $(pwd) — запускайте скрипт из корня проекта" >&2
  exit 1
fi

set -a
source .env
set +a

echo "Восстанавливаю базу из $FILE — это ЗАМЕНИТ текущие данные. Продолжить? (yes/нет)"
read -r CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Отменено"
  exit 0
fi

gunzip -c "$FILE" | docker compose exec -T db psql -U "${POSTGRES_USER:-mailer}" "${POSTGRES_DB:-mailer}"
echo "Готово"
