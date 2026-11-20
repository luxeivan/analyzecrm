"""Генерация PDF: pgvector и LLM для анализа CRM (металлическая мебель)."""
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)

FONT_DIR = "C:/Windows/Fonts"
pdfmetrics.registerFont(TTFont("Arial", f"{FONT_DIR}/arial.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Bold", f"{FONT_DIR}/arialbd.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Italic", f"{FONT_DIR}/ariali.ttf"))
pdfmetrics.registerFontFamily("Arial", normal="Arial", bold="Arial-Bold", italic="Arial-Italic")
pdfmetrics.registerFont(TTFont("Consolas", f"{FONT_DIR}/consola.ttf"))

OUT = "pgvector-i-llm-analiz-crm.pdf"

styles = getSampleStyleSheet()
body = ParagraphStyle(
    "Body", parent=styles["BodyText"], fontName="Arial", fontSize=10.2, leading=14.6,
    spaceAfter=6, alignment=TA_LEFT, textColor=colors.HexColor("#1f2937"),
)
h1 = ParagraphStyle("H1", parent=body, fontName="Arial-Bold", fontSize=16, leading=20,
                    spaceBefore=10, spaceAfter=8, textColor=colors.HexColor("#0f172a"))
h2 = ParagraphStyle("H2", parent=body, fontName="Arial-Bold", fontSize=12.2, leading=16,
                    spaceBefore=12, spaceAfter=5, textColor=colors.HexColor("#1d4ed8"))
small = ParagraphStyle("Small", parent=body, fontSize=9, leading=12.5, textColor=colors.HexColor("#475569"))
bullet = ParagraphStyle("Bullet", parent=body, leftIndent=14, bulletIndent=4, spaceAfter=3)
code = ParagraphStyle("Code", parent=body, fontName="Consolas", fontSize=8.4, leading=11.2,
                      backColor=colors.HexColor("#f1f5f9"), borderPadding=6,
                      leftIndent=0, textColor=colors.HexColor("#0f172a"))
title = ParagraphStyle("Title", parent=body, fontName="Arial-Bold", fontSize=26, leading=31,
                       textColor=colors.HexColor("#0f172a"), spaceAfter=6)
subtitle = ParagraphStyle("Sub", parent=body, fontSize=13, leading=18, textColor=colors.HexColor("#334155"))


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Arial", 8)
    canvas.setFillColor(colors.HexColor("#94a3b8"))
    canvas.drawString(20 * mm, 12 * mm, "Bitrix24 CRM Analyzer · werstakoff.ru")
    canvas.drawRightString(190 * mm, 12 * mm, f"стр. {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#e2e8f0"))
    canvas.line(20 * mm, 15 * mm, 190 * mm, 15 * mm)
    canvas.restoreState()


def bullets(items):
    return [Paragraph(f"• {item}", bullet) for item in items]


def table(data, widths, header=True):
    t = Table(data, colWidths=widths, hAlign="LEFT")
    style = [
        ("FONTNAME", (0, 0), (-1, -1), "Arial"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LEADING", (0, 0), (-1, -1), 12),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1d4ed8")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Arial-Bold"),
        ]
    t.setStyle(TableStyle(style))
    return t


story = []

# --- Титул ---
story.append(Spacer(1, 45 * mm))
story.append(Paragraph("pgvector и LLM<br/>для анализа CRM", title))
story.append(Paragraph("Практический план: дедупликация, семантический поиск,<br/>LLM-выводы и RAG-ассистент для производителя металлической мебели", subtitle))
story.append(Spacer(1, 10 * mm))
story.append(Paragraph("Проект: Bitrix24 CRM Analyzer · D:/projects/werstakoffAnalyzeBitrix", body))
story.append(Paragraph("Бизнес: производство и продажа металлической мебели — werstakoff.ru", body))
story.append(Paragraph("Документ: техническое предложение и дорожная карта", small))
story.append(PageBreak())

# --- 1. Что уже есть ---
story.append(Paragraph("1. Что уже есть в системе", h1))
story.append(Paragraph(
    "CRM выгружается из облачного Битрикс24 в PostgreSQL с расширением pgvector. "
    "Сырые ответы API хранятся в JSONB, нормализованные поля — в отдельных колонках, "
    "поиск по тексту работает через pg_trgm. API отдаёт карточки, связи, агрегаты и граф, "
    "интерфейс — дашборд, таблицы и карточки сущностей, страницу «Аналитика» и граф связей.", body))

