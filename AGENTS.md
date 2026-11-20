# AGENTS.md — Bitrix24 CRM Analyzer

Гид по проекту для ИИ-агентов и разработчиков. Читать перед правками.

## 1. Что это

Инструмент для выгрузки и анализа данных облачного Битрикс24 (входящий вебхук):

- **ETL**: `crm.company.list` / `crm.contact.list` / `crm.deal.list` → PostgreSQL (потоково, без накопления в RAM).
- **Backend API**: фильтры/поиск/сортировка, граф связей, агрегаты, JSON-выжимка клиента для локальной LLM.
- **Frontend**: дашборд (Recharts), таблицы компаний/контактов/сделок/лидов, карточки сущностей с расшифровкой `UF_*`,
  страница «Аналитика» (качество данных + бизнес-метрики), граф связей (`react-force-graph-2d`).

Объёмы целевой инсталляции: ~51 000 компаний, ~103 000 контактов, много кастомных полей и справочников.

## 2. Стек

| Слой | Технологии |
| --- | --- |
| БД | PostgreSQL 16 + `pgvector` (`pgvector/pgvector:pg16`), `pg_trgm` |
| ETL / API | Node.js 20, ESM, `axios`, `pg`, `express` (без ORM и без сборки) |
| Frontend | React 18 + TypeScript + Vite 6 + **Ant Design 5** + Recharts + react-router + react-force-graph-2d, светлая/тёмная тема |
| Инфра | Docker Compose: `db`, `adminer`, `api`, `etl` (profile), `web` |

## 3. Структура

```
docker-compose.yml         # db + adminer + api + etl(profile) + web
.env.example               # единственный источник настроек, копируется в .env
db/init/00_extensions.sql  # pgvector/pg_trgm создаются при первом старте БД

api/
  src/config.js            # env -> config (единственное место чтения process.env)
  src/db.js                # pg.Pool, bigint -> Number, withTransaction
  src/bitrix.js            # call() с retry, count(), fetchAll() keyset-пагинация
  src/sql/schema.sql       # идемпотентная схема (вызывают и ETL, и API)
  src/etl/
    run.js                 # оркестрация: метаданные -> выгрузка сущностей
    fields.js              # crm.*.fields + crm.userfield.list + crm.status.list, upsert метаданных
    transform.js           # raw API -> строка таблицы (columns описаны здесь)
    load.js                # bulk upsert страницы + sync_state (курсор/статус)
    embed.js               # эмбеддинги pgvector через Polza.ai (--only, --limit, --force, --index)
    reconcile.js           # сверка удалённых через batch (50×50 ID), аудит в deleted_records
    schema.js              # ensureSchema()
  src/server/
    index.js               # express, маршруты, /api/health, обработка ошибок
    crm.js                 # кэш метаданных (60 c) + расшифровка enum/статусов + describeEntity
    query.js               # paging / buildFilters / applyOrder (whitelists!)
    routes/{meta,entities,graph,stats,ai}.js
  dev/mock-bitrix.js       # мок REST Битрикс24 для проверки ETL без портала

web/
  src/theme.tsx            # ThemeProvider (antd light/dark algorithm), палитра и цвета графиков
  src/format.ts            # money / даты / стадии
  src/api.ts               # типизированный клиент /api
  src/types.ts             # контракты ответов API
  src/pages/{Dashboard,Companies,Contacts,CompanyCard,ContactCard,Graph}.tsx
  src/components/{SyncControls,GraphView}.tsx
```

Продовый стек: `docker-compose.prod.yml` + `api/Dockerfile.prod` + `web/Dockerfile.prod` (nginx, `/api` → `api:4000`).
Перенос данных и схема «данные только на сервере, локально — Vite с `VITE_API_PROXY`» — `docs/DEPLOY.md`.

## 4. Быстрый старт

```bash
cp .env.example .env          # вписать BITRIX_WEBHOOK_URL
docker compose up -d db adminer api web
docker compose --profile etl run --rm etl      # первая полная выгрузка
# инкрементально (продолжит с last_id): docker compose --profile etl run --rm etl
# полная перевыгрузка:                  docker compose --profile etl run --rm etl npm run etl:full
```

