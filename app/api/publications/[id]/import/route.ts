import { check, failure, json, memberContext, PublicationError, sameOrigin } from "@/lib/publications/server";
import { validId } from "@/lib/publications/types";
import { IMPORT_EXPIRY_MS } from "@/lib/publications/progress";
import { publicationImportRequested } from "@/lib/publications/events";
import { dispatchWorkflow } from "@/lib/workflows/start";
import { reconcileSubject } from "@/lib/workflows/recovery";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { workspace, db } = await memberContext();
    const { id } = await params;
    if (!validId(id)) throw new PublicationError(400, "Некорректный черновик.");
    const { data: draft, error } = await db.from("publication_drafts").select("active_import_id,status,edited_at")
      .eq("workspace_id", workspace.id).eq("id", id).eq("source", "chatgpt").maybeSingle();
    check(error);
    if (!draft) throw new PublicationError(404, "Черновик не найден.");
    if (draft.edited_at) throw new PublicationError(409, "Черновик уже редактируется вручную.");
    if (draft.status === "ready") return json({ status: "ready" });
    const freshFiles = () => json({ status: "error", requiresFreshFiles: true,
      message: "Откройте ChatGPT и попросите повторно передать изображения в этот черновик со свежими ссылками." });
    if (!draft.active_import_id) return freshFiles();
    await reconcileSubject(workspace.id,'publication-import',draft.active_import_id);
    const { data: job, error: jobError } = await db.from("publication_imports").select("id,status,created_at")
      .eq("workspace_id", workspace.id).eq("draft_id", id).eq("id", draft.active_import_id).maybeSingle();
    check(jobError);
    if (!job || !['pending','error'].includes(job.status)) return freshFiles();
    if (Date.now() - Date.parse(job.created_at) >= IMPORT_EXPIRY_MS) {
      const { error: finishError } = await db.rpc("finish_publication_import", { w: workspace.id, i: job.id, a: [], failed: true });
      check(finishError);
      return freshFiles();
    }
    try {
      if(job.status==='error') {
        const reset=await db.rpc('retry_workflow_import',{w:workspace.id,d:id,i:job.id});check(reset.error);
        if(!reset.data)return freshFiles();
      }
      await dispatchWorkflow(publicationImportRequested.create({ workspaceId: workspace.id, importId: job.id }));
    } catch {
      throw new PublicationError(503, "Не удалось запустить импорт. Нажмите «Повторить импорт».");
    }
    return json({ status: "pending", message: "Импорт запущен повторно." }, 202);
  } catch (error) { return failure(error); }
}
