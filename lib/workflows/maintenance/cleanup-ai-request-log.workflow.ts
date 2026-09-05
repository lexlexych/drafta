import { acquireLeases, cronLease, releaseLeases } from "@/lib/workflows/leases";

import { deleteExpiredAiRequestLogs } from "./cleanup-ai-request-log.steps";

/** Крон-лиза живёт дольше самой долгой чистки, но не дольше суток между тиками. */
const CLEANUP_LEASE_TTL_SECONDS = 30 * 60;

/**
 * Ретенция `public.ai_request_log` (docs/architecture/15-compliance-gdpr.md).
 * Таблица хранит дословные промпты и ответы — маскированные, но всё ещё
 * содержимое переписки, — и защитима только ограниченным сроком жизни; этот
 * прогон и есть срок.
 *
 * Запускается ночью по всем воркспейсам сразу: строки удаляются по возрасту, и
 * планировать нечего. Тик приходит из Vercel Cron
 * (`app/api/cron/cleanup-ai-request-log/route.ts`), а лиза `cron:` заменяет
 * бывший `concurrency` с лимитом 1 — если прошлая чистка ещё идёт, следующий
 * тик уходит ни с чем вместо параллельного удаления.
 */
export async function cleanupAiRequestLogWorkflow(): Promise<{
  deleted: number;
  status: "completed" | "already-running";
}> {
  "use workflow";

  const leases = [cronLease("cleanup-ai-request-log", CLEANUP_LEASE_TTL_SECONDS)];

  // Ждать освобождения смысла нет: следующий тик всё равно придёт завтра.
  try {
    await acquireLeases(leases, 0);
  } catch {
    return { deleted: 0, status: "already-running" };
  }

  try {
    const deleted = await deleteExpiredAiRequestLogs(new Date().toISOString());
    return { deleted, status: "completed" };
  } finally {
    await releaseLeases(leases);
  }
}
