import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  validateAutoReplySettings,
  validateScenario,
  type AutoReplySettingsInput,
  type ScenarioAction,
  type ScenarioInput,
} from "@/lib/auto-reply/validation";

/**
 * Настройки автоответов и сценарии
 * (docs/architecture/07-data-flows.md#67-автоответ).
 *
 * Пишет и читает через RLS-клиент вызывающего: политики `auto_reply_*` — те же
 * `private.is_workspace_member`, что у остального. Явные `.eq("workspace_id")`
 * — defense-in-depth, как во всём `lib/db`.
 *
 * Прогон автоответчика (`lib/inngest/functions/auto-reply-pipeline.ts`) сюда не
 * ходит: у него свой admin-клиент и свои запросы, потому что он работает без
 * пользовательской сессии.
 */

export type AutoReplySettingsRow = {
  id: string;
  workspace_id: string;
  is_enabled: boolean;
  delay_minutes: number;
  fallback_template_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AutoReplyScenarioRow = {
  id: string;
  workspace_id: string;
  name: string;
  condition: string;
  examples: string[];
  action: ScenarioAction;
  reply_template_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type AutoReplyResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const SETTINGS_COLUMNS =
  "id, workspace_id, is_enabled, delay_minutes, fallback_template_id, created_at, updated_at";

const SCENARIO_COLUMNS =
  "id, workspace_id, name, condition, examples, action, reply_template_id, sort_order, created_at, updated_at";

/**
 * Настройки workspace. Строки может не быть: контур ничего не создаёт при
 * онбординге, и её отсутствие означает ровно то же, что выключенный
 * переключатель — так `create_workspace` остаётся нетронутой.
 */
export const DEFAULT_AUTO_REPLY_SETTINGS = {
  isEnabled: false,
  delayMinutes: 5,
  fallbackTemplateId: null,
} as const;

export async function getAutoReplySettings(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<AutoReplySettingsInput> {
  const { data, error } = await supabase
    .from("auto_reply_settings")
    .select(SETTINGS_COLUMNS)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("[auto-reply] failed to load settings", error);
    throw new Error("Unable to load auto-reply settings.");
  }

  if (!data) {
    return { ...DEFAULT_AUTO_REPLY_SETTINGS };
  }

  const row = data as AutoReplySettingsRow;

  return {
    isEnabled: row.is_enabled,
    delayMinutes: row.delay_minutes,
    fallbackTemplateId: row.fallback_template_id,
  };
}

export async function saveAutoReplySettings(
  supabase: SupabaseClient,
  workspaceId: string,
  input: AutoReplySettingsInput,
): Promise<AutoReplyResult<AutoReplySettingsInput>> {
  const validation = validateAutoReplySettings(input);

  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const { error } = await supabase.from("auto_reply_settings").upsert(
    {
      workspace_id: workspaceId,
      is_enabled: validation.value.isEnabled,
      delay_minutes: validation.value.delayMinutes,
      fallback_template_id: validation.value.fallbackTemplateId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );

  if (error) {
    console.error("[auto-reply] failed to save settings", error);
    return { ok: false, error: "Не удалось сохранить настройки автоответов." };
  }

  return { ok: true, data: validation.value };
}

export async function listAutoReplyScenarios(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<AutoReplyScenarioRow[]> {
  const { data, error } = await supabase
    .from("auto_reply_scenarios")
    .select(SCENARIO_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[auto-reply] failed to list scenarios", error);
    throw new Error("Unable to load auto-reply scenarios.");
  }

  return (data ?? []) as AutoReplyScenarioRow[];
}

function describeWriteError(error: { code?: string }): string {
  // 23505 — уникальный индекс по (workspace_id, lower(name)).
  return error.code === "23505"
    ? "Сценарий с таким названием уже есть."
    : "Не удалось сохранить сценарий.";
}

export async function createAutoReplyScenario(
  supabase: SupabaseClient,
  workspaceId: string,
  input: ScenarioInput,
): Promise<AutoReplyResult<AutoReplyScenarioRow>> {
  const validation = validateScenario(input);

  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  // Новый сценарий встаёт в конец списка: порядок разбора — смысловая
  // настройка, и менять её без ведома оператора нельзя.
  const existing = await listAutoReplyScenarios(supabase, workspaceId);
  const sortOrder = existing.reduce(
    (max, scenario) => Math.max(max, scenario.sort_order + 1),
    0,
  );

  const { data, error } = await supabase
    .from("auto_reply_scenarios")
    .insert({
      workspace_id: workspaceId,
      name: validation.value.name,
      condition: validation.value.condition,
      examples: validation.value.examples,
      action: validation.value.action,
      reply_template_id: validation.value.replyTemplateId,
      sort_order: sortOrder,
    })
    .select(SCENARIO_COLUMNS)
    .single();

  if (error) {
    console.error("[auto-reply] failed to create a scenario", error);
    return { ok: false, error: describeWriteError(error) };
  }

  return { ok: true, data: data as AutoReplyScenarioRow };
}

export async function updateAutoReplyScenario(
  supabase: SupabaseClient,
  workspaceId: string,
  scenarioId: string,
  input: ScenarioInput,
): Promise<AutoReplyResult<AutoReplyScenarioRow>> {
  const validation = validateScenario(input);

  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const { data, error } = await supabase
    .from("auto_reply_scenarios")
    .update({
      name: validation.value.name,
      condition: validation.value.condition,
      examples: validation.value.examples,
      action: validation.value.action,
      reply_template_id: validation.value.replyTemplateId,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", scenarioId)
    .select(SCENARIO_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[auto-reply] failed to update a scenario", error);
    return { ok: false, error: describeWriteError(error) };
  }
  if (!data) {
    return { ok: false, error: "Сценарий не найден — обновите страницу." };
  }

  return { ok: true, data: data as AutoReplyScenarioRow };
}

export async function deleteAutoReplyScenario(
  supabase: SupabaseClient,
  workspaceId: string,
  scenarioId: string,
): Promise<AutoReplyResult<{ id: string }>> {
  const { error } = await supabase
    .from("auto_reply_scenarios")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", scenarioId);

  if (error) {
    console.error("[auto-reply] failed to delete a scenario", error);
    return { ok: false, error: "Не удалось удалить сценарий." };
  }

  return { ok: true, data: { id: scenarioId } };
}

/**
 * Перестановка сценария на одну позицию.
 *
 * Меняем местами `sort_order` двух соседей, а не переписываем весь список:
 * двумя UPDATE'ами вместо N, и порядок остальных не зависит от того, чем
 * закончился запрос. Уникальности на `sort_order` нет намеренно — промежуточное
 * состояние между двумя запросами законно.
 */
export async function moveAutoReplyScenario(
  supabase: SupabaseClient,
  workspaceId: string,
  scenarioId: string,
  direction: "up" | "down",
): Promise<AutoReplyResult<{ id: string }>> {
  const scenarios = await listAutoReplyScenarios(supabase, workspaceId);
  const index = scenarios.findIndex((scenario) => scenario.id === scenarioId);

  if (index === -1) {
    return { ok: false, error: "Сценарий не найден — обновите страницу." };
  }

  const neighbourIndex = direction === "up" ? index - 1 : index + 1;
  const neighbour = scenarios[neighbourIndex];

  if (!neighbour) {
    // Край списка — не ошибка: кнопка просто ничего не делает.
    return { ok: true, data: { id: scenarioId } };
  }

  const current = scenarios[index]!;
  // Порядок читается по (sort_order, created_at), поэтому у соседей значения
  // могут совпадать — тогда обмен местами ничего не изменил бы.
  const currentOrder =
    current.sort_order === neighbour.sort_order
      ? index
      : current.sort_order;
  const neighbourOrder =
    current.sort_order === neighbour.sort_order
      ? neighbourIndex
      : neighbour.sort_order;

  for (const [id, sortOrder] of [
    [current.id, neighbourOrder],
    [neighbour.id, currentOrder],
  ] as const) {
    const { error } = await supabase
      .from("auto_reply_scenarios")
      .update({ sort_order: sortOrder, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("id", id);

    if (error) {
      console.error("[auto-reply] failed to reorder scenarios", error);
      return { ok: false, error: "Не удалось изменить порядок сценариев." };
    }
  }

  return { ok: true, data: { id: scenarioId } };
}
