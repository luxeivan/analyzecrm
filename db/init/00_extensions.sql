-- pgvector нужен для будущих ИИ-эмбеддингов (companies.embedding / contacts.embedding)
CREATE EXTENSION IF NOT EXISTS vector;
-- pg_trgm — быстрый ILIKE-поиск по склеенному search_text
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
