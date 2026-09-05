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

/** Полная подписка для отправки push из прогона (без persist-полей). */
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
 * Подписки получателей мгновенных push в workspace: пользователи в режиме
 * `instant` **или** без строки настроек (дефолт — instant, §11). Admin-клиент
 * (обходит RLS) — вызывается только из прогона `send-push`.
 */
export async function listInstantSubscriptions(
  workspaceId: string,
): Promise<PushSubscriptionRecord[]> {
  const supabase = createAdminSupabaseClient();

  const [{ data: subscriptions, error: subsError }, { data: settings, error: settingsError }] =
    await Promise.all([
      supabase
        .from("push_subscriptions")
        .select("id, user_id, endpoint, p256dh, auth_key")
        .eq("workspace_id", workspaceId),
      supabase
        .from("notification_settings")
        .select("user_id, mode")
        .eq("workspace_id", workspaceId),
    ]);

  if (subsError) {
    throw new Error(`Loading push subscriptions failed (${subsError.code ?? ""}).`);
  }
  if (settingsError) {
    throw new Error(`Loading notification settings failed (${settingsError.code ?? ""}).`);
  }

  // По умолчанию instant; в digest-режиме мгновенные push не шлём (§11).
  const digestUsers = new Set(
    ((settings ?? []) as { user_id: string; mode: string }[])
      .filter((row) => row.mode === "digest")
      .map((row) => row.user_id),
  );

  return ((subscriptions ?? []) as Record<string, unknown>[])
    .map(mapRecord)
    .filter((record) => !digestUsers.has(record.userId));
}

/** Все подписки конкретного пользователя в workspace — для дайджеста. */
export async function listUserSubscriptions(
  workspaceId: string,
  userId: string,
): Promise<PushSubscriptionRecord[]> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth_key")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Loading user push subscriptions failed (${error.code ?? ""}).`);
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