story.append(Paragraph("Покрытие данных на момент подготовки документа", h2))
story.append(table([
    ["Сущность", "Загружено", "Всего в CRM", "Покрытие"],
    ["Компании", "11 500", "51 171", "22,5%"],
    ["Контакты", "10 000", "103 765", "9,6%"],
    ["Сделки", "10 000", "83 551", "12,0%"],
    ["Лиды", "10 000", "188 294", "5,3%"],
], [45 * mm, 35 * mm, 40 * mm, 30 * mm]))
story.append(Paragraph(
    "Выборка смещена: сделки и лиды выгружались по возрастанию ID, то есть это самые старые записи (реальные даты сделок — 2018–2020). "
    "После полной выгрузки все выводы нужно пересчитать.", small))

story.append(Paragraph("Снимок по загруженным сделкам (для калибровки)", h2))
story.append(table([
    ["Метрика", "Значение"],
    ["Сделок", "10 000"],
    ["Успешные / проваленные / в работе", "7 092 / 2 881 / 27"],
    ["Win rate", "71,1%"],
    ["Сумма по сделкам", "449,4 млн ₽"],
    ["Выручка по успешным", "396,5 млн ₽"],
    ["Средний чек (сумма > 0)", "61,9 тыс. ₽"],
    ["Лиды: конвертировано / JUNK", "4 474 (44,7%) / 5 455 (54,6%)"],
], [95 * mm, 55 * mm]))
story.append(Paragraph(
    "Высокий win rate объясняется историческим характером выборки: в неё почти не попали сделки в работе. "
    "После полной выгрузки метрика станет реалистичной.", small))

story.append(Paragraph("Главные проблемы качества данных", h2))
story += bullets([
    "Телефоны и email не выгружались: PHONE и EMAIL в Bitrix24 — мультиполя, они не входят в select «*». Уже исправлено в ETL, требуется перезагрузка.",
    "95,6% компаний без города, 75,7% без отрасли, 100% без источника — география и каналы в компании не заполнены.",
    "80,4% сделок без контакта: нельзя оценить ЛПР и повторные обращения.",
    "52% контактов без компании; часть ссылок ведёт на невыгруженные компании.",
    "27,4% сделок с нулевой суммой — средний чек и выручка занижены.",
    "842 записи компаний в 359 группах дублей по названию.",
    "DATE_CREATE у всех записей — февраль 2020 (дата миграции в Bitrix), бизнес-даты — в BEGINDATE/CLOSEDATE.",
])
story.append(PageBreak())

# --- 2. pgvector ---
story.append(Paragraph("2. Зачем pgvector и как его задействовать", h1))
story.append(Paragraph(
    "pgvector — расширение PostgreSQL, которое хранит векторы (эмбеддинги) рядом с обычными данными и умеет искать "
    "ближайших соседей по косинусному расстоянию. В схеме уже есть колонки embedding vector(1536) у компаний, "
    "контактов, сделок и лидов и образ pgvector/pgvector:pg16 — осталось заполнить векторы и включить поиск.", body))

story.append(Paragraph("Что даёт векторный поиск в CRM", h2))
story += bullets([
    "<b>Дедупликация.</b> Названия компаний отличаются («ООО Ромашка», «Ромашка, ООО», «Ромашка-М»), а телефоны и email заполнены не всегда. "
    "Эмбеддинг профиля (название + адрес + сайт + контакты) ловит смысловые совпадения там, где trgm и точное сравнение бессильны.",
    "<b>Семантический поиск.</b> Запрос «клиенты, которым нужны стеллажи для склада» находит карточки по смыслу, а не по вхождению слова.",
    "<b>Похожие клиенты (look-alike).</b> Для компании с высокой выручкой находим 20 ближайших по профилю — это готовый список для допродаж.",
    "<b>Кластеризация базы.</b> KMeans по эмбеддингам делит клиентов на сегменты (офисы, склады, производство, госзаказ) без ручных правил.",
    "<b>RAG-ассистент.</b> Вопрос «что мы обещали этому клиенту по срокам?» ищет релевантные карточки и комментарии, а LLM формулирует ответ.",
    "<b>Поиск по комментариям.</b> Свободные тексты менеджеров индексируются и находятся по смыслу — сейчас они почти не используются.",
])

