import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminSupabaseClient } from "@/lib/db/admin";
import {
  DEFAULT_DIGEST_INTERVAL_MINUTES,
  validateNotificationSettingsInput,
  type NotificationMode,
  type NotificationSettingsInput,
} from "@/lib/notifications/settings";

export type NotificationSettingsRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  mode: NotificationMode;
  digest_interval_minutes: number;
  last_digest_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Значения по умолчанию, когда строки настроек ещё нет (режим `instant`, §11). */
export type NotificationSettingsView = {
  mode: NotificationMode;
  digestIntervalMinutes: number;
};

export type NotificationSettingsResult =
  | { ok: true; data: NotificationSettingsView }
  | { ok: false; error: string };

const NOTIFICATION_SETTINGS_COLUMNS =
  "id, workspace_id, user_id, mode, digest_interval_minutes, last_digest_at, created_at, updated_at";

/**
 * Настройки уведомлений пары пользователь+workspace. При отсутствии строки
 * возвращает дефолт `instant` (§11) — строка создаётся при первом сохранении.
 * RLS (owner-scoped) уже ограничивает доступ текущим пользователем; `userId`
 * передаётся явно для `.eq`, чтобы не полагаться только на политику.
 */
export async function getNotificationSettings(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<NotificationSettingsView> {
  const { data, error } = await supabase
    .from("notification_settings")
    .select("mode, digest_interval_minutes")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[settings/notifications] failed to load", error);
    throw new Error("Unable to load notification settings.");
  }

  if (!data) {
    return {
      mode: "instant",
      digestIntervalMinutes: DEFAULT_DIGEST_INTERVAL_MINUTES,
    };
  }

  return {
    mode: data.mode as NotificationMode,
    digestIntervalMinutes: data.digest_interval_minutes as number,
  };
}

export async function saveNotificationSettings(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  input: NotificationSettingsInput,
): Promise<NotificationSettingsResult> {
  const validation = validateNotificationSettingsInput(input);

  if (!validation.ok) {
    return validation;
  }

  const { data, error } = await supabase
    .from("notification_settings")
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: userId,
        mode: validation.data.mode,
        digest_interval_minutes: validation.data.digestIntervalMinutes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,workspace_id" },
    )
    .select(NOTIFICATION_SETTINGS_COLUMNS)
    .single();

  if (error || !data) {
    console.error("[settings/notifications] failed to save", error);
    return {
      ok: false,
      error:
        error?.code === "42501"
          ? "Нет доступа к этому рабочему пространству."
          : "Не удалось сохранить настройки уведомлений.",
    };
  }

  const row = data as NotificationSettingsRow;
  return {
    ok: true,
    data: {
      mode: row.mode,
      digestIntervalMinutes: row.digest_interval_minutes,
    },
  };
}

/** Пара пользователь+workspace в режиме дайджеста, у которой пора слать сводку. */
export type DigestDueRecipient = {
  workspaceId: string;
  userId: string;
  digestIntervalMinutes: number;
  lastDigestAt: string | null;
};

/**
 * Получатели дайджеста, у которых истёк интервал с прошлой сводки. Admin-клиент
 * (обходит RLS) — вызывается только из cron-функции `push-digest`. Интервал
 * проверяется в коде (per-row), т.к. он у каждого свой.
 */
export async function listDigestDueRecipients(
  now: Date,
): Promise<DigestDueRecipient[]> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("notification_settings")
    .select("workspace_id, user_id, digest_interval_minutes, last_digest_at")
    .eq("mode", "digest");

  if (error) {
    throw new Error(`Loading digest recipients failed (${error.code ?? ""}).`);
  }

  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => ({
      workspaceId: row.workspace_id as string,
      userId: row.user_id as string,
      digestIntervalMinutes: row.digest_interval_minutes as number,
      lastDigestAt: (row.last_digest_at as string | null) ?? null,
    }))
    .filter((recipient) => {
      if (!recipient.lastDigestAt) {
        return true;
      }
      const elapsedMs = now.getTime() - new Date(recipient.lastDigestAt).getTime();
      return elapsedMs >= recipient.digestIntervalMinutes * 60 * 1000;
    });
}

/**
 * Двигает границу «что уже вошло в сводку» (`last_digest_at`). Admin-клиент.
 * Вызывается после успешной рассылки дайджеста пользователю.
 */
export async function markDigestSent(
  workspaceId: string,
  userId: string,
  at: Date,
): Promise<void> {
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("notification_settings")
    .update({ last_digest_at: at.toISOString(), updated_at: at.toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Updating last_digest_at failed (${error.code ?? ""}).`);
  }
}
