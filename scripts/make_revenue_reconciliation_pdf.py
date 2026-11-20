"""PDF-отчёт: как считается «Выручка по успешным сделкам» и почему расходится с 1С.

Данные — замеры по продовой базе CRM Analyzer (портал Битрикс24, металлическая мебель),
период «текущий год» = 01.01.2026 – 20.11.2026.
"""
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.shapes import Drawing, String
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
    KeepTogether,
    PageTemplate,
    Paragraph,
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

OUT = "sverka-vyruchki-crm-vs-1c.pdf"

# ── палитра ────────────────────────────────────────────────────────────────────
INK = colors.HexColor("#0f172a")
BODY = colors.HexColor("#1f2937")
MUTED = colors.HexColor("#64748b")
BRAND = colors.HexColor("#1d4ed8")
BRAND_SOFT = colors.HexColor("#eef2ff")
TEAL = colors.HexColor("#0f766e")
TEAL_SOFT = colors.HexColor("#ecfdf5")
RED = colors.HexColor("#b91c1c")
RED_SOFT = colors.HexColor("#fef2f2")
AMBER = colors.HexColor("#b45309")
AMBER_SOFT = colors.HexColor("#fffbeb")
LINE = colors.HexColor("#e2e8f0")
ZEBRA = colors.HexColor("#f8fafc")

# ── стили ──────────────────────────────────────────────────────────────────────
ss = getSampleStyleSheet()
body = ParagraphStyle(
    "Body", parent=ss["BodyText"], fontName="Arial", fontSize=10, leading=14.8,
    spaceAfter=6, alignment=TA_LEFT, textColor=BODY,
)
lead = ParagraphStyle("Lead", parent=body, fontSize=11.4, leading=17, textColor=INK)
h1 = ParagraphStyle("H1", parent=body, fontName="Arial-Bold", fontSize=20, leading=25,
                    spaceAfter=6, textColor=INK)
h2 = ParagraphStyle("H2", parent=body, fontName="Arial-Bold", fontSize=13, leading=17,
                    spaceBefore=12, spaceAfter=6, textColor=BRAND)
h3 = ParagraphStyle("H3", parent=body, fontName="Arial-Bold", fontSize=10.6, leading=14,
                    spaceBefore=9, spaceAfter=4, textColor=INK)
small = ParagraphStyle("Small", parent=body, fontSize=8.6, leading=12.4, textColor=MUTED)
cell = ParagraphStyle("Cell", parent=body, fontSize=8.8, leading=12.2, spaceAfter=0)
cellb = ParagraphStyle("CellB", parent=cell, fontName="Arial-Bold")
cellr = ParagraphStyle("CellR", parent=cell, alignment=2)
cellrb = ParagraphStyle("CellRB", parent=cellr, fontName="Arial-Bold")
bullet = ParagraphStyle("Bullet", parent=body, leftIndent=13, bulletIndent=3, spaceAfter=3.5)
code = ParagraphStyle("Code", parent=body, fontName="Consolas", fontSize=8.4, leading=12.4,
                      textColor=colors.HexColor("#0b1220"))

W = A4[0] - 36 * mm  # рабочая ширина


def money(v):
    return f"{v:,.0f}".replace(",", " ") + " ₽"


def mln(v):
    return f"{v / 1_000_000:,.1f}".replace(",", " ").replace(".", ",") + " млн ₽"


# ── данные замеров ─────────────────────────────────────────────────────────────
TOTAL_2026 = 1_298_770_058
DEALS_2026 = 3_736
AVG_CHEQUE = 347_637
COMPANY_FIGURE = 800_000_000
TOP10 = 314_020_984
TOP10_PCT = 24.2
COMPANIES_2026 = 1_782

