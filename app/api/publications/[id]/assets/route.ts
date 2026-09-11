import { randomUUID } from "node:crypto";
import { check, failure, json, memberContext, PublicationError, sameOrigin } from "@/lib/publications/server";
import { storeImage } from "@/lib/publications/assets";
import { MAX_UPLOAD_BYTES, validId } from "@/lib/publications/types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { db, workspace } = await memberContext(); const { id } = await params;
    if (!validId(id)) throw new PublicationError(400, "Некорректный черновик.");
    // Raw bytes avoid buffering arbitrarily large multipart bodies.
    const { data: draft, error } = await db.from("publication_drafts").select("id,status")
      .eq("workspace_id", workspace.id).eq("id", id).maybeSingle();
    check(error); if (!draft) throw new PublicationError(404, "Черновик не найден.");
    if (draft.status === "importing") throw new PublicationError(409, "Дождитесь завершения импорта.");
    if (new URL(request.url).searchParams.get("purpose") !== "logo") {
      const { error: lockError } = await db.rpc("edit_publication_draft", { w: workspace.id, d: id });
      if (lockError) throw new PublicationError(409, "Не удалось начать редактирование. Обновите черновик.");
    }
    const reader = request.body?.getReader();
    if (!reader) throw new PublicationError(400, "Выберите изображение.");
    const parts: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > MAX_UPLOAD_BYTES) throw new PublicationError(413, "Для ручной загрузки выберите изображение до 4 МБ.");
        parts.push(value);
      }
    } finally { await reader.cancel(); }
    const assetId = await storeImage(workspace.id, id, randomUUID(), Buffer.concat(parts));
    return json({ id: assetId }, 201);
  } catch (error) { return failure(error); }
}