story.append(Paragraph("Как это включить: пошагово", h2))
story.append(Paragraph(
    "1. Выбрать модель эмбеддингов. Вариант по умолчанию — OpenAI text-embedding-3-small (1536 измерений, дешёвая, "
    "хорошо работает по-русски). Локальный вариант — bge-m3 (1024) или multilingual-e5-large (1024): тогда колонки "
    "нужно привести к vector(1024).", body))
story.append(Paragraph(
    "2. Собрать текст профиля. Для компании: название, отрасль, город/регион, сайт, телефоны, email, ключевые UF-поля. "
    "Для контакта: ФИО, должность, компания, контакты. Для сделки: название, стадия, сумма, комментарии. "
    "Важно: нормализовать регистр, убрать мусор, обрезать до ~6 000 символов.", body))
story.append(Paragraph("3. Заполнить векторы батчами (пример на Node.js):", body))
story.append(Preformatted(
    "const text = buildProfileText(company);            // нормализованный профиль\n"
    "const { data } = await openai.embeddings.create({\n"
    "  model: 'text-embedding-3-small', input: text,\n"
    "});\n"
    "await query('UPDATE companies SET embedding = $1 WHERE id = $2',\n"
    "  [JSON.stringify(data[0].embedding), company.id]);",
    code))
story.append(Paragraph("4. Построить HNSW-индекс под косинусное расстояние:", body))
story.append(Preformatted(
    "CREATE INDEX companies_embedding_hnsw\n"
    "  ON companies USING hnsw (embedding vector_cosine_ops)\n"
    "  WITH (m = 16, ef_construction = 64);\n"
    "-- настройка скорости/точности на сессию:\n"
    "SET hnsw.ef_search = 100;",
    code))
story.append(Paragraph("5. Искать похожие записи и кандидатов в дубли:", body))
story.append(Preformatted(
    "-- 10 ближайших компаний к компании :id\n"
    "SELECT c.id, c.title,\n"
    "       1 - (c.embedding <=> src.embedding) AS similarity\n"
    "  FROM companies c, (SELECT embedding FROM companies WHERE id = :id) src\n"
    " WHERE c.id <> :id AND c.embedding IS NOT NULL\n"
    " ORDER BY c.embedding <=> src.embedding\n"
    " LIMIT 10;\n\n"
    "-- кандидаты в дубли: similarity >= 0.92\n"
    "SELECT a.id, b.id, 1 - (a.embedding <=> b.embedding) AS sim\n"
    "  FROM companies a JOIN companies b ON a.id < b.id\n"
    " WHERE a.embedding IS NOT NULL AND b.embedding IS NOT NULL\n"
    "   AND 1 - (a.embedding <=> b.embedding) >= 0.92\n"
    " ORDER BY sim DESC;",
    code))
story.append(Paragraph(
    "Порог подбирается на размеченной выборке: 0,90–0,92 — кандидат на ручную проверку, 0,95+ — почти наверняка дубль. "
    "Важно не удалять автоматически: сначала отчёт «возможные дубли» в интерфейсе, затем слияние вручную или полуавтоматически.", body))

story.append(Paragraph("Порядок цифр", h2))
story += bullets([
    "213 тыс. карточек (компании + контакты + сделки) × ~200 токенов ≈ 40–45 млн токенов.",
    "text-embedding-3-small: около 0,02 $ за 1 млн токенов → ~1 $ за первичную индексацию всей базы.",
    "Пересчёт — только для изменённых записей (по date_modify), это единицы процентов в день.",
    "Хранение: 213 тыс. × 1536 × 4 байта ≈ 1,3 ГБ — PostgreSQL справляется без выделенного сервера.",
    "Локальная модель (bge-m3) снимает стоимость API, но требует GPU/CPU-времени и даёт 1024 измерения.",
])
story.append(PageBreak())

