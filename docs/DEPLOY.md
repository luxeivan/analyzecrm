# Деплой на сервер и перенос данных

Задача: один экземпляр данных (БД с эмбеддингами) живёт на сервере, локальный компьютер используется
только для разработки кода и ходит на сервер.

- **Прод**: `db` + `api` + `web` (nginx, статика) — `docker-compose.prod.yml`.
- **Локально**: только Vite-дев-сервер, который проксирует `/api` на прод (или локальный API через SSH-туннель к БД).
- **Данные**: переносятся дампом Postgres. Векторы эмбеддингов и HNSW-индексы — это обычные данные таблиц,
  они переезжают вместе с базой, пересчитывать ничего не нужно.

## 1. Требования к серверу

- 4 vCPU / 8 ГБ RAM / 60+ ГБ SSD (текущая база ~2.5 ГБ + рост, HNSW-индексы ~1–2 ГБ);
- Docker Engine 24+ и Docker Compose v2;
- открыты 22 (SSH), 80/443 (HTTP/HTTPS). Порт Postgres наружу **не** открывать.

## 2. Подготовка проекта на сервере

```bash
git clone <репозиторий> /opt/bitrix-analyze && cd /opt/bitrix-analyze
cp .env.example .env
```

В серверном `.env` обязательно поменять:

```ini
POSTGRES_PASSWORD=<сильный пароль>      # НЕ bitrix
AUTH_ADMIN_LOGIN=admin
AUTH_ADMIN_PASSWORD=<сильный пароль>    # пароль системного админа
AUTH_JWT_SECRET=<openssl rand -hex 32>  # НОВЫЙ секрет, не тот, что локально
AUTH_TOKEN_TTL_H=24
SYNC_SCHEDULER=1                        # автообновление теперь живёт на сервере
SYNC_INTERVAL_MIN=15
RECONCILE_DAYS=7
ETL_SLEEP_MS=1500
POLZA_TOKEN=<ключ polza.ai>
POLZA_MODEL=deepseek/deepseek-v4.1-flash-1017
TZ=Europe/Moscow
WEB_PORT=8080                           # nginx слушает только 127.0.0.1
```

Поднять только БД (схема и `pgvector` создадутся из `db/init`):

```bash
docker compose -f docker-compose.prod.yml up -d db
```

## 3. Перенос данных с локальной машины

### 3.1 Остановить всё, что пишет в БД

Локально: остановить `bitrix_embed`, `bitrix_etl`, выгрузку в API — иначе дамп будет «на ходу».

```bash
docker rm -f bitrix_embed 2>/dev/null
docker compose stop api etl
```

### 3.2 Дамп

```bash
docker compose exec -T db pg_dump -U bitrix -d bitrix -Fc \
  -f /tmp/bitrix-$(date +%F).dump
docker compose cp db:/tmp/bitrix-$(date +%F).dump ./bitrix-$(date +%F).dump
```

### 3.3 Копирование и восстановление

```bash
scp bitrix-$(date +%F).dump user@server:/opt/bitrix-analyze/
ssh user@server
cd /opt/bitrix-analyze
docker compose -f docker-compose.prod.yml cp ./bitrix-$(date +%F).dump db:/tmp/
docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U bitrix -d bitrix --clean --if-exists --no-owner /tmp/bitrix-$(date +%F).dump
```

`--clean --if-exists` удалит объекты, созданные init-скриптом (пустая схема), и восстановит ваши данные.
`pg_restore` может выдать предупреждения про отсутствующие роли — это нормально при `--no-owner`.

### 3.4 Проверка после восстановления

```bash
docker compose -f docker-compose.prod.yml exec -T db psql -U bitrix -d bitrix -c "
SELECT (SELECT count(*) FROM companies) companies,
       (SELECT count(*) FROM contacts) contacts,
       (SELECT count(*) FROM deals) deals,
       (SELECT count(*) FROM leads) leads,
       (SELECT count(*) FROM companies WHERE embedding IS NOT NULL) vec_companies;" -c "
SELECT indexname FROM pg_indexes WHERE indexname LIKE '%embedding%';" -c "ANALYZE;"
```

Ожидаемо: 51 171 / 103 766 / 83 555 / 188 300 и три HNSW-индекса (`companies_`, `contacts_`, `leads_embedding_hnsw`).
Если индексов нет — это не страшно: их пересоздаст `embed.js --index` или `duplicates.js`.

