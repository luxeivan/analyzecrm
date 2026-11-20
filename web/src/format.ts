export function money(value: number | null | undefined, currency?: string | null) {
  if (value === null || value === undefined) return '—';
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: currency || 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value.toLocaleString('ru-RU')} ${currency ?? ''}`;
  }
}

export const fmtDate = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
    : '—';

export const fmtDay = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString('ru-RU') : '—';

export const fmtNumber = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : value.toLocaleString('ru-RU');

export const isWonStage = (stage?: string | null) => /успешн|won|success/i.test(String(stage ?? ''));
export const isLostStage = (stage?: string | null) => /провал|lost|fail/i.test(String(stage ?? ''));