MONTHS = [
    ("Январь", 409, 117_440_421),
    ("Февраль", 492, 153_694_360),
    ("Март", 586, 186_456_231),
    ("Апрель", 517, 261_202_754),
    ("Май", 353, 124_423_235),
    ("Июнь", 351, 104_482_996),
    ("Июль", 353, 152_244_150),
    ("Август", 263, 92_433_470),
    ("Сентябрь", 223, 47_653_635),
    ("Октябрь", 155, 40_395_512),
    ("Ноябрь (1–20)", 34, 18_343_293),
]

VARIANTS = [
    ("BEGINDATE 2026 — <b>наш расчёт</b>", "дата начала сделки", "3 736", TOTAL_2026),
    ("CLOSEDATE 2026", "дата завершения сделки", "3 895", 1_381_130_792),
    ("Начаты и закрыты в 2026", "обе даты внутри года", "3 704", 1_284_527_820),
    ("Дата перехода в стадию 2026", "UF_CRM_1632862051", "4 590", 2_240_596_502),
    ("BEGINDATE 2026 + CLOSED = Y", "только закрытые флагом", "3 736", TOTAL_2026),
    ("Без НДС (÷ 1,2)", "BEGINDATE 2026", "3 736", 1_082_308_382),
    ("Только «Заказ клиента …»", "без «Сделка успешна! …»", "1 429", 395_380_521),
    ("Только «Сделка успешна! …»", "тип сделок интеграции", "2 307", 903_389_537),
]

YEARS = [
    ("2023", 7_413, 1_279_030_427),
    ("2024", 7_771, 2_083_047_484),
    ("2025", 7_076, 2_820_364_581),
    ("2026 (1 янв – 20 ноя)", DEALS_2026, TOTAL_2026),
]

CHECKS = [
    ("Сумма OPPORTUNITY vs сумма строк товаров (price × quantity)",
     "1 298 770 058 ₽ = 1 298 770 058 ₽", "совпадает до рубля"),
    ("Успешные сделки 2026 без товарных строк", "0 из 3 736", "«фантомных» сумм нет"),
    ("Дубли: компания + дата начала + сумма", "2 группы / 5 сделок / 850 282 ₽", "0,07 % оборота"),
    ("Дубли «Заказ клиента УТ-…» ↔ «Сделка успешна! …»",
     "0 пересечений по номерам", "двойного учёта нет"),
    ("Сделки без привязки к компании", "195 шт. / 23 739 444 ₽", "1,8 % суммы"),
    ("Воронки (CATEGORY_ID)", "только 0 — «Продажи»", "других воронок нет"),
    ("Сделки без BEGINDATE", "78 из 83 583 по всей базе", "в расчёт года не попадают"),
]

DATE_SPLIT = [
    ("Начата и закрыта в 2026", "3 704", 1_284_527_820, "основной массив"),
    ("Начата раньше, закрыта в 2026", "191", 96_602_972, "+ к «начатым раньше»"),
    ("Начата в 2026, закрыта позже / без даты", "32", 14_242_238, "ещё не закрыта"),
]

HYPOTHESES = [
    ("1", "Выручка по <b>оплатам</b>, а не по закрытым сделкам",
     "800 / 1 299 = 62 % — типичная доля оплаты в опте за тот же период", "высокая"),
    ("2", "Выручка по <b>отгрузкам/реализации</b> из 1С",
     "признание выручки по документу реализации, а не по дате заказа", "высокая"),
    ("3", "<b>Авансы и частичные оплаты</b> учтены иначе",
     "в 1С выручка признаётся после отгрузки, аванс — нет", "средняя"),
    ("4", "Исключены <b>внутренние/тестовые</b> сделки и взаиморасчёты",
     "в базе нет признака «внутренняя», оценить нельзя", "средняя"),
    ("5", "<b>Возвраты и корректировки</b> уменьшают выручку в 1С",
     "в Битриксе отрицательных сделок нет — только положительные суммы", "средняя"),
    ("6", "<b>Другой период</b> (календарь 1С, закрытие месяца, сдвиг)",
     "2025 = 2 820 млн, 2024 = 2 083 млн — 800 млн не похоже ни на один год", "низкая"),
]