- UI: http://localhost:5173
- API: http://localhost:4000/api/health
- Adminer: http://localhost:8080 (`db` / `bitrix` / `bitrix`)

## 5. Переменные окружения

| Переменная | Назначение |
| --- | --- |
| `BITRIX_WEBHOOK_URL` | `https://portal.bitrix24.ru/rest/1/token` (права `crm`) |
| `DATABASE_URL` | собирается в compose из `POSTGRES_*`, локально задаётся вручную |
| `POSTGRES_DB/USER/PASSWORD/PORT` | креды и порт БД |
| `API_PORT`, `WEB_PORT`, `ADMINER_PORT` | порты хоста |
| `ETL_PAGE_SIZE` | 50 (лимит REST Битрикса, не увеличивать) |
| `ETL_SLEEP_MS` | пауза между страницами, по умолчанию 500 мс (~2 rps) |
| `ETL_MAX_RETRIES` | попытки при сети/429/5xx (по умолчанию 3) |
| `ETL_REQUEST_TIMEOUT_MS` | 55 000 (жёсткий лимит Битрикса — 60 с) |
| `ETL_ENTITY_PAUSE_MS` | пауза между сущностями |
| `REGION_FIELD` | `UF_*`, который считать регионом; пусто → `ADDRESS_PROVINCE/REGION` |

## 6. Модель данных

Нормализованные таблицы + полный ответ API в `raw JSONB`:

- `companies(id, title, industry_id, source_id, city, region, phones JSONB, emails JSONB, search_text, raw, embedding vector(1536), date_create, date_modify, synced_at)`
- `contacts(id, title, name, last_name, second_name, company_id, source_id, phones, emails, search_text, raw, embedding, ...)`
- `deals(id, title, company_id, contact_id, stage_id, category_id, opportunity, currency_id, date_create, date_modify, ...)`
- `leads(id, title, name, last_name, second_name, company_id, contact_id, status_id, source_id, opportunity, currency_id, date_create, date_modify, ...)`
- `bitrix_fields` — метаданные полей (включая `UF_*`, `is_multiple`, `items`).
- `bitrix_enum` — `(entity, field_code, enum_id) → value` (расшифровка `enumeration`).
- `crm_status` — `crm.status.list` (источники, стадии, `semantics` S/F).
- `sync_state` — курсор `last_id`, `status`, `last_error` по сущности.

`PHONE` и `EMAIL` — мультиполя Bitrix и **не входят** в `select: ['*']`; ETL добавляет их явно
(`MULTIFIELD_SELECT` в `run.js`). Если их убрать, телефоны/почты снова окажутся пустыми.

**Правило:** в БД лежат ID справочников, человекочитаемая расшифровка — только в API (`crm.js`).
Цепочка: `enumeration` → `bitrix_enum`; `SOURCE_ID/STAGE_ID` → `crm_status` (fallback по `status_id`);
`boolean` → Да/Нет; массивы и мультиполя (`PHONE`, `EMAIL`) склеиваются в строку.

`search_text` собирается в ETL из **всех** скалярных значений `raw` (рекурсивно) и индексируется
GIN `pg_trgm` — поэтому поиск работает по любым полям, включая `UF_*`.

## 7. ETL — как устроен и что нельзя ломать

Поток `run.js`:

1. `ensureSchema()` → `loadMetadata()` (поля всех сущностей + статусы) → `loadEntity()` для company/contact/deal.
2. Для каждой сущности:
   - `select = ['*', ...ufKeys]` — `UF_*` обязательно добавляются, иначе API их не вернёт;
   - курсор берётся из `sync_state.last_id` (если не `--full`);
   - `fetchAll()`: страница 50 записей → `transformRow()` → `insertPage()` (bulk upsert в транзакции) →
     обновление `sync_state` в **той же** транзакции → `sleep(ETL_SLEEP_MS)`.
3. Ошибка сущности не останавливает остальные: пишется в `sync_state.last_error`, `process.exitCode = 1`.

Жёсткие инварианты (`api/src/bitrix.js`):

- `start: -1` — только для `total` (один запрос на сущность), страницы идут `start: 0` + фильтр `>ID` + `ORDER BY ID ASC`
  (keyset-пагинация: не теряет записи при вставках/удалениях в CRM и не требует OFFSET).
