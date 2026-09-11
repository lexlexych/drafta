export type PublicationContext = {
  kbIds: string[];
  brand: { audience?: string; tone?: string; colors?: string; logoAssetId?: string };
  language: string;
  aspectRatio: string;
  slideCount: number;
  textOnImages: boolean;
};
export type PublicationDraft = {
  id: string; title: string; body: string; kind: "image" | "carousel";
  status: "waiting" | "importing" | "ready" | "error";
  context: PublicationContext; asset_ids: string[]; edited_at: string | null;
  updated_at: string;
};
export const DEFAULT_CONTEXT: PublicationContext = {
  kbIds: [], brand: {}, language: "Уточнить в ChatGPT", aspectRatio: "4:5",
  slideCount: 5, textOnImages: true,
};
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Browser uploads go through a bounded application request; GPT downloads do not.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validId(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
export function validateContext(value: PublicationContext): boolean {
  return !!value && Array.isArray(value.kbIds) && value.kbIds.length <= 100 && value.kbIds.every(validId)
    && typeof value.language === "string" && value.language.length <= 100
    && ["1:1","4:5","9:16"].includes(value.aspectRatio)
    && Number.isInteger(value.slideCount) && value.slideCount >= 2 && value.slideCount <= 10
    && typeof value.textOnImages === "boolean" && !!value.brand
    && Object.keys(value.brand).every(key => ["audience","tone","colors","logoAssetId"].includes(key))
    && Object.values(value.brand).every(v => typeof v === "string" && v.length <= 2000)
    && (!value.brand.logoAssetId || validId(value.brand.logoAssetId));
}