# --- 3. LLM ---
story.append(Paragraph("3. LLM: где подключать и что получим", h1))
story.append(Paragraph(
    "В системе уже есть точки интеграции: сводка по компании для LLM (/api/ai/company/:id/summary) и новый "
    "эндпоинт /api/ai/insights, который отдаёт агрегаты CRM в модель и возвращает управленческие выводы. "
    "Интерфейс — блок «Выводы LLM» на странице «Аналитика».", body))
story.append(Paragraph("Настройка (OpenAI-совместимый API: OpenAI, OpenRouter, Ollama, vLLM)", h2))
story.append(Preformatted(
    "# .env\n"
    "LLM_API_KEY=sk-...\n"
    "LLM_BASE_URL=https://api.openai.com/v1   # или http://localhost:11434/v1\n"
    "LLM_MODEL=gpt-4o-mini                    # или llama3.1:8b, qwen2.5:14b",
    code))
story.append(Paragraph(
    "Провайдер Polza.ai подключается одной переменной: POLZA_TOKEN + POLZA_MODEL (например, "
    "deepseek/deepseek-v4.1-flash-1017), LLM_BASE_URL подставляется автоматически. Замер на реальных данных: "
    "один прогон аналитики — 1 292 входных + 1 712 выходных токенов (из них 1 162 — рассуждения), всего 3 004 токена, "
    "стоимость 0,12 ₽ и около 10 секунд. Этого достаточно для ежедневного анализа воронки и сводок по клиентам.", body))
story.append(Paragraph(
    "Без ключа страница не падает: блок показывает инструкцию, остальная аналитика работает. "
    "После добавления ключа и перезапуска api появляется кнопка «Сгенерировать выводы».", body))

story.append(Paragraph("Сценарии с реальной пользой для производителя мебели", h2))
story.append(table([
    ["Сценарий", "Что делает LLM", "Данные"],
    ["Сводка по клиенту", "Кто клиент, что покупал, риски, следующий шаг", "карточка + сделки + контакты"],
    ["Скоринг лидов", "Оценивает вероятность сделки по тексту заявки и источнику", "лиды + история конверсии"],
    ["Черновик КП / письма", "Пишет письмо под сегмент (склад, офис, цех) и историю клиента", "профиль + прошлые сделки"],
    ["Разбор комментариев", "Извлекает возражения, сроки, конкурентов в структурированные поля", "comments, raw JSONB"],
    ["Ассистент по базе (RAG)", "Отвечает на вопросы по клиентам и договорённостям", "pgvector + LLM"],
    ["Аналитик воронки", "Объясняет провалы, сезонность, аномалии", "агрегаты /api/analytics"],
], [42 * mm, 78 * mm, 50 * mm]))

story.append(Paragraph("Рабочая схема RAG-ассистента", h2))
story.append(Preformatted(
    "вопрос пользователя\n"
    "      │\n"
    "      ├─► embedding вопроса (та же модель)\n"
    "      │\n"
    "      ├─► pgvector: top-K карточек/комментариев (cosine, HNSW)\n"
    "      │\n"
    "      ├─► сборка контекста: профиль, сделки, заметки (только нужные поля)\n"
    "      │\n"
    "      └─► LLM: ответ + ссылки на карточки (id), без выдуманных цифр",
    code))
story.append(Paragraph("Что важно предусмотреть", h2))
story += bullets([
    "<b>Проверка цифр.</b> Все числа брать из SQL и передавать в промпт готовыми; модели запрещать считать самостоятельно.",
    "<b>Персональные данные.</b> Отправлять минимум (без лишних телефонов/email), логировать запросы, по возможности использовать локальную модель.",
    "<b>Стоимость и лимиты.</b> Кэшировать сводки по клиентам (TTL 1–7 дней), ограничивать max_tokens, ставить rate limit на пользователя.",
    "<b>Галлюцинации.</b> Для RAG — требовать цитирование id карточек и показывать источники рядом с ответом.",
    "<b>Версионирование промптов.</b> Хранить шаблоны в репозитории и логировать, какая версия дала ответ.",
])
story.append(PageBreak())

# --- 4. Страница Аналитика ---
story.append(Paragraph("4. Что уже появилось в интерфейсе", h1))
story.append(Paragraph(
    "Новый раздел «Аналитика» собирает бизнес-метрики и качество данных в одном месте:", body))