- `ETL_PAGE_SIZE = 50`, `sleep(500)` между страницами, timeout 55 с, retry 3 с backoff
  только для сетевых ошибок / 429 / 5xx / `INTERNAL|QUERY_LIMIT|OVERLOAD`.
- Защита от зацикливания: `lastId` обязан расти, иначе throw.
- Параметры `jsonb` (массивы/объекты) **сериализуются вручную** (`JSON.stringify`): `pg` иначе отправляет
  JS-массив как array-literal и Postgres падает на `jsonb`.
- Никакого накопления всех записей в памяти: батч = страница API.

`--full` сбрасывает курсор и перезаписывает всё (`ON CONFLICT (id) DO UPDATE`).

### Управление выгрузкой из интерфейса

`api/src/server/sync.js` — менеджер одного job'а в процессе API:

- `start` запускает `runEtl()` в фоне и сразу отвечает 202; прогресс отдаётся через `GET /api/sync/status`,
  UI (карточка «Выгрузка из Битрикс24» на дашборде) опрашивает его раз в 2 с.
- `pause/resume/stop` — кооперативные: `fetchAll` вызывает `control.check()` **перед каждым запросом**
  страницы. Пауза/остановка срабатывает максимум через один запрос (~1 c), текущая страница всегда
  дописывается в БД вместе с `sync_state.last_id`, поэтому остановку можно безопасно продолжать.
- Job живёт в памяти процесса: перезапуск контейнера `api` (или `node --watch`) убивает выгрузку,
  но данные и курсор в БД целы — следующий `start` продолжит с `last_id`.
- Только один job на процесс API; параллельный `start` → 409.
- CLI (`docker compose --profile etl run --rm etl`, `npm run etl[:full]`, `npm run mock:bitrix`)
  продолжает работать независимо: `run.js` экспортирует `runEtl()` и запускает CLI только при
  прямом вызове файла.

## 8. Backend API

База: `/api`. Пагинация: `page`, `limit` (≤200). Поиск: `q` (ILIKE по `title`/`search_text`).