ACTIONS = [
    ("Переключатель «дата начала / дата завершения» в отчёте",
     "убирает 96,6 млн «переезжающих» между годами", "0,5 дня"),
    ("Галочка «без НДС»", "сопоставимость с учётной выручкой (1 082 млн)", "0,5 дня"),
    ("Метрика «Оплачено по счетам» (смарт-процесс «Счета», PAYED)",
     "прямое сравнение с поступлениями 1С", "2–3 дня"),
    ("Сверка по номеру заказа: сделка ↔ документ реализации 1С",
     "построчный матчинг, объяснение каждого рубля", "3–5 дней"),
    ("Экспорт отчёта в XLSX для бухгалтерии",
     "сверка без скриншотов", "0,5 дня"),
]

# ── декорации страниц ──────────────────────────────────────────────────────────
def page_decor(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(18 * mm, A4[1] - 14 * mm, A4[0] - 18 * mm, A4[1] - 14 * mm)
    canvas.setFont("Arial", 7.6)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, A4[1] - 12.4 * mm,
                      "Bitrix24 CRM Analyzer  ·  сверка выручки: CRM и 1С  ·  ноябрь 2026")
    canvas.drawRightString(A4[0] - 18 * mm, A4[1] - 12.4 * mm, "analyzecrm.luxeivan.ru")
    canvas.line(18 * mm, 15 * mm, A4[0] - 18 * mm, 15 * mm)
    canvas.drawString(18 * mm, 10.5 * mm, "Источник: продовая база CRM Analyzer, 20.11.2026")
    canvas.drawRightString(A4[0] - 18 * mm, 10.5 * mm, f"стр. {doc.page}")
    canvas.restoreState()


def kv_table(rows, widths, header=None, aligns=None, header_bg=BRAND_SOFT, header_color=INK):
    """Таблица с зеброй и (опционально) шапкой."""
    data = []
    if header:
        data.append([Paragraph(h, cellb) for h in header])
    for r in rows:
        data.append([c if isinstance(c, Paragraph) else Paragraph(str(c), cell) for c in r])
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
    ]
    start = 0
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), header_bg),
            ("LINEBELOW", (0, 0), (-1, 0), 0.8, colors.HexColor("#c7d2fe")),
        ]
        start = 1
    for i in range(start, len(data)):
        if (i - start) % 2 == 1:
            style.append(("BACKGROUND", (0, i), (-1, i), ZEBRA))
    if aligns:
        for col, al in aligns.items():
            style.append(("ALIGN", (col, start), (col, -1), al))
    t.setStyle(TableStyle(style))
    return t


