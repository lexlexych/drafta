import "server-only";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { allowedImageUrl, imageMime } from "./security";
import { MAX_IMAGE_BYTES } from "./types";
import { check, PublicationError } from "./server";

export async function downloadImage(url: string) {
  if (!allowedImageUrl(url)) throw new Error("Image host not allowed");
  let response: Response;
  try { response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(25000), cache: "no-store" }); }
  catch { throw new Error("Image download failed"); }
  if (!response.ok || !response.body) throw new Error("Image download failed");
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) { await response.body.cancel(); throw new Error("Image too large"); }
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > MAX_IMAGE_BYTES) throw new Error("Image too large");
      parts.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(parts);
  if (!imageMime(bytes)) throw new Error("Invalid image signature");
  return bytes;
}
export async function storeImage(workspaceId: string, draftId: string, assetId: string, bytes: Uint8Array) {
  const mime = imageMime(bytes);
  if (!mime || bytes.length > MAX_IMAGE_BYTES) throw new PublicationError(400, "Загрузите PNG, JPEG или WebP размером до 10 МБ.");
  const db = createAdminSupabaseClient(); const path = `${workspaceId}/${draftId}/${assetId}`;
  const { error: uploadError } = await db.storage.from("publication-assets").upload(path, bytes, { contentType: mime, upsert: true });
  check(uploadError);
  const { error } = await db.from("publication_assets").upsert({ id: assetId, workspace_id: workspaceId, draft_id: draftId, storage_path: path, mime_type: mime });
  if (error) { await db.storage.from("publication-assets").remove([path]); check(error); }
  return assetId;
}
