import 'dotenv/config';

/** LLM-клиент (OpenAI-совместимый): Polza.ai по POLZA_TOKEN, иначе LLM_API_KEY/LLM_BASE_URL. */
const polzaKey = process.env.POLZA_TOKEN || '';
const apiKey = polzaKey || process.env.LLM_API_KEY || '';
const base = (process.env.LLM_BASE_URL || (polzaKey ? 'https://polza.ai/api/v1' : 'https://api.openai.com/v1')).replace(/\/$/, '');
const model = process.env.LLM_MODEL || process.env.POLZA_MODEL || (polzaKey ? 'openai/gpt-4o-mini' : 'gpt-4o-mini');

export const llmConfigured = Boolean(apiKey);
export const llmInfo = { provider: polzaKey ? 'polza.ai' : 'openai-compatible', model };

const normalizeUsage = (usage) =>
  usage
    ? {
        promptTokens: usage.prompt_tokens ?? null,
        completionTokens: usage.completion_tokens ?? null,
        totalTokens: usage.total_tokens ?? null,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
        costRub: usage.cost_rub ?? usage.cost ?? null,
      }
    : null;

/**
 * Запрос к чат-модели. Рассуждающие модели иногда тратят весь лимит на reasoning
 * и возвращают пустой content — повторяем с удвоенным лимитом.
 */
export async function chatComplete({ messages, maxTokens =Number(process.env.LLM_MAX_TOKENS || 3000), temperature = 0.3 }) {
  if (!llmConfigured) {
    const error = new Error('LLM не настроена: нужен POLZA_TOKEN или LLM_API_KEY');
    error.code = 'LLM_NOT_CONFIGURED';
    throw error;
  }

  let data = null;
  let text = '';

  for (const budget of [maxTokens, maxTokens * 2]) {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: budget,
        ...(process.env.LLM_REASONING_EFFORT ? { reasoning: { effort: process.env.LLM_REASONING_EFFORT } } : {}),
        messages,
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error = new Error(`LLM ${response.status}: ${body.slice(0, 300)}`);
      error.statusCode = 502;
      throw error;
    }

    data = await response.json();
    const message = data?.choices?.[0]?.message ?? {};
    text = String(message.content ?? message.reasoning ?? '').trim();
    if (text) break;
  }

  if (!text) {
    const error = new Error('LLM вернула пустой ответ (лимит токенов ушёл на reasoning)');
    error.statusCode = 502;
    throw error;
  }

  return { text, usage: normalizeUsage(data?.usage), ...llmInfo };
}
