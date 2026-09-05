import { isDigestEmpty } from "@/lib/notifications/digest";
import { acquireLeases, cronLease, releaseLeases } from "@/lib/workflows/leases";

import {
  advanceDigestBoundary,
  deliverDigest,
  listDueDigestRecipients,
  summarizeNewIncoming,
  type PushDigestResult,
} from "./digest.steps";

/**
 * Крон-лиза должна перекрывать самый долгий обход получателей, но не
 * растягиваться настолько, чтобы застрявший прогон глушил дайджест надолго.
 */
const DIGEST_LEASE_TTL_SECONDS = 10 * 60;

/**
 * Сводка уведомлений (docs/architecture/11-realtime-pwa.md): по каждому
 * получателю, у которого истёк интервал, собрать, что нового пришло с
 * `last_digest_at`, отправить один пуш и сдвинуть границу окна.
 *
 * Самый первый прогон (без `last_digest_at`) только ставит границу и ничего не
 * шлёт — предыдущего окна ещё не существует. Когда нового нет, граница всё
 * равно двигается, но пуш не уходит (§11: в режиме сводки мгновенные пуши не
 * приходят, сводка привязана к интервалу).
 *
 * Тик приходит из Vercel Cron (`app/api/cron/push-digest/route.ts`) каждые пять
 * минут; лиза `cron:push-digest` — бывший `concurrency` с лимитом 1: пока идёт
 * прошлый обход, следующий тик уходит ни с чем вместо параллельной рассылки.
 */
export async function pushDigestWorkflow(): Promise<
  PushDigestResult & { status: "completed" | "already-running" }
> {
  "use workflow";

  const leases = [cronLease("push-digest", DIGEST_LEASE_TTL_SECONDS)];

  // Ждать нет смысла: следующий тик придёт через пять минут.
  try {
    await acquireLeases(leases, 0);
  } catch {
    return { processed: 0, sent: 0, status: "already-running" };
  }

  try {
    const nowIso = new Date().toISOString();
    const due = await listDueDigestRecipients(nowIso);

    let processed = 0;
    let sent = 0;

    for (const recipient of due) {
      processed += 1;

      if (!recipient.lastDigestAt) {
        // Устанавливаем базовую границу, ничего не отправляя.
        await advanceDigestBoundary({
          workspaceId: recipient.workspaceId,
          userId: recipient.userId,
          atIso: nowIso,
        });
        continue;
      }

      const summary = await summarizeNewIncoming(
        recipient.workspaceId,
        new Date(recipient.lastDigestAt),
      );

      if (!isDigestEmpty(summary)) {
        const delivered = await deliverDigest({
          workspaceId: recipient.workspaceId,
          userId: recipient.userId,
          summary,
        });
        if (delivered) {
          sent += 1;
        }
      }

      // Двигаем границу независимо от того, было ли что отправлять.
      await advanceDigestBoundary({
        workspaceId: recipient.workspaceId,
        userId: recipient.userId,
        atIso: nowIso,
      });
    }

    return { processed, sent, status: "completed" };
  } finally {
    await releaseLeases(leases);
  }
}
