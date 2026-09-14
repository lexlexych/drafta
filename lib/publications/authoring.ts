import { validId } from "./types";

export type PostIdea = { topic: string; goal: string; cta: string; audience: string; tone: string; description: string };
export type AuthoringInput = {
  channelIds: string[]; kbIds: string[]; kind: "image" | "text" | "carousel" | "video"; language: string;
  slides?: string[];
  video?: { duration: number; format: string };
  brief: PostIdea; aspectRatio: "1:1" | "4:5" | "9:16";
  image: { source: "generate" | "upload"; description: string; style: string; colors: string; caption: string; assetId: string | null; referenceId: string | null };
};
export type ChannelChoice = { id: string; name: string; platform: string };
export type PublicationVariant = { channelId: string; body: string };
export type AuthoringResult = { title: string; variants: PublicationVariant[]; imagePrompt?: string; assetIds: string[] };
export type RevisionRequest = { instruction: string; channelId?: string; assetId?: string };
export type AuthoringJob = { id: string; kind: "ideas" | "post" | "text" | "image" | "outline"; status: "pending" | "ready" | "error"; stage: string; error: string | null; result: AuthoringResult | null; input_revision: number };
export type AuthoringState = {
  input: AuthoringInput; revision: number; step: number; ideas: PostIdea[]; ideas_key: string;
  active_job_id: string | null; variants: PublicationVariant[];
};
export const EMPTY_IDEA: PostIdea = { topic: "", goal: "", cta: "", audience: "", tone: "Дружелюбный", description: "" };
export const DEFAULT_AUTHORING: AuthoringInput = {
  channelIds: [], kbIds: [], kind: "image", language: "Русский", brief: EMPTY_IDEA, aspectRatio: "4:5",
  image: { source: "generate", description: "", style: "Современная фотография", colors: "", caption: "", assetId: null, referenceId: null },
};
export const IDEA_FIELDS: { key: keyof PostIdea; label: string; limit: number }[] = [
  { key: "topic", label: "О чём пост?", limit: 500 },
  { key: "goal", label: "Какой результат нужен?", limit: 500 },
  { key: "cta", label: "Что должен сделать читатель?", limit: 500 },
  { key: "audience", label: "Для кого?", limit: 500 },
  { key: "tone", label: "Тон", limit: 200 },
  { key: "description", label: "Описание", limit: 6000 },
];
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, max: number): value is string { return typeof value === "string" && value.length <= max; }
function ids(value: unknown, max: number): value is string[] { return Array.isArray(value) && value.length <= max && value.every(validId) && new Set(value).size === value.length; }
export function validIdea(value: unknown): value is PostIdea {
  return object(value) && Object.keys(value).length === 6 && IDEA_FIELDS.every(f => text(value[f.key], f.limit));
}
export function validAuthoringInput(value: unknown): value is AuthoringInput {
  if (!object(value) || !object(value.image)) return false;
  const img = value.image;
  return ids(value.channelIds, 20) && ids(value.kbIds, 100) && ["image", "text", "carousel", "video"].includes(String(value.kind))
    && (value.slides === undefined || (Array.isArray(value.slides) && value.slides.length >= 2 && value.slides.length <= 10 && value.slides.every(s => text(s, 2000))))
    && (value.video === undefined || (object(value.video) && Number.isInteger(value.video.duration) && Number(value.video.duration) >= 15 && Number(value.video.duration) <= 600 && text(value.video.format, 500)))
    && text(value.language, 100) && !!value.language.trim() && validIdea(value.brief)
    && ["1:1", "4:5", "9:16"].includes(String(value.aspectRatio))
    && ["generate", "upload"].includes(String(img.source)) && text(img.description, 4000) && text(img.style, 500)
    && text(img.colors, 500) && text(img.caption, 500)
    && (img.assetId === null || validId(img.assetId)) && (img.referenceId === null || validId(img.referenceId));
}
export function ideaContextKey(input: AuthoringInput): string {
  return JSON.stringify([input.channelIds.slice().sort(), input.kbIds.slice().sort(), input.kind, input.language]);
}
export function generationIssue(input: AuthoringInput, kind: AuthoringJob["kind"]): string | null {
  if (!input.channelIds.length) return "Выберите хотя бы один подключённый канал.";
  if (kind === "ideas") return null;
  if (!input.brief.topic.trim()) return "Укажите, о чём пост.";
  if (!input.brief.goal.trim()) return "Укажите цель публикации.";
  if (input.kind === "image" && kind !== "text" && input.image.source === "upload" && !input.image.assetId) return "Загрузите картинку или выберите генерацию AI.";
  if (kind === "image" && !["image", "carousel"].includes(input.kind)) return "У этого формата нет картинки.";
  if (kind === "outline" && input.kind !== "carousel") return "Структура доступна для карусели.";
  if (kind === "post" && input.kind === "carousel" && (!input.slides || input.slides.some(s => !s.trim()))) return "Сначала подготовьте содержание каждого слайда.";
  return null;
}
export function validResult(value: unknown, channelIds: string[]): value is AuthoringResult {
  if (!object(value) || !text(value.title, 200) || !value.title.trim() || !Array.isArray(value.variants) || !ids(value.assetIds, 10)) return false;
  return value.variants.length === channelIds.length && new Set(value.variants.map(v => v?.channelId)).size === channelIds.length
    && value.variants.every(v => object(v) && typeof v.channelId === "string" && channelIds.includes(v.channelId) && text(v.body, 20000) && !!v.body.trim());
}
