/** Общие помощники сборки SQL: пагинация, фильтры, сортировка. */

export function paging(req, maxLimit = 200) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), maxLimit);
  const page = Math.max(Number(req.query.page) || 1, 1);
  return { limit, page, offset: (page - 1) * limit };
}

const UF_KEY = /^UF_[A-Za-z0-9_]+$/;

/**
 * WHERE из query-параметров.
 * - q         — поиск по title/search_text
 * - exact     — { paramName: column }
 * - like      — { paramName: column } (ILIKE)
 * - любые UF_* параметры фильтруют по raw->>поле (точное совпадение)
 */
export function buildFilters(req, { exact = {}, like = {}, search = [] } = {}) {
  const params = [];
  const where = [];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const first = (value) => (Array.isArray(value) ? value[0] : value);

  const q = String(first(req.query.q) ?? '').trim();
  if (q) {
    const placeholder = param(`%${q}%`);
    const columns = [...search, 'search_text'];
    where.push(`(${columns.map((col) => `${col} ILIKE ${placeholder}`).join(' OR ')})`);
  }

  for (const [name, column] of Object.entries(exact)) {
    const value = first(req.query[name]);
    if (value === undefined || value === '') continue;
    where.push(`${column} = ${param(String(value))}`);
  }

  for (const [name, column] of Object.entries(like)) {
    const value = String(first(req.query[name]) ?? '').trim();
    if (!value) continue;
    where.push(`${column} ILIKE ${param(`%${value}%`)}`);
  }

  for (const [name, value] of Object.entries(req.query)) {
    if (!UF_KEY.test(name)) continue;
    const rawValue = String(first(value) ?? '').trim();
    if (!rawValue) continue;
    where.push(`raw->>${param(name)} = ${param(rawValue)}`);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

/**
 * ORDER BY: whitelisted колонки + произвольное UF_* поле из raw.
 * columns — { имя_для_клиента: SQL-выражение }.
 */
export function applyOrder(params, { sort, dir, columns, fallback }) {
  const direction = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const requested = String(sort || '');

  if (UF_KEY.test(requested)) {
    params.push(requested);
    return `ORDER BY raw->>$${params.length} ${direction} NULLS LAST`;
  }

  const column = columns[requested] || columns[fallback];
  return `ORDER BY ${column} ${direction} NULLS LAST`;
}
