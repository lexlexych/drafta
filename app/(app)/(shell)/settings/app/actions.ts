"use server";

import { revalidatePath } from "next/cache";

import {
  deletePushSubscription,
  upsertPushSubscription,
} from "@/lib/db/push-subscriptions";
import { setWorkspaceLanguage } from "@/lib/db/workspace-language";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";
import { isWorkspaceLanguage } from "@/lib/i18n/languages";

const SETTINGS_PATH = "/settings";

export type SaveWorkspaceLanguageResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Сохраняет язык интерфейса в `workspaces.settings.lang`. Сам интерфейс на
 * него пока не переключается — это только сохранённое предпочтение.
 */
export async function saveWorkspaceLanguageAction(
  language: string,
): Promise<SaveWorkspaceLanguageResult> {
  if (!isWorkspaceLanguage(language)) {
    return { ok: false, error: "Неизвестный язык." };
  }

  const user = await getAuthenticatedUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла — войдите заново." };
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return { ok: false, error: "Рабочее пространство не найдено." };
  }

  const supabase = await createServerSupabaseClient();
  const result = await setWorkspaceLanguage(supabase, workspace.id, language);

  if (result.ok) {
    revalidatePath(SETTINGS_PATH);
  }

  return result;
}

export type PushSubscriptionActionInput = {
  endpoint: string;
  p256dh: string;
  authKey: string;
};

type PushActionContext = {
  userId: string;
  workspaceId: string;
};

async function resolvePushContext(): Promise<
  { ok: true; context: PushActionContext } | { ok: false; error: string }
> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { ok: false as const, error: "Сессия истекла — войдите заново." };
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return { ok: false as const, error: "Рабочее пространство не найдено." };
  }

  return {
    ok: true as const,
    context: { userId: user.id, workspaceId: workspace.id },
  };
}

/**
 * Подписка браузера на Web Push. Живёт в разделе «Приложение» вместе с
 * установкой PWA — оба действия про одно конкретное устройство.
 */
export async function savePushSubscriptionAction(
  input: PushSubscriptionActionInput,
) {
  const resolved = await resolvePushContext();
  if (!resolved.ok) {
    return resolved;
  }

  if (!input.endpoint || !input.p256dh || !input.authKey) {
    return { ok: false as const, error: "Некорректные данные подписки." };
  }

  const supabase = await createServerSupabaseClient();
  return upsertPushSubscription(supabase, {
    workspaceId: resolved.context.workspaceId,
    userId: resolved.context.userId,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    authKey: input.authKey,
  });
}

export async function removePushSubscriptionAction(endpoint: string) {
  const resolved = await resolvePushContext();
  if (!resolved.ok) {
    return resolved;
  }

  if (!endpoint) {
    return { ok: false as const, error: "Некорректные данные подписки." };
  }

  const supabase = await createServerSupabaseClient();
  return deletePushSubscription(supabase, {
    workspaceId: resolved.context.workspaceId,
    userId: resolved.context.userId,
    endpoint,
  });
}
