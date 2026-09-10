#!/usr/bin/env bash
# Разовая подготовка чистого сервера Ubuntu 22.04 под этот проект: Docker, swap
# (при 2 ГБ RAM он нужен, иначе сборка образа может упасть по памяти), файрвол.
#
# Запускать на сервере от root (или через sudo):
#   sudo bash deploy/setup-server.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Запустите от root: sudo bash deploy/setup-server.sh" >&2
  exit 1
fi

echo "==> Обновляю пакеты"
apt-get update -y
apt-get upgrade -y

echo "==> Устанавливаю Docker Engine + Compose plugin (официальный репозиторий Docker)"
if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
else
  echo "Docker уже установлен, пропускаю"
fi

echo "==> Проверяю swap (на 2 ГБ RAM без него сборка образа может упасть по памяти)"
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
  echo "Добавлено 2 ГБ swap"
else
  echo "Swap уже настроен, пропускаю"
fi

echo "==> Настраиваю файрвол (ufw): SSH, 80, 443"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
else
  echo "ufw не найден, пропускаю настройку файрвола — проверьте правила у хостера вручную"
fi

cat <<'EOF'

==> Готово. Дальше вручную:

1. cd в папку проекта (если ещё не склонирован — git clone ... && cd 111/mailer)
2. cp .env.example .env
3. Заполнить .env:
   - POSTGRES_PASSWORD, CREDENTIALS_ENC_KEY, SESSION_SECRET — сгенерировать:
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     (для CREDENTIALS_ENC_KEY и SESSION_SECRET — два РАЗНЫХ значения)
   - DOMAIN и PUBLIC_BASE_URL — ваш поддомен (должен уже указывать A-записью на IP сервера)
   - ADMIN_USERNAME / ADMIN_PASSWORD — логин/пароль первого администратора
4. docker compose up -d --build
5. Открыть https://<DOMAIN> — Caddy сам получит сертификат Let's Encrypt при первом заходе.
EOF
