import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MAX_IGNORED_SENDERS_PER_PLATFORM,
  type IgnoredSenderInput,
  type IgnoredSenderPlatform,
} from "@/lib/ignored-senders/validation";

/**
 * Исключённые отправители: адреса, чьи личные сообщения drafta не сохраняет
 * (docs/architecture/05-channels.md#исключённые-отправители).
 *
 * CRUD вызывается из настроек каналов через RLS-клиент пользователя — политика
 * `ignored_senders_member_access` та же `private.is_workspace_member`, что и у
 * остального; явные `.eq("workspace_id")` — defense-in-depth, как во всём
 * `lib/db`.
 *
 * `isIgnoredSender` — исключение: его зовёт гейт вебхука под admin-клиентом,
 * потому что вебхук приходит без пользовательской сессии.
 */

export type IgnoredSenderRow = {
  id: string;
  workspace_id: string;
  platform: IgnoredSenderPlatform;
  identifier: string;
  label: string;
  created_at: string;
  updated_at: string;
};

export type IgnoredSenderResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const COLUMNS =
  "id, workspace_id, platform, identifier, label, created_at, updated_at";

/** Адрес уже в списке — уникальный ключ (workspace_id, platform, identifier). */
function isDuplicate(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

function duplicateError(platform: IgnoredSenderPlatform): string {
  return platform === "whatsapp"
    ? "Этот номер уже в списке исключений."
    : "Этот аккаунт уже в списке исключений.";
}

export async function listIgnoredSenders(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<IgnoredSenderRow[]> {
  const { data, error } = await supabase
    .from("ignored_senders")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[ignored-senders] failed to list the exclusions", error);
    return [];
  }

  return (data ?? []) as IgnoredSenderRow[];
}

export async function createIgnoredSender(
  supabase: SupabaseClient,
  workspaceId: string,
  input: IgnoredSenderInput,
): Promise<IgnoredSenderResult<IgnoredSenderRow>> {
  // Мягкий лимит: список правится вручную и по одному, так что гонку двух
  // вкладок здесь не ловим — это удобство, а не инвариант схемы.
  const { count, error: countError } = await supabase
    .from("ignored_senders")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("platform", input.platform);

  if (countError) {
    console.error("[ignored-senders] failed to count the exclusions", countError);
    return { ok: false, error: "Не удалось сохранить исключение. Попробуйте ещё раз." };
  }
  if ((count ?? 0) >= MAX_IGNORED_SENDERS_PER_PLATFORM) {
    return {
      ok: false,
      error: `В списке уже ${MAX_IGNORED_SENDERS_PER_PLATFORM} записей — больше добавить нельзя.`,
    };
  }

  const { data, error } = await supabase
    .from("ignored_senders")
    .insert({
      workspace_id: workspaceId,
      platform: input.platform,
      identifier: input.identifier,
      label: input.label,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (isDuplicate(error)) {
      return { ok: false, error: duplicateError(input.platform) };
    }

    console.error("[ignored-senders] failed to create the exclusion", error);
    return { ok: false, error: "Не удалось сохранить исключение. Попробуйте ещё раз." };
  }

  return { ok: true, data: data as IgnoredSenderRow };
}

export async function updateIgnoredSender(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: IgnoredSenderInput,
): Promise<IgnoredSenderResult<IgnoredSenderRow>> {
  const { data, error } = await supabase
    .from("ignored_senders")
    .update({
      platform: input.platform,
      identifier: input.identifier,
      label: input.label,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    if (isDuplicate(error)) {
      return { ok: false, error: duplicateError(input.platform) };
    }

    console.error("[ignored-senders] failed to update the exclusion", error);
    return { ok: false, error: "Не удалось сохранить исключение. Попробуйте ещё раз." };
  }
  if (!data) {
    return { ok: false, error: "Исключение не найдено — обновите страницу." };
  }

  return { ok: true, data: data as IgnoredSenderRow };
}

export async function deleteIgnoredSender(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<IgnoredSenderResult<{ id: string }>> {
  const { error } = await supabase
    .from("ignored_senders")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id);

  if (error) {
    console.error("[ignored-senders] failed to delete the exclusion", error);
    return { ok: false, error: "Не удалось удалить исключение. Попробуйте ещё раз." };
  }

  return { ok: true, data: { id } };
}

/**
 * Есть ли среди кандидатов адрес из списка исключений.
 *
 * Читает по префиксу уникального ключа — тот же класс запроса, что
 * `isAutoReplyEnabled`, и на бюджет вебхука (<1 сек, правило 6) не влияет.
 *
 * При ошибке чтения — `false`, то есть событие обрабатывается как обычно.
 * Обратный выбор дороже и необратим: Zernio доставку не повторяет, и отброшенное
 * из-за сбоя БД сообщение клиента пропало бы навсегда, тогда как просочившееся
 * личное пользователь удалит сам.
 */
export async function isIgnoredSender(
  supabase: SupabaseClient,
  workspaceId: string,
  platform: string,
  identifiers: readonly string[],
): Promise<boolean> {
  if (identifiers.length === 0) {
    return false;
  }

  const { data, error } = await supabase
    .from("ignored_senders")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("platform", platform)
    .in("identifier", identifiers)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[ignored-senders] failed to read the exclusions list", error);
    return false;
  }

  return data !== null;
}
