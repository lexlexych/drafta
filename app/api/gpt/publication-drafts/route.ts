import { check, failure, gptContext, json, PublicationError, readJson } from "@/lib/publications/server";
import { hash } from "@/lib/publications/security";
import { importIdentity, validateImport } from "@/lib/publications/import";
import { inngest } from "@/lib/inngest/client";
import { publicationImportRequested } from "@/lib/publications/events";

export async function POST(request: Request) {
  try {
    const { db, grant } = await gptContext(request);
    const payload = await readJson(request);
    if (!validateImport(payload)) throw new PublicationError(400, "Нужны текст, заголовок, draft_id, request_id и 1 изображение либо 2–10 слайдов с file_order.");
    const { data: draft, error } = await db.from("publication_drafts").select("id")
      .eq("workspace_id", grant.workspace_id).eq("created_by", grant.user_id).eq("id", payload.draft_id).maybeSingle();
    check(error);
    if (!draft) throw new PublicationError(404, "Черновик не найден.");
    const { data: importId, error: reserveError } = await db.rpc("reserve_publication_import", {
      w: grant.workspace_id, d: draft.id, r: payload.request_id, h: hash(importIdentity(payload)), p: payload,
    });
    if (reserveError) {
      if (/draft_edited|import_in_progress|request_conflict/.test(reserveError.message)) {
        throw new PublicationError(409, "Черновик уже редактируется в Drafta, импорт ещё идёт или request_id использован для другого содержимого. Не перезаписывайте его.");
      }
      check(reserveError);
    }
    const { data: job, error: jobError } = await db.from("publication_imports").select("status")
      .eq("workspace_id", grant.workspace_id).eq("id", importId).single();
    check(jobError);
    if (job!.status === "pending") {
      // Durable row first. A retry or the recovery cron re-emits after a dispatch failure.
      await inngest.send(publicationImportRequested.create({ workspaceId: grant.workspace_id, importId }));
    }
    return json({ draft_id: draft.id, status: job!.status, url: `${new URL(request.url).origin}/comments?draft=${draft.id}`,
      message: job!.status === "ready" ? "Черновик сохранён." : job!.status === "error" ? "Изображения не загружены. Повторите отправку с новым request_id и свежими файлами." : "Принято. Изображения загружаются; это ещё не подтверждение завершения." }, job!.status === "pending" ? 202 : 200);
  } catch (error) { return failure(error); }
}
