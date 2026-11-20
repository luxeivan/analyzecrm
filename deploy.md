сервер 192.168.1.65
пользователь werstakoff
директория для создания проекта в ней /srv/analyzeCRM
на серваке уже крутятся много проектов в докере и эти все проекты лежат в /srv в подпапках
домен для доступа analyzecrm.luxeivan.ru (А запись создал)
надо будет выпустить SSL и настроить на серваке nginx (на сервере уже установлен nginx и есть все для выпуска сертификатов lets encrypt)
главное не убить другие проекты на сервере (там уже много портов занято)
так же создал https://github.com/luxeivan/analyzecrm.git репозиторий вот на него надо все запушить и на серваке потом оттуда залить и развернуть, а данные можно скопировать думаю через SSH
---

## Состояние развёртывания (прод)

- Сервер: `192.168.1.65`, пользователь `werstakoff`, проект: **`/srv/analyzeCRM`**.
- Домен: **https://analyzecrm.luxeivan.ru** (nginx + Let's Encrypt, HTTP → HTTPS редирект).
- Контейнеры: `bitrix_db` (Postgres+pgvector), `bitrix_api`, `bitrix_web` (nginx, `127.0.0.1:8090`).
- Конфиг: `/srv/analyzeCRM/.env` (права 600). Секреты сгенерированы на сервере.
- Вход: администратор — `AUTH_ADMIN_LOGIN` / `AUTH_ADMIN_PASSWORD` из `.env`;
  для локальной разработки создан пользователь `viewer` с ролью **user**.
- Данные перенесены дампом `backup/bitrix-2026-11-20.dump`: 51 171 / 103 766 / 83 555 / 188 300,
  эмбеддинги компаний и контактов, HNSW-индексы. Векторизация сделок и лидов досчитывается на сервере.
- Бэкап: крон пользователя `werstakoff`, ежедневно в 04:20 → `backup/bitrix-YYYY-MM-DD.dump`, хранится 14 дней.
- Автообновление CRM: `SYNC_SCHEDULER=1` (каждые 15 мин дельта + эмбеддинги, сверка удалённых раз в 7 дней).

### Deploy key и обновление через git

Публичный ключ сервера (`~/.ssh/github_deploy.pub`):

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK0+z+bvDWUufHU3zgJ9G16LJxQxpwGa/5q9wctE2fUv analyzeCRM deploy
```

Добавляется в GitHub: репозиторий `luxeivan/analyzecrm` → **Settings → Deploy keys → Add deploy key**
(права read-only достаточно).

```bash
# один раз
cd /srv/analyzeCRM && git fetch origin && git checkout -f -B main origin/main
# дальше любое обновление
git pull --ff-only && docker compose -f docker-compose.prod.yml up -d --build
```

### Обновление кода

```bash
# локально
git push origin main

# на сервере (в /srv/analyzeCRM нет github-доступа — копируем rsync/scp с локальной машины)
rsync -az --exclude node_modules --exclude .env --exclude backup --exclude .git \
  ./ werstakoff@192.168.1.65:/srv/analyzeCRM/
ssh werstakoff@192.168.1.65 'cd /srv/analyzeCRM && docker compose -f docker-compose.prod.yml up -d --build'
```

### Локальная разработка (данные на сервере)

```bash
cd web
VITE_API_PROXY=https://analyzecrm.luxeivan.ru npm run dev
```

Вход — под `viewer` (роль user): данные читаются, изменения и админка недоступны.
ETL/векторизацию/сверку запускать только на сервере.
