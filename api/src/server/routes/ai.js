import { Router } from 'express';
import { query } from '../../db.js';
import { decodeEnum, decodeStatus, describeEntity, getMeta } from '../crm.js';
import { getAnalytics } from '../analytics.js';
import { embedTexts, embeddingsConfigured, toVectorLiteral } from '../../embeddings.js';
import { chatComplete, llmConfigured, llmInfo } from '../../llm.js';

export const aiRouter = Router();

const daysSince = (value) => {
  if (!value) return null;
  const diff = Date.now() - new Date(value).getTime();
  return Number.isFinite(diff) ? Math.floor(diff / 86_400_000) : null;
};

const isWon = (stage) => /успешн|won|success/i.test(String(stage || ''));
const isLost = (stage) => /провал|lost|fail/i.test(String(stage || ''));

/**
 * Компактная выжимка по клиенту: готовый JSON для локальной LLM.
 * Только факты + метрики + качество данных, без сырых простыней Битрикса.
 */
aiRouter.get('/ai/company/:id/summary', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Некорректный ID' });

    const meta = await getMeta();
    const [companyRes, contactsRes, dealsRes, contactStats] = await Promise.all([
      query('SELECT * FROM companies WHERE id = $1', [id]),
      query(
        `SELECT id, title, name, last_name, phones, emails, raw->>'POST' AS position,
                source_id, date_create, date_modify
           FROM contacts WHERE company_id = $1
          ORDER BY date_modify DESC NULLS LAST LIMIT 200`,
        [id],
      ),
      query(
        `SELECT id, title, stage_id, opportunity, currency_id, date_create, date_modify
           FROM deals WHERE company_id = $1
          ORDER BY date_modify DESC NULLS LAST LIMIT 200`,
        [id],
      ),
      query(
        `SELECT count(*)::int AS contacts,
                count(*) FILTER (WHERE jsonb_array_length(coalesce(emails, '[]'::jsonb)) = 0)::int AS without_email,
                count(*) FILTER (WHERE jsonb_array_length(coalesce(phones, '[]'::jsonb)) = 0)::int AS without_phone
           FROM contacts WHERE company_id = $1`,
        [id],
      ),
    ]);

    const company = companyRes.rows[0];
    if (!company) return res.status(404).json({ error: 'Компания не найдена' });

    const fields = describeEntity(meta, 'company', company.raw);
    const customFields = Object.fromEntries(
      fields.filter((field) => field.isCustom).map((field) => [field.code, field.value]),
    );

    const contacts = contactsRes.rows.map((row) => ({
      id: row.id,
      name: row.title,
      position: row.position || null,
      source: decodeStatus(meta, row.source_id),
      phones: (row.phones || []).map((item) => item.value),
      emails: (row.emails || []).map((item) => item.value),
      created_at: row.date_create,
      updated_at: row.date_modify,
    }));

    const deals = dealsRes.rows.map((row) => {
      const stage = decodeStatus(meta, row.stage_id);
      return {
        id: row.id,
        title: row.title,
        stage,
        amount: row.opportunity === null ? null : Number(row.opportunity),
        currency: row.currency_id || null,
        created_at: row.date_create,
        updated_at: row.date_modify,
      };
    });

    const won = deals.filter((deal) => isWon(deal.stage));
    const lost = deals.filter((deal) => isLost(deal.stage));

    const summary = {
      meta: {
        generated_at: new Date().toISOString(),
        source: 'bitrix24',
        entity: 'company',
        id: company.id,
      },
      profile: {
        title: company.title,
        industry: decodeEnum(meta, 'company', 'INDUSTRY', company.industry_id),
        source: decodeStatus(meta, company.source_id),
        city: company.city,
        region: company.region,
        phones: (company.phones || []).map((item) => item.value),
        emails: (company.emails || []).map((item) => item.value),
        created_at: company.date_create,
        updated_at: company.date_modify,
        days_since_created: daysSince(company.date_create),
        days_since_updated: daysSince(company.date_modify),
      },
      custom_fields: customFields,
      contacts,
      deals,
      metrics: {
        contacts: contacts.length,
        deals: deals.length,
        open_deals: deals.length - won.length - lost.length,
        won_deals: won.length,
        lost_deals: lost.length,
        pipeline_amount: deals
          .filter((deal) => !isWon(deal.stage) && !isLost(deal.stage))
          .reduce((sum, deal) => sum + (deal.amount || 0), 0),
        won_amount: won.reduce((sum, deal) => sum + (deal.amount || 0), 0),
        last_activity_at: deals[0]?.updated_at || contacts[0]?.updated_at || company.date_modify,
      },
      data_quality: {
        filled_custom_fields: Object.keys(customFields).length,
        contacts: contactStats.rows[0].contacts,
        contacts_without_email: contactStats.rows[0].without_email,
        contacts_without_phone: contactStats.rows[0].without_phone,
        deals_without_amount: deals.filter((deal) => !deal.amount).length,
        missing_core: [
          !company.industry_id && 'INDUSTRY',
          !company.city && 'ADDRESS_CITY',
          !(company.emails || []).length && 'EMAIL',
          !(company.phones || []).length && 'PHONE',
          !contacts.length && 'CONTACTS',
        ].filter(Boolean),
      },
      llm: {
        instruction:
          'Ты — аналитик CRM. Ниже JSON с профилем клиента из Битрикс24. ' +
          'Оцени качество и полноту данных, состояние отношений, риски и следующие шаги. ' +
          'Отвечай кратко, структурированно, без выдуманных фактов: только то, что есть в JSON.',
        questions: [
          'К какому сегменту фактически относится клиент и чем он ценен?',
          'Какие поля карточки заполнены плохо и что стоит уточнить у менеджера?',
          'Есть ли риск потери клиента (давно нет активности, мало контактов)?',
          'Какие 3 конкретных действия предпринять на следующей неделе?',
        ],
      },
      quality: {
        completeness:
          fields.length === 0
            ? 0
            : Math.round((fields.filter((field) => field.value).length / fields.length) * 100),
      },
    };

    if (req.query.format === 'text') {
      return res
        .type('text/plain; charset=utf-8')
        .send(
          `${summary.llm.instruction}\n\nJSON:\n${JSON.stringify(summary, null, 2)}\n\nВопросы:\n` +
            summary.llm.questions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
        );
    }

    res.json(summary);
  } catch (err) {
    next(err);
  }
});

