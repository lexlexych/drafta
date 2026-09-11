import { check, failure, json, memberContext, PublicationError, readJson, sameOrigin } from "@/lib/publications/server";
import { validId, validateContext } from "@/lib/publications/types";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { db, workspace } = await memberContext(); const { id } = await params;
    if (!validId(id)) throw new PublicationError(400, "Некорректный черновик.");
    const input = await readJson(request);
    const { data: draft, error: loadError } = await db.from("publication_drafts").select("id,status")
      .eq("workspace_id", workspace.id).eq("id", id).maybeSingle();
    check(loadError); if (!draft) throw new PublicationError(404, "Черновик не найден.");
    if (input.action === "context" || input.action === "save") {
      if (!validateContext(input.context) || !["image","carousel"].includes(input.kind)
        || typeof input.title !== "string" || !input.title.trim() || input.title.length > 200) throw new PublicationError(400, "Проверьте настройки публикации.");
      if (input.context.kbIds.length) {
        const { data: categories, error } = await db.from("kb_files").select("id").eq("workspace_id", workspace.id).eq("is_enabled", true).in("id", input.context.kbIds);
        check(error);
        if (new Set(input.context.kbIds).size !== categories?.length) throw new PublicationError(400, "Категория недоступна.");
      }
      if (input.context.brand.logoAssetId) {
        const { data: asset, error } = await db.from("publication_assets").select("id").eq("workspace_id", workspace.id).eq("draft_id", id).eq("id", input.context.brand.logoAssetId).maybeSingle();
        check(error); if (!asset) throw new PublicationError(400, "Логотип недоступен.");
      }
    }
    if (input.action === "context") {
      const { error } = await db.rpc("configure_publication_draft", { w: workspace.id, d: id, t: input.title.trim(), k: input.kind, c: input.context });
      if (error?.message.includes("import_in_progress")) throw new PublicationError(409, "Дождитесь завершения импорта.");
      check(error);
    } else if (input.action === "lock" || input.action === "save") {
      let content = null;
      if (input.action === "save") {
        if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 200
          || typeof input.body !== "string" || input.body.length > 20000
          || !["image","carousel"].includes(input.kind) || !Array.isArray(input.asset_ids)
          || input.asset_ids.length > 10 || !input.asset_ids.every(validId)
          || new Set(input.asset_ids).size !== input.asset_ids.length) throw new PublicationError(400, "Проверьте текст и изображения.");
        content = { title: input.title.trim(), body: input.body, kind: input.kind, asset_ids: input.asset_ids, context: input.context };
      }
      const { error } = await db.rpc("edit_publication_draft", { w: workspace.id, d: id, content });
      if (error?.message.includes("import_in_progress")) throw new PublicationError(409, "Дождитесь завершения импорта.");
      check(error);
    } else throw new PublicationError(400, "Некорректное действие.");
    return json({ ok: true });
  } catch (error) { return failure(error); }
}