| Endpoint | Параметры | Ответ |
| --- | --- | --- |
| `GET /health` | — | `{ok, db, uptime}` (без токена) |
| `POST /auth/login` | body `{login, password}` | `{token, user}`; без токена |
| `GET /auth/me` | — | текущий пользователь по JWT |
| `GET /users` | — | список пользователей (admin) |
| `POST /users` | `{login, password, name?, role}` | создание (admin) |
| `PATCH /users/:id` | `{name?, role?, active?, password?}` | изменение (admin) |
| `DELETE /users/:id` | — | удаление (admin; системного админа и себя нельзя) |
| `GET /fields?entity=company\|contact\|deal\|lead` | `refresh=1` сбросить кэш | поля + `items` для enum/status |
| `GET /companies` | `q, page, limit, sort, dir, industry, source, city, region, assigned_by_id, UF_*` | `{items, page, limit, total, pages}` |
| `GET /companies/:id` | — | профиль + `fields[]` + контакты + сделки (до 500) + `deals_total {count, won, open, sum, open_sum}` + `raw` |
| `GET /contacts` | `q, page, limit, sort, dir, company_id, source, city, without_company=1, UF_*` | список с `company_title` |
| `GET /contacts/:id` | — | контакт + компания + сделки (до 200) + `deals_total` + `fields[]` |
| `GET /deals` | `q, page, limit, sort, dir, company_id, contact_id, stage, category` | список с названиями стадий |
| `GET /deals/:id` | — | сделка + `fields[]` |
| `GET /leads` | `q, page, limit, sort, dir, company_id, contact_id, status, source, city` | список с названиями статусов и источников |
| `GET /leads/:id` | — | лид + компания + контакт + `fields[]` |
| `GET /analytics/overview` | `from`, `to` (ISO-даты периода) | покрытие, выручка/win rate, годы, лиды, источники, топ клиентов, качество данных, рекомендации; без параметров — всё время |
| `GET /embed/status` | — | прогресс векторизации из `service_state['embed']` |
| `GET /admin/overview` | — | размер БД, таблицы/векторы, индексы, настройки, состояние выгрузки и эмбеддингов |
| `POST /admin/actions/:name` | `embed` \| `reconcile` | запуск служебного скрипта отдельным процессом (202) |
| `GET /search/semantic` | `q`, `entity=company\|contact\|deal\|lead`, `limit` | поиск по смыслу: запрос → эмбеддинг → kNN по `embedding` |
| `GET /similar/:entity/:id` | `limit` | ближайшие соседи записи (`{items:[{id,title,score}]}`) |
| `GET /search/duplicates` | `entity`, `threshold` (0.5–0.995), `sample` (≤5000) | кандидаты в дубли: для каждой из последних N записей ближайший сосед выше порога |
| `GET /search/lookalike` | `limit` (≤50), `top` (5–300) | компании, похожие на центроид top-N клиентов по выручке, без успешных сделок |
| `GET /duplicates/summary` | — | пар по сущностям, покрытие векторами, время расчёта |
| `POST /duplicates/run` | body `{threshold}` | фоновый пересчёт `etl/duplicates.js` (202) |
| `GET /duplicates/:entity` | `threshold`, `page`, `limit` | пары A↔B со скором и названиями |
| `GET /duplicates/:entity/pair` | `a`, `b` | поля обеих записей для сравнения |
| `GET /duplicates/:entity/groups` | `threshold`, `page`, `limit` | группы дублей (union-find по парам): размер, min/max скор, `exactGroups` |
| `GET /duplicates/:entity/group` | `ids=1,2,3` | все карточки группы: поля + сделки (count/sum/wonSum + последние 5) |
| `POST /ai/ask` | body `{question}` | RAG: вопрос → эмбеддинг → top-6 компаний / 5 сделок / 4 лида → ответ LLM `{answer, sources[], usage}` |
| `POST /ai/insights` | — | 5–7 выводов через LLM (`POLZA_TOKEN`/`LLM_API_KEY`); без ключа `{configured:false, hint}`; в ответе `usage` (токены, `costRub`) |
| `GET /stats/overview` | `segment=INDUSTRY\|UF_*` | totals, quality, segments, sources, cities, stages, leadStages, timeline |
| `GET /stats/sync` | — | состояние ETL из `sync_state` |
| `GET /sync/status` | — | статус/прогресс текущей выгрузки + журнал |
| `POST /sync/start` | body `{full?, modified?, limit?, entities?, limits?}` | запуск выгрузки (202), 409 если уже идёт; `modified` (по умолчанию `true`) — после инкремента догрузить правки по `DATE_MODIFY` |
| `POST /sync/pause` | — | пауза после текущей страницы |
| `POST /sync/resume` | — | продолжить с паузы |
| `POST /sync/stop` | — | мягкая остановка (курсор сохраняется) |
| `GET /graph/company/:id` | — | `{nodes, links}` Компания → Контакты → Сделки и Лиды |
| `GET /graph/overview?limit=25` | `limit≤100` | топ компаний по числу контактов |
| `GET /ai/company/:id/summary` | `format=text` | JSON-выжимка (`profile, custom_fields, contacts, deals, metrics, data_quality, llm`) |

Безопасность SQL: сортировка — только по whitelist (`SORT` в `entities.js`), фильтры — только
параметризованные значения. `UF_*` фильтры и сортировка принимаются как имя поля и подставляются
**параметром** в `raw->>$n`.

`opportunity` отдаётся как `float8` (в `numeric` `pg` возвращает строку).
Метаданные кэшируются на 60 с — после ETL/изменения справочников подождите или используйте `?refresh=1`.
Профиль большой (51k/103k), поэтому детальные ручки ограничивают вложенные коллекции (`LIMIT 200..500`).

## 8.1. Авторизация и роли

- `api/src/auth.js`: scrypt-хэши (`scrypt$salt$hash`), JWT HS256 на `node:crypto` (без зависимостей),
  middleware `requireAuth` (все `/api/*`, кроме `/api/health` и `/api/auth/login`) и `requireAdmin`.
- Роли: `admin` — полный доступ, `user` — только чтение данных; разделы `/api/admin/*`, `/api/sync/*`,
  `/api/embed/*`, `/api/users/*` и `POST /api/duplicates/run` закрыты `requireAdmin`.