story += bullets([
    "Покрытие данных по 4 сущностям: загружено / всего в CRM / процент.",
    "KPI: выручка по успешным сделкам, средний чек, win rate, доля повторных клиентов, лиды и конверсия.",
    "Графики: выручка по годам (BEGINDATE), статусы лидов, источники лидов (конверсия vs JUNK), география выручки.",
    "Топ-10 компаний по выручке и динамика по месяцам.",
    "Таблица качества данных: телефоны, города, отрасли, связи сделок и контактов, дубли.",
    "Рекомендации с приоритетами и конкретными действиями.",
    "Блок «Выводы LLM» (появляется после настройки ключа).",
])
story.append(Paragraph(
    "Страница считает метрики на сервере (/api/analytics/overview) и не зависит от того, открыт ли LLM. "
    "Покрытие берётся из портала (total страницы crm.*.list) с кэшем 10 минут.", body))

# --- 5. Дорожная карта ---
story.append(Paragraph("5. Дорожная карта внедрения", h1))
story.append(table([
    ["Этап", "Содержание", "Результат", "Оценка"],
    ["0. Данные", "Полная выгрузка 4 сущностей, PHONE/EMAIL в select, разбор адресов, пересчёт аналитики",
     "Честные метрики и география", "1–2 дня (машинное время)"],
    ["1. Дедупликация", "Эмбеддинги компаний/контактов, HNSW, отчёт «возможные дубли», ручное слияние",
     "Чистая база, корректные повторные продажи", "3–5 дней"],
    ["2. Сегменты", "Кластеризация и look-alike по эмбеддингам, сегменты в карточке клиента",
     "Списки для допродаж и рассылок", "3–4 дня"],
    ["3. LLM-сводки", "Кэшированные сводки по клиентам и по воронке, кнопка в UI",
     "Экономия времени менеджеров и аналитика", "2–3 дня"],
    ["4. RAG-ассистент", "Индекс карточек и комментариев, чат с источниками",
     "Быстрый доступ к истории клиента", "5–7 дней"],
    ["5. Скоринг", "Модель вероятности сделки на истории + LLM-объяснение",
     "Приоритизация лидов", "7–10 дней"],
], [26 * mm, 68 * mm, 52 * mm, 24 * mm]))
story.append(Paragraph(
    "Критично начинать с этапа 0: пока загружено 5–22% данных, любые модели и выводы будут смещены.", body))

# --- 6. Рекомендации по данным ---
story.append(Paragraph("6. Правила работы с данными (чтобы аналитика не врала)", h1))
story += bullets([
    "Обязательные поля сделки: компания, контакт, сумма, дата начала (BEGINDATE). Без них воронка и выручка неполные.",
    "Не использовать DATE_CREATE для динамики: это дата миграции. Всегда BEGINDATE/CLOSEDATE.",
    "Один клиент = одна карточка компании. Правило дедупликации: домен email → телефон → название+адрес → эмбеддинг.",
    "Источник проставлять при конвертации лида в компанию, иначе каналы не посчитать.",
    "Заполнять город/регион из адресных полей автоматически в ETL.",
    "Нулевые суммы — отдельный отчёт: либо заполнить, либо исключать из среднего чека (уже так считается).",
    "Регулярный контроль качества: раз в неделю смотреть блок «Качество данных» и следить за трендом.",
])

story.append(Paragraph("Итог", h1))
story.append(Paragraph(
    "pgvector в этом проекте — не эксперимент, а дешёвый и практичный инструмент: 1–2 $ на индексацию всей базы, "
    "хранение в той же PostgreSQL, знакомая SQL-семантика. Вместе с LLM он превращает CRM из «таблицы клиентов» "
    "в рабочий инструмент: чистые дубли, умный поиск, готовые сводки и ассистент, который помнит историю каждого клиента.", body))
story.append(Spacer(1, 6))
story.append(Paragraph(
    "Документ подготовлен для проекта Bitrix24 CRM Analyzer. Технические детали — в AGENTS.md и README.md репозитория.", small))

doc = BaseDocTemplate(
    OUT, pagesize=A4,
    leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=20 * mm,
    title="pgvector и LLM для анализа CRM", author="Bitrix24 CRM Analyzer",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=header_footer)])
doc.build(story)
print(f"OK {OUT}")
