import { acquireLeases, entityLease, releaseLeases } from "@/lib/workflows/leases";

import {
  fetchAndSaveAvatar,
  loadAvatarContext,
  type ContactAvatarInput,
  type ContactAvatarResult,
} from "./contact-avatar.steps";

/**
 * Аватар контакта дочитывается из API провайдера, когда его не принёс вебхук
 * (docs/architecture/05-channels.md). Лиза `contact-identity:<id>` — бывший
 * `concurrency` Inngest с лимитом 1: серия сообщений от одного человека не
 * должна оборачиваться серией одинаковых запросов за одной картинкой.
 *
 * Отметка времени берётся прямо в теле прогона, без отдельного шага
 * `capture-now`: в workflow-функции `Date` детерминирован и при повторном
 * проигрывании отдаёт то же значение, поэтому проверка на устаревание и
 * запись `avatar_fetched_at` всегда видят один и тот же момент.
 */
export async function contactAvatarWorkflow(
  input: ContactAvatarInput,
): Promise<ContactAvatarResult> {
  "use workflow";

  const leases = [
    entityLease("contact-identity", input.contactIdentityId, input.workspaceId),
  ];
  await acquireLeases(leases);

  try {
    const nowIso = new Date().toISOString();

    const loaded = await loadAvatarContext(input, nowIso);
    if (loaded.status === "skip") {
      return { status: "skipped", reason: loaded.reason };
    }

    const result = await fetchAndSaveAvatar({
      workflowInput: input,
      context: loaded.context,
      fetchedAtIso: nowIso,
    });

    return { status: result.changed ? "updated" : "unchanged" };
  } finally {
    await releaseLeases(leases);
  }
}
