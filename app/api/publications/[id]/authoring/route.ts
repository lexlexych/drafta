import { authoringAction, loadAuthoring, loadSelectedContext } from "@/lib/publications/authoring-server";
import { generationIssue, ideaContextKey, validAuthoringInput, validResult } from "@/lib/publications/authoring";
import { check, failure, json, memberContext, PublicationError, readJson, sameOrigin } from "@/lib/publications/server";
import { validId } from "@/lib/publications/types";
import { publicationGenerationRequested } from "@/lib/publications/events";
import { inngest } from "@/lib/inngest/client";
import { generationStalled } from "@/lib/publications/progress";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const { workspace } = await memberContext(); const { id } = await params;
    if (!validId(id)) throw new PublicationError(400, "Некорректный черновик.");
    return json(await loadAuthoring(workspace.id, id));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const { workspace, user, db } = await memberContext(); const { id } = await params;
    if (!validId(id)) throw new PublicationError(400, "Некорректный черновик.");
    const p = await readJson(request);
    let resumeJob = null;
    if (!p || !Number.isInteger(p.revision) || p.revision < 0) throw new PublicationError(400, "Некорректная версия черновика.");
    if (p.action === "save") {
      if (!validAuthoringInput(p.input) || !Number.isInteger(p.step) || p.step<1 || p.step>6) throw new PublicationError(400, "Проверьте поля публикации.");
    } else if (["start","retry","apply","edit","discard"].includes(p.action)) {
      const current = await loadAuthoring(workspace.id, id);
      if (p.action === "retry" && current.job?.status === "pending") {
        if (p.jobId !== current.job.id || current.state.active_job_id !== current.job.id || p.revision !== current.state.revision)
          throw new PublicationError(409, "Задача изменилась. Обновите страницу.");
        if (!generationStalled(current.job)) throw new PublicationError(409, "Генерация ещё выполняется. Дождитесь результата.");
        resumeJob = current.job;
      }
      if (p.action === "start" || p.action === "retry") {
        if (!process.env.OPENAI_API_KEY) throw new PublicationError(503, "Генерация Drafta ещё не настроена. Требуется серверный ключ OpenAI API.");
        const kind = p.action === "retry" ? current.job?.kind : p.kind;
        if (!["ideas","post","text","image","outline"].includes(kind)) throw new PublicationError(400, "Недоступный тип генерации.");
        const issue = generationIssue(current.state.input, kind); if (issue) throw new PublicationError(400, issue);
        await loadSelectedContext(workspace.id, current.state.input);
        if (p.action === "start") {
          if (!validId(p.requestId)) throw new PublicationError(400, "Некорректный запрос.");
          if (["text", "image"].includes(kind)) {
            const r = p.revisionRequest;
            if (!r || typeof r.instruction !== "string" || !r.instruction.trim() || r.instruction.length > 2000) throw new PublicationError(400, "Опишите, что изменить.");
            if (kind === "image" && (!validId(r.assetId) || !current.draft.asset_ids.includes(r.assetId))) throw new PublicationError(400, "Выберите сохранённое изображение.");
            if (kind === "text" && (!validId(r.channelId) || !current.state.variants.some(v => v.channelId === r.channelId))) throw new PublicationError(400, "Выберите сохранённую версию текста.");
            p.revisionRequest = { instruction: r.instruction.trim(), ...(kind === "image" ? {assetId: r.assetId} : {channelId: r.channelId}) };
          } else delete p.revisionRequest;
          p.ideasKey = ideaContextKey(current.state.input);
        }
      }
      if (["retry","apply"].includes(p.action) && !validId(p.jobId)) throw new PublicationError(400, "Некорректная задача.");
      if (p.action === "edit" && !validResult(p.result, current.state.input.channelIds)) throw new PublicationError(400, "Проверьте текст и назначения публикации.");
      if (p.action === "edit" && (current.state.input.kind === "carousel" ? p.result.assetIds.length < 2 : ["text","video"].includes(current.state.input.kind) ? p.result.assetIds.length !== 0 : p.result.assetIds.length !== 1)) throw new PublicationError(400, "Проверьте картинку публикации.");
    } else throw new PublicationError(400, "Недоступное действие.");
    const result = resumeJob ?? await authoringAction(workspace.id, id, p.action, p, user.id);
    if (["start","retry"].includes(p.action) && result.status === "pending") {
      try { await inngest.send(publicationGenerationRequested.create({ workspaceId: workspace.id, jobId: result.id })); }
      catch {
        const message = "Не удалось подтвердить запуск генерации. Нажмите «Повторить».";
        // A lost acknowledgement does not prove the worker never started.
        // Preserve its state/checkpoints and allow re-dispatch of the same ID.
        const { error } = await db.from("publication_generation_jobs").update({ error: message })
          .eq("workspace_id", workspace.id).eq("draft_id", id).eq("id", result.id).eq("status", "pending");
        check(error);
        throw new PublicationError(503, message);
      }
    }
    return json(result, ["start","retry"].includes(p.action) ? 202 : 200);
  } catch (error) { return failure(error); }
}