- Системный админ создаётся/обновляется из ENV при старте (`ensureSystemAdmin`), в БД помечен `is_system = true`;
  его нельзя удалить, отключить или понизить.
- Таблица `users(id, login UNIQUE, password_hash, name, role CHECK admin|user, is_system, active, created_at, updated_at)`.
- Без `AUTH_ADMIN_PASSWORD` авторизация выключена (локальный контур): все запросы идут как `admin`.
- ENV: `AUTH_ADMIN_LOGIN` (admin), `AUTH_ADMIN_PASSWORD`, `AUTH_JWT_SECRET` (без него токены живут до перезапуска),
  `AUTH_TOKEN_TTL_H` (24).
- Frontend: `web/src/auth.tsx` (AuthProvider, токен в `localStorage`), `pages/Login.tsx`,
  `components/UsersCard.tsx` (CRUD в админке), при 401 `api.ts` чистит токен и показывает форму входа.

## 9. Frontend

Меню сгруппировано: «Дашборд», «Данные» (компании/контакты/сделки/лиды), «Аналитика» (обзор/граф/дубли),
«Поиск» (по смыслу/похожие клиенты), «Ассистент», «Админка».

Маршруты: `/` (дашборд), `/admin` (управление выгрузкой, прогресс векторизации, системная информация и служебные действия),
`/companies` (таблица), `/companies/:id` (карточка),
`/contacts` (таблица), `/contacts/:id` (карточка), `/graph`, `/graph/:id`.

- UI собран на Ant Design 5 (`ConfigProvider` + `darkAlgorithm`/`defaultAlgorithm`), тема хранится в
  `localStorage` (`crm-analyzer-theme`), переключатель — `Segmented` в шапке. Цвета Recharts берутся из
  токенов через `useChartTheme()`, палитра — `CHART_PALETTE`; не хардкодьте цвета в графиках.
- Vite в Docker запускается с `watch.usePolling = true`: bind-mount на Windows не отдаёт FS-события,
  без polling HMR не подхватывает правки. После изменения `package.json` нужен
  `docker compose build web && docker compose up -d --force-recreate -V web` (новые зависимости живут
  в anonymous-volume `/app/node_modules`).
- Все запросы — через `src/api.ts` (прокси `/api` → `API_PORT`, в compose `http://api:4000`).
- Контракты — `src/types.ts`; при изменении API обновляйте оба файла.
- Карточки компании и контакта декодируют поля **на сервере** и просто рендерят `fields[]`; не дублируйте логику enum в UI.
- Список контактов: фильтры `q/source/city/UF_*`, галочка «только без компании» (`without_company=1`),
  сортировка по `id/title/company/source/date_*`, переход в карточку по клику.
- Граф: `GraphView` меряет контейнер `ResizeObserver`; подписи рисуются только при `scale > 1.1`.
- Кнопка «JSON для LLM» дергает `/ai/company/:id/summary` и показывает/копирует JSON.
- «Аналитика»: период выбирается `Segmented` (текущий месяц по умолчанию, прошлый, 3 месяца, год, всё время);
  границы уходят в `?from=&to=` и фильтруют сделки по `BEGINDATE` и лиды по `date_create`. Покрытие и качество данных — всегда глобальные.
- «Админка»: `SyncControls` + `EmbedProgress` (прогресс по каждой сущности), размер БД, покрытие векторами,
  HNSW-индексы, настройки из `config.js`, кнопки запуска `embed.js` / `reconcile.js`.
- «Поиск по смыслу» (`/search`): `Segmented` по сущности, запрос → `POST`-подобный `GET /search/semantic`,
  блок «Кандидаты в дубли» (порог близости + таблица пар).
- На карточках компании/контакта/сделки/лида — `SimilarBlock`: 6 ближайших соседей по вектору
  (молча скрывается, если вектора нет).
- `api/src/embeddings.js` — общий клиент `/embeddings` (его используют `embed.js` и API; ключ `POLZA_TOKEN`).
- `api/src/llm.js` — общий чат-клиент (`chatComplete`) для `/ai/insights` и `/ai/ask`; без ключа роуты отвечают `{configured:false, hint}`.
- «Потенциальные клиенты» (`/lookalike`) — look-alike: центроид top-N клиентов по выручке → компании без успешных сделок,
  в каждой строке — ближайший топ-клиент («Похожа на»). Это не дубли.