## 4. Запуск прода

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
curl -s http://127.0.0.1:8080/api/health
```

`web` публикуется только на `127.0.0.1:8080` — снаружи его закрывает HTTPS-прокси.

## 5. HTTPS

Вариант с Caddy (сам получает сертификат):

```caddyfile
crm.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Вариант с nginx + certbot — аналогично, `proxy_pass http://127.0.0.1:8080;`.
Обязательно `proxy_read_timeout 900s` для долгих запросов (`/ai/insights`, `/ai/ask`, выгрузка).

## 6. Бэкапы

```bash
# /etc/cron.daily/bitrix-backup
cd /opt/bitrix-analyze
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U bitrix -d bitrix -Fc > /var/backups/bitrix-$(date +%F).dump
find /var/backups -name 'bitrix-*.dump' -mtime +14 -delete
```

## 7. Локальная разработка при данных на сервере

Данные существуют в одном экземпляре — на сервере. Локально БД **не** поднимаем.

### Вариант A (простой, рекомендуется): только фронтенд

```bash
cd web
VITE_API_PROXY=https://crm.example.com npm run dev
```

- Vite на `http://localhost:5173` проксирует `/api` на прод;
- входьте под отдельным пользователем с ролью **user** (создаётся в админке на сервере): он видит данные,
  но не может запускать выгрузку, менять настройки и пользователей;
- ничего не пишущего в прод-БД кода локально нет.

### Вариант B: локальный API + SSH-туннель к БД (только чтение)

```bash
ssh -N -L 55433:127.0.0.1:5432 user@server
```

На сервере создать read-only роль один раз:

```sql
CREATE ROLE dev_ro LOGIN PASSWORD '<пароль>';
GRANT CONNECT ON DATABASE bitrix TO dev_ro;
GRANT USAGE ON SCHEMA public TO dev_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dev_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dev_ro;
```

Локальный `.env` для API:

```ini
DATABASE_URL=postgres://dev_ro:<пароль>@localhost:55433/bitrix
SYNC_SCHEDULER=0
ETL_AUTO_RETRY=0
```

и запуск:

```bash
cd api && npm run dev
cd web && npm run dev          # proxy по умолчанию на localhost:4000
```

Правила, чтобы не рассинхронизировать данные:

- **не запускать** локально `etl`, `embed`, `reconcile`, кнопки «Старт выгрузки»/«Пересчитать дубли»;
- `SYNC_SCHEDULER=0` локально, `=1` только на сервере;
- фронтовые правки проверяются на прод-API (вариант A) — данные читаются, но не меняются.

### Что делать, если нужно менять схему

Миграции руками: правка `api/src/sql/schema.sql` (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`) →
на сервере `docker compose -f docker-compose.prod.yml up -d --build` (API применит схему при старте).

## 8. Обновление кода на сервере

Одной командой с локальной машины:

```bash
./scripts/deploy.sh        # доставка кода + docker compose up -d --build + проверка health
```

Переменные: `DEPLOY_HOST` (по умолчанию `werstakoff@192.168.1.65`), `DEPLOY_DIR` (`/srv/analyzeCRM`),
`DEPLOY_KEY` (`~/.ssh/bitrix_deploy`), `DEPLOY_MODE` (`auto|git|tar`).

Режим `auto`: если на сервере работает `git ls-remote origin` (добавлен deploy key) — скрипт делает
`git push` + `git reset --hard origin/main`; иначе копирует проект через `tar` по SSH (rsync на Windows
обычно отсутствует). `.env`, `backup/`, `node_modules`, `.git` не передаются, данные в docker-volume
не затрагиваются.

### Обновление через git (deploy key)

На сервере ключ `~/.ssh/github_deploy`, публичная часть добавлена в GitHub →
**Settings → Deploy keys → Add deploy key** (read-only достаточно).

```bash
# первичная привязка каталога к репозиторию (один раз)
cd /srv/analyzeCRM
git fetch origin
git checkout -f -B main origin/main      # .env и backup/ не трогаются (они в .gitignore)

# обновление
git pull --ff-only && docker compose -f docker-compose.prod.yml up -d --build
```

Вручную:

```bash
cd /opt/bitrix-analyze
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Выгрузка и векторизация при рестарте `api` прерываются, но курсоры и уже посчитанные векторы в БД —
следующий старт продолжит с места остановки.
