import { allowedImageUrl } from "./security";
import { validId } from "./types";

export type ImportPayload = {
  draft_id: string; request_id: string; title: string; text: string;
  kind: "image" | "carousel";
  openaiFileIdRefs: { id: string; download_link: string; mime_type: string; name: string }[];
  file_order: string[];
};
export function validateImport(value: unknown): value is ImportPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as ImportPayload;
  return validId(v.draft_id) && validId(v.request_id)
    && typeof v.title === "string" && v.title.trim().length > 0 && v.title.length <= 200
    && typeof v.text === "string" && v.text.trim().length > 0 && v.text.length <= 20000
    && ["image","carousel"].includes(v.kind)
    && Array.isArray(v.openaiFileIdRefs) && v.openaiFileIdRefs.length >= (v.kind === "carousel" ? 2 : 1)
    && v.openaiFileIdRefs.length <= (v.kind === "image" ? 1 : 10)
    && v.openaiFileIdRefs.every(f => f && typeof f.id === "string" && f.id.length <= 200
      && typeof f.download_link === "string" && allowedImageUrl(f.download_link)
      && ["image/png","image/jpeg","image/webp"].includes(f.mime_type))
    && Array.isArray(v.file_order) && v.file_order.length === v.openaiFileIdRefs.length
    && new Set(v.file_order).size === v.file_order.length
    && v.file_order.every(id => v.openaiFileIdRefs.some(f => f.id === id));
}
export function importIdentity(payload: ImportPayload) {
  // Temporary signed download URLs may change on retry. Identity describes content.
  return JSON.stringify({ draft: payload.draft_id, title: payload.title, text: payload.text,
    kind: payload.kind, files: payload.file_order });
}