/**
 * Аналитические выводы через LLM (OpenAI-совместимый API).
 * Без ключа возвращает 200 {configured:false} — UI показывает инструкцию.
 */
aiRouter.post('/ai/insights', async (_req, res, next) => {
  try {
    const polzaKey = process.env.POLZA_TOKEN;
    const apiKey = polzaKey || process.env.LLM_API_KEY;
    if (!apiKey) {
      return res.json({
        configured: false,
        hint: 'Задайте POLZA_TOKEN (или LLM_API_KEY / LLM_BASE_URL / LLM_MODEL) в .env и перезапустите api.',
      });
    }

    const analytics = await getAnalytics();
    const compact = {
      coverage: analytics.coverage,
      deals: {
        count: analytics.deals.count,
        won: analytics.deals.won,
        lost: analytics.deals.lost,
        open: analytics.deals.open,
        zeroSum: analytics.deals.zeroSum,
        sum: Math.round(analytics.deals.sum),
        wonSum: Math.round(analytics.deals.wonSum),
        avgDeal: Math.round(analytics.deals.avgDeal),
        winRate: analytics.deals.winRate,
      },
      years: analytics.years,
      leads: {
        count: analytics.leads.count,
        converted: analytics.leads.converted,
        junk: analytics.leads.junk,
        conversion: analytics.leads.conversion,
      },
      sources: analytics.sources.slice(0, 8),
      topCompanies: analytics.topCompanies.slice(0, 5),
      repeat: analytics.repeat,
      quality: analytics.quality,
      recommendations: analytics.recommendations.map((item) => item.title),
    };

    const base = (
      process.env.LLM_BASE_URL || (polzaKey ? 'https://polza.ai/api/v1' : 'https://api.openai.com/v1')
    ).replace(/\/$/, '');
    const model =
      process.env.LLM_MODEL || process.env.POLZA_MODEL || (polzaKey ? 'openai/gpt-4o-mini' : 'gpt-4o-mini');

    const budget = Number(process.env.LLM_MAX_TOKENS || 3000);
    const messages = [
      {
        role: 'system',
        content:
          'Ты аналитик CRM компании, которая производит и продаёт металлическую мебель (шкафы, стеллажи, верстаки, сейфы). ' +
          'По агрегированным данным CRM дай 5–7 коротких выводов и действий на русском. ' +
          'Опирайся только на цифры из JSON, не выдумывай. Формат: маркированный список, каждый пункт — вывод + действие.',
      },
      { role: 'user', content: `Данные CRM (JSON):
${JSON.stringify(compact)}` },
    ];

    // Рассуждающие модели иногда целиком тратят лимит на reasoning и возвращают пустой content.
    // Повторяем запрос с удвоенным лимитом.
    let data = null;
    let text = '';
    for (const maxTokens of [budget, budget * 2]) {
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: maxTokens,
          ...(process.env.LLM_REASONING_EFFORT
            ? { reasoning: { effort: process.env.LLM_REASONING_EFFORT } }
            : {}),
          messages,
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const err = new Error(`LLM ${response.status}: ${body.slice(0, 300)}`);
        err.statusCode = 502;
        throw err;
      }

      data = await response.json();
      const message = data?.choices?.[0]?.message ?? {};
      text = String(message.content ?? message.reasoning ?? '').trim();
      if (text) break;
    }

    if (!text) {
      const err = new Error('LLM вернула пустой ответ (лимит токенов ушёл на reasoning)');
      err.statusCode = 502;
      throw err;
    }

    res.json({
      configured: true,
      provider: polzaKey ? 'polza.ai' : 'openai-compatible',
      model,
      text,
      usage: data?.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? null,
            completionTokens: data.usage.completion_tokens ?? null,
            totalTokens: data.usage.total_tokens ?? null,
            reasoningTokens: data.usage.completion_tokens_details?.reasoning_tokens ?? null,
            costRub: data.usage.cost_rub ?? data.usage.cost ?? null,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai/ask — RAG-ответ на вопрос по CRM.
 * Вопрос векторизуется, из pgvector достаются ближайшие компании/сделки/лиды,
 * они уходят в LLM как контекст, ответ возвращается со ссылками на источники.
 */
aiRouter.post('/ai/ask', async (req, res, next) => {
  try {
    const question = String(req.body?.question ?? '').trim();
    if (question.length < 3) return res.status(400).json({ error: 'Вопрос короче 3 символов' });
    if (!embeddingsConfigured) {
      return res.json({ configured: false, hint: 'Задайте POLZA_TOKEN в .env — без эмбеддингов поиск по базе невозможен.' });
    }
    if (!llmConfigured) {
      return res.json({ configured: false, hint: 'Задайте POLZA_TOKEN или LLM_API_KEY в .env, чтобы получать ответы LLM.' });
    }

    const { embeddings: [vector] } = await embedTexts([question.slice(0, 2000)]);
    const literal = toVectorLiteral(vector);

    const [companies, deals, leads] = await Promise.all([
      query(
        `SELECT id, title, city, region,
                round((1 - (embedding <=> $1::vector))::numeric, 3)::float8 AS score
           FROM companies
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $1::vector
          LIMIT 6`,
        [literal],
      ),
      query(
        `SELECT id, title, opportunity::float8 AS opportunity, stage_id,
                round((1 - (embedding <=> $1::vector))::numeric, 3)::float8 AS score
           FROM deals
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $1::vector
          LIMIT 5`,
        [literal],
      ),
      query(
        `SELECT id, title, status_id,
                round((1 - (embedding <=> $1::vector))::numeric, 3)::float8 AS score
           FROM leads
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $1::vector
          LIMIT 4`,
        [literal],
      ),
    ]);

    const meta = await getMeta();
    const stageName = (id) => (id ? decodeStatus(meta, id) ?? id : '—');
    const leadStatus = (id) => (id ? decodeStatus(meta, id) ?? id : '—');

    const contextLines = [
      ...companies.rows.map(
        (row) =>
          `[company #${row.id}] ${row.title ?? 'без названия'} — город: ${row.city || row.region || 'не указан'} (совпадение ${row.score})`,
      ),
      ...deals.rows.map(
        (row) =>
          `[deal #${row.id}] ${row.title ?? 'без названия'} — сумма: ${Math.round(row.opportunity ?? 0)} ₽, стадия: ${stageName(row.stage_id)} (совпадение ${row.score})`,
      ),
      ...leads.rows.map(
        (row) =>
          `[lead #${row.id}] ${row.title ?? 'без названия'} — статус: ${leadStatus(row.status_id)} (совпадение ${row.score})`,
      ),
    ];

    const { text, usage, model, provider } = await chatComplete({
      messages: [
        {
          role: 'system',
          content:
            'Ты помощник по CRM компании, которая производит металлическую мебель (шкафы, стеллажи, верстаки, сейфы). ' +
            'Отвечай по-русски, коротко и по делу. Опирайся ТОЛЬКО на предоставленные записи CRM и не выдумывай факты. ' +
            'В ответе ссылайся на записи в формате [#company 123], [#deal 456], [#lead 789]. ' +
            'Если в данных нет ответа — честно скажи, что в CRM нет подходящих записей, и предложи уточнить запрос.',
        },
        {
          role: 'user',
          content: `Вопрос: ${question}

Записи CRM, наиболее близкие к вопросу:${contextLines.join('\n')}`,
        },
      ],
      maxTokens: Number(process.env.LLM_MAX_TOKENS || 2000),
    });

    res.json({
      configured: true,
      provider,
      model,
      answer: text,
      usage,
      sources: [
        ...companies.rows.map((row) => ({ entity: 'company', id: row.id, title: row.title, score: row.score })),
        ...deals.rows.map((row) => ({ entity: 'deal', id: row.id, title: row.title, score: row.score })),
        ...leads.rows.map((row) => ({ entity: 'lead', id: row.id, title: row.title, score: row.score })),
      ],
    });
  } catch (err) {
    next(err);
  }
});