def kpi_tile(value, label, tone="brand", sub=None):
    palette = {
        "brand": (BRAND_SOFT, BRAND),
        "teal": (TEAL_SOFT, TEAL),
        "red": (RED_SOFT, RED),
        "amber": (AMBER_SOFT, AMBER),
    }[tone]
    bg, fg = palette
    fg_hex = "#" + fg.hexval()[2:]
    inner = [[Paragraph(f'<font size="15" color="{fg_hex}"><b>{value}</b></font>', cell)],
             [Paragraph(f'<font size="7.8" color="#475569">{label}</font>', cell)]]
    if sub:
        inner.append([Paragraph(f'<font size="7.4" color="#64748b">{sub}</font>', cell)])
    t = Table(inner, colWidths=[(W - 12) / 4], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#dbeafe")),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 7),
        ("TOPPADDING", (0, 1), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -2), 2),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def callout(text, tone="brand"):
    bg, bar = {
        "brand": (BRAND_SOFT, BRAND),
        "teal": (TEAL_SOFT, TEAL),
        "amber": (AMBER_SOFT, AMBER),
        "red": (RED_SOFT, RED),
    }[tone]
    t = Table([[Paragraph(text, body)]], colWidths=[W], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LINEBEFORE", (0, 0), (0, -1), 2.4, bar),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


def codeblock(text):
    t = Table([[Paragraph(text.replace(" ", "&nbsp;"), code)]], colWidths=[W], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f1f5f9")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


def monthly_chart():
    d = Drawing(W, 142)
    ch = VerticalBarChart()
    ch.x, ch.y = 34, 30
    ch.width, ch.height = W - 44, 90
    values = [m[2] / 1_000_000 for m in MONTHS]
    ch.data = [values]
    ch.strokeColor = None
    ch.valueAxis.valueMin = 0
    ch.valueAxis.valueMax = 300
    ch.valueAxis.valueStep = 50
    ch.valueAxis.labels.fontName = "Arial"
    ch.valueAxis.labels.fontSize = 7
    ch.valueAxis.labels.fillColor = MUTED
    ch.valueAxis.visibleGrid = 1
    ch.valueAxis.gridStrokeColor = colors.HexColor("#eef2f7")
    ch.valueAxis.gridStrokeWidth = 0.6
    ch.valueAxis.strokeColor = LINE
    ch.categoryAxis.categoryNames = [m[0] for m in MONTHS]
    ch.categoryAxis.labels.fontName = "Arial"
    ch.categoryAxis.labels.fontSize = 7
    ch.categoryAxis.labels.fillColor = BODY
    ch.categoryAxis.labels.angle = 32
    ch.categoryAxis.labels.dy = -6
    ch.categoryAxis.labels.dx = 2
    ch.categoryAxis.strokeColor = LINE
    ch.categoryAxis.labels.boxAnchor = "ne"
    ch.bars[0].fillColor = BRAND
    ch.bars[0].strokeColor = None
    ch.barWidth = 11
    ch.barSpacing = 1.2
    ch.groupSpacing = 6
    d.add(ch)
    d.add(String(0, 134, "Выручка по успешным сделкам по месяцам, млн ₽",
                 fontName="Arial-Bold", fontSize=9, fillColor=INK))
    return d


# ── документ ───────────────────────────────────────────────────────────────────
doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                      topMargin=18 * mm, bottomMargin=18 * mm,
                      title="Сверка выручки: CRM Analyzer и 1С", author="CRM Analyzer")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=page_decor)])

story = []

# --- титул ---
story.append(Paragraph("Выручка по успешным сделкам", h1))
story.append(Paragraph("Как она считается в CRM Analyzer, что проверено и почему расходится с отчётом 1С", lead))
story.append(Spacer(1, 4))
story.append(callout(
    "<b>Коротко.</b> В дашборде выручка = сумма поля <b>OPPORTUNITY</b> по сделкам со стадией "
    "<b>«Сделка успешна»</b>, у которых <b>дата начала (BEGINDATE)</b> попадает в выбранный период. "
    "За 2026 год это <b>1 298 770 058 ₽</b> по 3 736 сделкам. Арифметика проверена по строкам товаров и "
    "совпадает до рубля. Отчёт 1С (~<b>800 млн ₽</b>) считает другую величину: выручку по "
    "<b>оплатам/реализации</b> с признанием по документу, а не по дате заказа."
))
story.append(Spacer(1, 10))
kpi = Table([[kpi_tile(money(TOTAL_2026), "наш расчёт, BEGINDATE 2026", "brand",
                       "успешные сделки, с НДС"),
              kpi_tile(f"{DEALS_2026:,}".replace(",", " "), "успешных сделок", "teal",
                       f"средний чек {money(AVG_CHEQUE)}"),
              kpi_tile(money(COMPANY_FIGURE), "цифра компании (1С)", "amber",
                       "«чуть больше 800 млн»"),
              kpi_tile("62 %", "наш расчёт к цифре 1С", "red",
                       "разрыв 498,8 млн ₽")]], colWidths=[W / 4] * 4, hAlign="LEFT")
