"use server";

import { revalidatePath } from "next/cache";

import {
  deletePushSubscription,
  upsertPushSubscription,
} from "@/lib/db/push-subscriptions";
import { saveNotificationSettings } from "@/lib/db/notification-settings";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";
import type { NotificationSettingsInput } from "@/lib/notifications/settings";

const SETTINGS_PATH = "/settings";

type ActionContext = {
  userId: string;
  workspaceId: string;
};

async function resolveContext(): Promise<
  { ok: true; context: ActionContext } | { ok: false; error: string }
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

export async function saveNotificationSettingsAction(
  input: NotificationSettingsInput,
) {
  const resolved = await resolveContext();
  if (!resolved.ok) {
    return resolved;
  }

  const supabase = await createServerSupabaseClient();
  const result = await saveNotificationSettings(
    supabase,
    resolved.context.workspaceId,
    resolved.context.userId,
    input,
  );

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

export async function savePushSubscriptionAction(
  input: PushSubscriptionActionInput,
) {
  const resolved = await resolveContext();
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
  const resolved = await resolveContext();
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