- «Ассистент» (`/assistant`) — RAG-ответ с `Markdown`-рендером и списком источников-ссылок.
- Пагинация списков (`/companies`, `/contacts`, `/deals`, `/leads`) даёт выбор 25/50/100/200: `limit` — состояние страницы,
  смена размера страницы в `onTableChange` сбрасывает `page` на 1.

## 10. Проверка перед сдачей

```bash
# синтаксис backend
cd api && for f in $(find src -name '*.js'); do node --check "$f" || exit 1; done

# типы и сборка frontend
cd web && npx tsc --noEmit && npx vite build

# compose валиден
docker compose config --quiet
```

ETL без реального портала (мок отдаёт 123 компании / 57 контактов / 33 сделки, пагинация 50, `>ID`):

```bash
cd api && npm run mock:bitrix &                 # :5099 (если 5432 занят — POSTGRES_PORT в .env)
DATABASE_URL=postgres://bitrix:bitrix@localhost:5432/bitrix \
BITRIX_WEBHOOK_URL=http://localhost:5099/rest/1/token \
npx node src/etl/run.js

# ожидаемо
# [etl][company] готово: 123 записей ... last_id=123
# [etl][contact] готово: 57 записей  ... last_id=57
# [etl][deal]    готово: 33 записей  ... last_id=33
# повторный запуск: 0 записей (курсор > 123/57/33)
```

Управление выгрузкой без UI:

```bash
curl -X POST localhost:4000/api/sync/start -d '{}' -H 'Content-Type: application/json'
curl localhost:4000/api/sync/status
curl -X POST localhost:4000/api/sync/pause
curl -X POST localhost:4000/api/sync/resume
curl -X POST localhost:4000/api/sync/stop
```

Проверьте после выгрузки: `/api/stats/overview` (totals совпадают), `/api/companies` (поиск/фильтр/сортировка),
`/api/companies/:id` (расшифрованные `UF_*`), `/api/graph/company/:id`, `/api/ai/company/:id/summary`.

## 11. Типовые задачи

**Добавить сущность** — `ENTITIES` в `transform.js` (`key/table/method/fieldsMethod/columns`), таблица в `schema.sql`,
ветка в `transformRow`, загрузка в `run.js` (автоматически из `ENTITY_LIST`), ручки в `entities.js`.

**Добавить поле в таблицу** — колонка в `schema.sql` (+`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` для существующих БД),
колонка в `ENTITIES[*].columns` **в том же порядке**, что и в `transformRow`.

**Поменять «сегменты» на дашборде** — `?segment=UF_CRM_...` (поле должно быть `enumeration` в `bitrix_fields`).

**Встроить эмбеддинги** — `companies.embedding`/`contacts.embedding vector(1536)` уже созданы; заполняйте отдельным
скриптом и добавляйте индекс (`ivfflat`/`hnsw`) после наполнения, не в `schema.sql`.

## 12. Ограничения / долги

- Нет авторизации: API рассчитан на локальный/внутренний контур. Не публиковать в интернет как есть.
- Один портал на инсталляцию (`BITRIX_WEBHOOK_URL`), без OAuth.
- Нет планировщика: ETL запускается кнопкой в UI, curl'ом или кроном; удаления в CRM не отражаются
  (используйте `etl:full`).
- Выгрузка выполняется в процессе API (не отдельный воркер): при нескольких репликах API каждая имела бы
  свой job, а рестарт API прерывает выгрузку (курсор в БД при этом сохранён).
- Дубликаты и связывание контактов с компаниями не исправляются — только отображаются (`contacts_without_company`).
- `utm`-поля и часть `iblock_element`-справочников не расшифровываются (показывается ID).
- `Region` — эвристика (`REGION_FIELD` или адрес); при наличии настоящего UF задайте `REGION_FIELD`.
- Тяжёлые карточки/граф ограничены `LIMIT`; для 100k+ связей нужен серверный обход/кластеризация.
- Чистка тестовых данных: `docker compose down -v`.
