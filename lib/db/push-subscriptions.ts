import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminSupabaseClient } from "@/lib/db/admin";

export type PushSubscriptionInput = {
  workspaceId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  authKey: string;
};

export type PushSubscriptionResult =
  | { ok: true }
  | { ok: false; error: string };

/** Полная подписка для отправки push из Inngest (без persist-полей). */
export type PushSubscriptionRecord = {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  authKey: string;
};

/**
 * Сохраняет Web Push подписку текущего пользователя (RLS owner-scoped уже
 * ограничивает доступ). Уникальность — по `(user_id, workspace_id, endpoint)`:
 * повторная подписка того же браузера просто обновляет ключи.
 */
export async function upsertPushSubscription(
  supabase: SupabaseClient,
  input: PushSubscriptionInput,
): Promise<PushSubscriptionResult> {
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      workspace_id: input.workspaceId,
      user_id: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth_key: input.authKey,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,workspace_id,endpoint" },
  );

  if (error) {
    console.error("[push] failed to save subscription", error);
    return {
      ok: false,
      error:
        error.code === "42501"
          ? "Нет доступа к этому рабочему пространству."
          : "Не удалось сохранить подписку на уведомления.",
    };
  }

  return { ok: true };
}

export async function deletePushSubscription(
  supabase: SupabaseClient,
  input: { workspaceId: string; userId: string; endpoint: string },
): Promise<PushSubscriptionResult> {
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("endpoint", input.endpoint);

  if (error) {
    console.error("[push] failed to delete subscription", error);
    return { ok: false, error: "Не удалось отключить подписку." };
  }

  return { ok: true };
}

function mapRecord(row: Record<string, unknown>): PushSubscriptionRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    endpoint: row.endpoint as string,
    p256dh: row.p256dh as string,
    authKey: row.auth_key as string,
  };
}

/**
 * Все подписки workspace — получатели push о новом входящем. Отдельного режима
 * частоты у контура нет: push приходит на каждое входящее (§11). Admin-клиент
 * (обходит RLS) — вызывается только из Inngest-функции `send-push`.
 */
export async function listWorkspaceSubscriptions(
  workspaceId: string,
): Promise<PushSubscriptionRecord[]> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth_key")
    .eq("workspace_id", workspaceId);

  if (error) {
    throw new Error(`Loading push subscriptions failed (${error.code ?? ""}).`);
  }

  return ((data ?? []) as Record<string, unknown>[]).map(mapRecord);
}

/**
 * Удаляет мёртвую подписку (провайдер вернул 404/410) — гигиена, о которой
 * говорит `cleanup`-cron (docs/architecture/07-data-flows.md#65). Admin-клиент.
 */
export async function pruneSubscription(id: string): Promise<void> {
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("id", id);

  if (error) {
    // Прунинг — не критичный путь: логируем и не роняем отправку push.
    console.error("[push] failed to prune dead subscription", { id, error });
  }
}
