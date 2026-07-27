/**
 * Русская плюрализация счётчиков.
 *
 * Вынесена из `lib/mock/index.ts` в отдельный модуль, потому что подписи
 * списков теперь считаются на клиенте (фильтры по каналам и категориям —
 * клиентское состояние, не query-параметры): импорт из `index.ts` затащил бы
 * в клиентский бандл весь mock-набор данных.
 */

function pluralize(count: number, forms: [string, string, string]): string {
  const lastTwoDigits = Math.abs(count) % 100;
  const lastDigit = lastTwoDigits % 10;

  if (lastTwoDigits > 10 && lastTwoDigits < 20) {
    return forms[2];
  }

  if (lastDigit > 1 && lastDigit < 5) {
    return forms[1];
  }

  return lastDigit === 1 ? forms[0] : forms[2];
}

/**
 * Exported (not just an internal mock helper) because `lib/db/inbox.ts`
 * (T-05) needs the exact same Russian pluralization for real conversation
 * counts — one source of truth instead of a second copy drifting from this one.
 */
export function countWithNoun(
  count: number,
  forms: [string, string, string],
): string {
  return `${count} ${pluralize(count, forms)}`;
}