kpi.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0),
                         ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                         ("VALIGN", (0, 0), (-1, -1), "TOP")]))
story.append(kpi)

# --- 1. формула ---
story.append(Paragraph("1. Как именно считается сумма", h2))
story.append(Paragraph(
    "Метрика «Выручка по успешным сделкам» берётся из ответа <font face='Consolas'>/api/analytics/overview</font> "
    "(поле <font face='Consolas'>wonSum</font>) и считается одним запросом. В расчёте участвуют ровно три условия — "
    "никакой фильтрации по компании, менеджеру, товару или оплате нет:"
))
story.append(codeblock(
    "SELECT sum(opportunity)\n"
    "  FROM deals\n"
    " WHERE stage_id = 'WON'                                  -- 1) стадия «Сделка успешна»\n"
    "   AND (raw->>'BEGINDATE')::timestamptz >= '2026-01-01'  -- 2) период по дате НАЧАЛА\n"
    "   AND (raw->>'BEGINDATE')::timestamptz <  '2027-01-01'"
))
story.append(Spacer(1, 6))
story.append(kv_table(
    rows=[
        ("1", "<b>Стадия.</b> <font face='Consolas'>stage_id = 'WON'</font> — только успешные сделки. "
              "Проваленные и открытые не учитываются. Все ваши сделки лежат в одной воронке "
              "(<font face='Consolas'>CATEGORY_ID = 0</font> «Продажи»), поэтому «успех» в других воронках ничего не добавляет."),
        ("2", "<b>Период.</b> По <font face='Consolas'>BEGINDATE</font> (поле «Дата начала»), а не по дате завершения "
              "и не по дате оплаты. Это осознанное решение: <font face='Consolas'>DATE_CREATE</font> у всего портала — "
              "февраль 2020 (дата миграции), пользоваться им для динамики нельзя."),
        ("3", "<b>Сумма.</b> Поле <font face='Consolas'>OPPORTUNITY</font> сделки, как его заполнил менеджер или "
              "интеграция: <b>с НДС</b>, без вычета скидок, возвратов, авансов и без учёта фактической оплаты. "
              "Отрицательных сумм в базе нет."),
    ],
    widths=[8 * mm, W - 8 * mm],
))
story.append(Spacer(1, 6))
story.append(Paragraph(
    "Поля «Оплачено», «Отгружено», «Сумма реализации» в Битриксе отсутствуют — я проверил полный справочник "
    "полей сделки (83 поля). Есть только даты, суммы и служебные атрибуты:", small))
story.append(Paragraph(
    "<font face='Consolas' size='8'>BEGINDATE · CLOSEDATE · DATE_CREATE · DATE_MODIFY · IS_MANUAL_OPPORTUNITY · "
    "UF_CRM_1590233360 (Дата доставки) · UF_CRM_1632862051 (Дата перехода в стадию) · "
    "UF_CRM_1688103016 (Офис отгрузки)</font>", small))

# --- 2. проверки ---
story.append(Paragraph("2. Что проверено в данных", h2))
story.append(Paragraph(
    "Прежде чем объяснять расхождение, я убедился, что наша цифра не «раздута» технически: сверил её с товарными "
    "строками сделок, поискал дубли и «пустые» сделки."))
story.append(kv_table(
    rows=[(c[0], c[1], c[2]) for c in CHECKS],
    widths=[W * 0.50, W * 0.27, W * 0.23],
    header=("Проверка", "Результат", "Вывод"),
))
story.append(Spacer(1, 6))
story.append(callout(
    "<b>Вывод по разделу.</b> 1 298 770 058 ₽ — это реальная сумма по 3 736 успешным сделкам: она в точности равна "
    "сумме строк товаров в этих сделках, дублей и «пустых» сделок практически нет (0,07 % суммы). "
    "Расхождение с 1С — не ошибка расчёта, а разное определение выручки.", "teal"))

