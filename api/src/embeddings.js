/**
 * Общий клиент эмбеддингов (OpenAI-совместимый /embeddings, по умолчанию Polza.ai).
 * Используется ETL-скриптом embed.js и API (семантический поиск, «похожие»).
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const embeddingModel = process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small';
export const embeddingBase = (process.env.LLM_BASE_URL || 'https://polza.ai/api/v1').replace(/\/$/, '');
export const embeddingToken = process.env.POLZA_TOKEN || process.env.EMBEDDING_API_KEY || '';
export const embeddingsConfigured = Boolean(embeddingToken);

/** Ошибка конфигурации — чтобы API мог вернуть понятный hint вместо 500. */
export class EmbeddingsNotConfiguredError extends Error {
  constructor() {
    super('Не задан POLZA_TOKEN (или EMBEDDING_API_KEY) — эмбеддинги недоступны');
    this.code = 'EMBEDDINGS_NOT_CONFIGURED';
  }
}

/** Векторизует массив текстов. Возвращает { embeddings, usage }. */
export async function embedTexts(inputs, { attempts = 4 } = {}) {
  if (!embeddingsConfigured) throw new EmbeddingsNotConfiguredError();
  if (!inputs.length) return { embeddings: [], usage: null };

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${embeddingBase}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${embeddingToken}` },
        body: JSON.stringify({ model: embeddingModel, input: inputs }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const error = new Error(`embeddings ${response.status}: ${body.slice(0, 200)}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      if (!Array.isArray(data.data) || data.data.length !== inputs.length) {
        throw new Error(`некорректный ответ: ожидали ${inputs.length} векторов`);
      }
      return { embeddings: data.data.map((item) => item.embedding), usage: data.usage ?? null };
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delay = error.status === 429 ? 5000 * attempt : 1000 * attempt;
      await sleep(delay);
    }
  }
  throw lastError;
}

/** Вектор в формате pgvector: '[0.1,0.2,...]'. */
export const toVectorLiteral = (embedding) => `[${embedding.join(',')}]`;
