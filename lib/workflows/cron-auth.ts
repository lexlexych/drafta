import "server-only";

/**
 * Общая проверка для крон-роутов. Vercel Cron дёргает роут обычным HTTPS-GET и
 * подписывается заголовком `Authorization: Bearer $CRON_SECRET`
 * (docs/architecture/13-environments-secrets.md) — без него роут публичный, и
 * запустить рассылку сводок мог бы кто угодно.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    // Локально секрета нет: крон-роуты дёргают руками при отладке. В проде
    // переменная обязана быть выставлена, иначе роут открыт всему интернету.
    return process.env.NODE_ENV !== "production";
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}