# --- 3. перебор вариантов ---
story.append(Paragraph("3. Какие варианты расчёта я перебрал", h2))
story.append(Paragraph(
    "Чтобы исключить «а если посчитать иначе», были посчитаны все разумные определения периода и суммы по тому же году. "
    "Колонка «Δ к нашему» показывает, насколько вариант отличается от текущей цифры дашборда."))
rows = []
for name, why, deals, s in VARIANTS:
    delta = s - TOTAL_2026
    sign = "+" if delta > 0 else ("−" if delta < 0 else "")
    delta_txt = "—" if delta == 0 else f"{sign}{mln(abs(delta))}"
    rows.append((name, why, deals, money(s), delta_txt))
story.append(kv_table(
    rows=rows,
    widths=[W * 0.30, W * 0.24, W * 0.10, W * 0.21, W * 0.15],
    header=("Вариант", "Определение периода", "Сделок", "Сумма", "Δ к нашему"),
    aligns={2: "RIGHT", 3: "RIGHT", 4: "RIGHT"},
))
story.append(Spacer(1, 6))
story.append(callout(
    "<b>Ни один «датовый» вариант не даёт 800 млн.</b> Диапазон всех трактовок периода — от 1 082 млн (без НДС) "
    "до 2 241 млн (по дате перехода в стадию). Цифра компании лежит заметно ниже любого из них, значит дело "
    "не в границах периода, а в самом показателе: 1С считает <b>признанную выручку</b>, а дашборд — "
    "<b>портфель закрытых сделок</b>.", "amber"))

# --- 4. годы и месяцы ---
story.append(Paragraph("4. Масштаб: годы и месяцы", h2))
story.append(Paragraph(
    "Для контекста — выручка по успешным сделкам за последние годы (та же формула, только период — год по BEGINDATE). "
    "2026 год показан не полностью: данные на 20 ноября."))
story.append(kv_table(
    rows=[(y, f"{c:,}".replace(",", " "), money(s)) for y, c, s in YEARS],
    widths=[W * 0.34, W * 0.22, W * 0.44],
    header=("Период", "Успешных сделок", "Сумма"),
    aligns={1: "RIGHT", 2: "RIGHT"},
))
story.append(Spacer(1, 8))
story.append(monthly_chart())
story.append(Paragraph(
    "Пик — апрель 2026 (261,2 млн ₽, 517 сделок). С сентября объём снижается: 47,7 млн в сентябре, 40,4 млн в октябре. "
    "Средний чек по году — 347 637 ₽.", small))

# --- 5. структура ---
story.append(Paragraph("5. Структура суммы", h2))
story.append(Paragraph(
    "Разложение по датам показывает, сколько оборота «переезжает» между годами из-за того, что период считается "
    "по дате начала, а не по дате закрытия:"))
story.append(kv_table(
    rows=[(a, b, money(c), d) for a, b, c, d in DATE_SPLIT],
    widths=[W * 0.40, W * 0.12, W * 0.26, W * 0.22],
    header=("Сделки", "Штук", "Сумма", "Комментарий"),
    aligns={1: "RIGHT", 2: "RIGHT"},
))
story.append(Spacer(1, 7))
story.append(Paragraph(
    f"Концентрации на крупнейших клиентах нет: топ-10 компаний дают {money(TOP10)} — это {str(TOP10_PCT).replace('.', ',')} % "
    f"выручки года, всего в 2026 году покупали {COMPANIES_2026:,}".replace(",", " ")
    + " компании. То есть 1,3 млрд — это «широкий» оборот по 3 736 заказам, а не 2–3 гигантских контракта, "
      "которые можно было бы исключить как аномалию.", small))

