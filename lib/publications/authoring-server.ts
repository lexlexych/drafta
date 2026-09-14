import "server-only";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { check, PublicationError } from "./server";
import type { AuthoringInput, AuthoringJob, AuthoringState, ChannelChoice } from "./authoring";

const ERRORS: Record<string, string> = {
  publication_locked: "Материал уже отправлен. Его сохранённое содержимое зафиксировано.",
  revision_conflict: "Черновик изменился. Обновите страницу, чтобы продолжить с актуальной версией.",
  generation_in_progress: "Дождитесь завершения генерации.", idea_limit: "Для этого черновика уже предложено 12 идей.",
  daily_limit: "Достигнут дневной лимит генераций рабочего пространства (100).", retry_limit: "Лимит повторов исчерпан. Измените вводные и запустите новую генерацию.",
  channel_unavailable: "Один из выбранных каналов отключён. Обновите выбор.", knowledge_unavailable: "Один из выбранных элементов базы знаний недоступен.",
  invalid_assets: "Выбранное изображение недоступно.", member_unavailable: "Рабочее пространство недоступно.",
};
export async function authoringAction(workspaceId: string, draftId: string, action: string, payload: unknown, userId?: string) {
  const { data, error } = await createAdminSupabaseClient().rpc("publication_authoring_action", { w: workspaceId, d: draftId, action, p: payload, u: userId ?? null });
  if (error) {
    if (error.message.includes("draft_not_found")) throw new PublicationError(404, "Черновик не найден.");
    for (const [code, message] of Object.entries(ERRORS)) if (error.message.includes(code)) throw new PublicationError(code.includes("limit") ? 429 : 409, message);
    check(error);
  }
  return data;
}
export async function loadAuthoring(workspaceId: string, draftId: string) {
  const db = createAdminSupabaseClient();
  const [state, draft, channels, categories, jobs] = await Promise.all([
    db.from("publication_authoring").select("*").eq("workspace_id", workspaceId).eq("draft_id", draftId).maybeSingle(),
    db.from("publication_drafts").select("id,title,body,kind,status,source,asset_ids,updated_at").eq("workspace_id", workspaceId).eq("id", draftId).eq("source", "draft").maybeSingle(),
    db.from("channel_connections").select("id,name,platform").eq("workspace_id", workspaceId).eq("status", "active").order("created_at"),
    db.from("kb_files").select("id,name").eq("workspace_id", workspaceId).eq("is_enabled", true).order("sort_order"),
    db.from("publication_generation_jobs").select("id,kind,status,stage,error,result,input_revision").eq("workspace_id", workspaceId).eq("draft_id", draftId).order("created_at", { ascending: false }).limit(1),
  ]);
  for (const response of [state,draft,channels,categories,jobs]) check(response.error);
  if (!state.data || !draft.data) throw new PublicationError(404, "Черновик не найден.");
  return { state: state.data as AuthoringState, draft: draft.data, channels: channels.data as ChannelChoice[], categories: categories.data ?? [],
    job: (jobs.data?.[0] ?? null) as AuthoringJob | null, configured: !!process.env.OPENAI_API_KEY };
}
export async function loadSelectedContext(workspaceId: string, input: AuthoringInput) {
  const db = createAdminSupabaseClient();
  const [channels, knowledge] = await Promise.all([
    db.from("channel_connections").select("id,name,platform").eq("workspace_id", workspaceId).eq("status", "active").in("id", input.channelIds),
    input.kbIds.length ? db.from("kb_files").select("id,name,content").eq("workspace_id", workspaceId).eq("is_enabled", true).in("id", input.kbIds).order("sort_order") : Promise.resolve({ data: [], error: null }),
  ]);
  check(channels.error); check(knowledge.error);
  if (channels.data?.length !== input.channelIds.length) throw new PublicationError(409, ERRORS.channel_unavailable);
  if (knowledge.data?.length !== input.kbIds.length) throw new PublicationError(409, ERRORS.knowledge_unavailable);
  if (JSON.stringify(knowledge.data).length > 65000) throw new PublicationError(422, "Выбрано слишком много знаний. Уменьшите набор элементов.");
  return { channels: channels.data as ChannelChoice[], knowledge: knowledge.data.map(k=>({ name:k.name,content:k.content })) };
}
