import {
  acquireLeases,
  releaseLeases,
  workspacePushLease,
} from "@/lib/workflows/leases";

import {
  buildInstantPayload,
  deliverInstantPush,
  loadPushContext,
  type SendPushInput,
  type SendPushResult,
} from "./send-push.steps";

/**
 * Мгновенный Web Push для режима «каждое входящее»
 * (docs/architecture/11-realtime-pwa.md#web-push). Отправка идёт прогоном с
 * ретраями (правило 8), а не из вебхук-роута.
 *
 * Компенсации на провал нет — и это осознанно: пропущенный пуш не фатален, его
 * добирает дайджест, поэтому помечать что-либо «упавшим», как делает отправка
 * сообщения, здесь нечего.
 *
 * Лиза с лимитом 4 на воркспейс: вызов лёгкий, но одновременных доставок
 * одного тенанта всё же лучше ограничить, не мешая другим тенантам.
 */
export async function sendPushWorkflow(
  input: SendPushInput,
): Promise<SendPushResult> {
  "use workflow";

  const leases = [workspacePushLease(input.workspaceId)];
  await acquireLeases(leases);

  try {
    const loaded = await loadPushContext(input);
    if (loaded.status === "skip") {
      return { status: "skipped", reason: loaded.reason };
    }

    const outcome = await deliverInstantPush({
      context: loaded.context,
      payload: buildInstantPayload(loaded.context),
    });

    return {
      status: "sent",
      delivered: outcome.delivered,
      pruned: outcome.pruned,
    };
  } finally {
    await releaseLeases(leases);
  }
}