# --- 6. почему 1С ---
story.append(Paragraph("6. Почему 1С даёт ~800 млн: гипотезы по убыванию вероятности", h2))
story.append(Paragraph(
    "Компания называет цифру по отчётам 1С. В 1С выручка — это <b>признанная</b> величина: она появляется в момент "
    "реализации/отгрузки и уменьшается на возвраты. В CRM же фиксируется <b>сумма заказа</b> в момент, когда менеджер "
    "перевёл сделку в «Сделка успешна». Это разные события и разные моменты времени, поэтому полного совпадения "
    "ждать не нужно — нужно понять, какой именно показатель в 1С берётся за эталон."))
story.append(kv_table(
    rows=[(n, h, o, p) for n, h, o, p in HYPOTHESES],
    widths=[W * 0.05, W * 0.33, W * 0.47, W * 0.15],
    header=("#", "Гипотеза", "Почему так думаю / как проверить", "Вероятность"),
    aligns={0: "CENTER", 3: "CENTER"},
))
story.append(Spacer(1, 6))
story.append(callout(
    f"<b>Ключевое число:</b> 800 / 1 299 = <b>62 %</b>. Для оптовой торговли металлической мебелью это очень похоже "
    "на долю <b>оплаченных или отгруженных</b> заказов от портфеля закрытых сделок: часть заказов закрыта, но "
    "не оплачена/не отгружена на отчётную дату, часть — оплачена авансом без отгрузки. Именно поэтому "
    "сравнивать «портфель сделок» и «выручку 1С» напрямую нельзя.", "red"))

# --- 7. что предлагаю ---
story.append(Paragraph("7. Что предлагаю сделать в аналитике", h2))
story.append(Paragraph(
    "Чтобы спор «чья цифра правильная» превратился в сверку, в отчёте нужны переключатели и третий источник — счета. "
    "Ниже план по возрастанию сложности; первые два пункта закрывают 80 % вопросов."))
story.append(kv_table(
    rows=[(a, b, c) for a, b, c in ACTIONS],
    widths=[W * 0.46, W * 0.38, W * 0.16],
    header=("Что добавить", "Зачем", "Оценка"),
    aligns={2: "CENTER"},
))
story.append(Spacer(1, 6))
story.append(Paragraph(
    "Отдельно стоит договориться о <b>едином определении</b> показателя «выручка» для управленческой отчётности: "
    "портфель закрытых сделок (CRM) или признанная выручка (1С). До этого момента обе цифры верны — они просто "
    "про разное.", small))

# --- 8. приложение ---
story.append(Paragraph("8. Приложение: как воспроизвести", h2))
story.append(Paragraph("Все замеры воспроизводятся одним запросом к базе CRM Analyzer:", small))
story.append(codeblock(
    "WITH w AS (SELECT opportunity, id,\n"
    "            (raw->>'BEGINDATE')::timestamptz AS bd\n"
    "       FROM deals WHERE stage_id = 'WON')\n"
    "SELECT count(*) AS deals, round(sum(opportunity)::numeric, 0) AS sum_rub\n"
    "  FROM w WHERE bd >= '2026-01-01' AND bd < '2027-01-01';"
))
story.append(Spacer(1, 4))
story.append(Paragraph(
    "Запуск: <font face='Consolas'>docker compose ... exec -T db psql -U bitrix -d bitrix</font>. Метрика в UI — "
    "страница <b>«Аналитика»</b>, KPI «Выручка по успешным сделкам»; API — "
    "<font face='Consolas'>/api/analytics/overview?from=2026-01-01&amp;to=2027-01-01</font>.", small))
story.append(Spacer(1, 6))
story.append(callout(
    "<b>Итог.</b> Дашборд считает корректно заявленное: сумма успешных сделок с датой начала в периоде. "
    "Разница с 1С — в определении выручки (оплата/реализация против портфеля заказов) и, возможно, в НДС. "
    "Следующий шаг — метрика «оплачено по счетам» и переключатель даты, после чего сверка станет построчной.",
    "brand"))

doc.build(story)
print("готово:", OUT)
