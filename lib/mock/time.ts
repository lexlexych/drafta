/**
 * Форматирование отметок времени для списков и тредов.
 *
 * Всё считается в UTC от явно переданного «сейчас» — так подписи не зависят
 * ни от таймзоны машины, ни от реального времени запуска, и остаются
 * детерминированными в тестах и при серверном рендере.
 */

const WEEKDAYS = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
];

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;

function clock(date: Date): string {
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}

function dayNumber(date: Date): number {
  return Math.floor(date.getTime() / (24 * MILLISECONDS_IN_HOUR));
}

function daysAgo(iso: string, nowIso: string): number {
  return dayNumber(new Date(nowIso)) - dayNumber(new Date(iso));
}

/** Короткая подпись для списка диалогов: «12:41», «вчера», «16 июл». */
export function formatListTime(iso: string, nowIso: string): string {
  const date = new Date(iso);
  const distance = daysAgo(iso, nowIso);

  if (distance <= 0) {
    return clock(date);
  }

  if (distance === 1) {
    return "вчера";
  }

  return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}`;
}

/** Подпись сообщения в треде: «12:41», «вчера 18:40», «16 июл, 12:00». */
export function formatMessageTime(iso: string, nowIso: string): string {
  const date = new Date(iso);
  const distance = daysAgo(iso, nowIso);

  if (distance <= 0) {
    return clock(date);
  }

  if (distance === 1) {
    return `вчера ${clock(date)}`;
  }

  return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}, ${clock(date)}`;
}

/** Подпись даты публикации поста: «сегодня», «вчера», «3 дня назад». */
export function formatDayDistance(iso: string, nowIso: string): string {
  const distance = daysAgo(iso, nowIso);

  if (distance <= 0) {
    return "сегодня";
  }

  if (distance === 1) {
    return "вчера";
  }

  const lastDigit = distance % 10;
  const lastTwoDigits = distance % 100;
  const isSingular =
    lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14);

  return `${distance} ${isSingular ? "дня" : "дней"} назад`;
}

/** Подпись срока в будущем: «через 6 дней», «завтра», «сегодня». */
export function formatDaysUntil(iso: string, nowIso: string): string {
  const distance = -daysAgo(iso, nowIso);

  if (distance <= 0) {
    return "сегодня";
  }

  if (distance === 1) {
    return "завтра";
  }

  const lastDigit = distance % 10;
  const lastTwoDigits = distance % 100;
  const isSingular =
    lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14);

  return `через ${distance} ${isSingular ? "дня" : "дней"}`;
}

/** Полная дата для шапки дашборда: «воскресенье, 19 июля». */
export function formatFullDate(iso: string): string {
  const date = new Date(iso);

  return `${WEEKDAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${
    MONTHS_GENITIVE[date.getUTCMonth()]
  }`;
}

/**
 * Сколько часов осталось до закрытия окна ответа платформы.
 * Отрицательное значение — окно уже закрыто.
 */
export function hoursLeftInReplyWindow(
  lastIncomingIso: string,
  nowIso: string,
  windowHours: number,
): number {
  const elapsedHours =
    (new Date(nowIso).getTime() - new Date(lastIncomingIso).getTime()) /
    MILLISECONDS_IN_HOUR;

  return windowHours - elapsedHours;
}
