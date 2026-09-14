import { randomUUID } from "node:crypto";
import { NonRetriableError } from "inngest";
import { inngest } from "../client";
import { publicationGenerationRequested } from "@/lib/publications/events";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { authoringAction, loadSelectedContext } from "@/lib/publications/authoring-server";
import { check } from "@/lib/publications/server";
import { storeImage } from "@/lib/publications/assets";
import { generateCarouselOutline, generatePublicationIdeas, generatePublicationText, generatePublicationImage, PublicationGenerationError, type PublicationUsage } from "@/lib/ai/publications";
import { validResult, type AuthoringInput, type AuthoringResult, type PostIdea, type PublicationVariant, type RevisionRequest } from "@/lib/publications/authoring";

type Snapshot = { input: AuthoringInput; ideas: PostIdea[]; variants: PublicationVariant[]; assetIds: string[]; title: string; revisionRequest?: RevisionRequest };
async function load(workspaceId: string, jobId: string) {
  const db = createAdminSupabaseClient();
  const { data: job, error } = await db.from("publication_generation_jobs").select("*").eq("workspace_id", workspaceId).eq("id", jobId).maybeSingle(); check(error);
  if (!job || job.status !== "pending") return null;
  const { data: member, error: memberError } = await db.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("user_id", job.created_by).maybeSingle(); check(memberError);
  if (!member) throw new NonRetriableError("Доступ автора к рабочему пространству отозван.");
  return { ...job, snapshot: job.snapshot as Snapshot, result: job.result as AuthoringResult | null, usage: job.usage as PublicationUsage[] };
}
async function checkpoint(workspaceId: string, jobId: string, patch: Record<string, unknown>) {
  const { error } = await createAdminSupabaseClient().from("publication_generation_jobs").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId).eq("id", jobId).eq("status", "pending"); check(error);
}
async function imageBytes(workspaceId: string, draftId: string, assetId: string) {
  const db = createAdminSupabaseClient();
  const { data, error } = await db.from("publication_assets").select("storage_path,mime_type").eq("workspace_id", workspaceId).eq("draft_id", draftId).eq("id", assetId).single(); check(error);
  const file = await db.storage.from("publication-assets").download(data!.storage_path); check(file.error);
  return { bytes: new Uint8Array(await file.data!.arrayBuffer()), mime: data!.mime_type };
}
export const publicationGeneration = inngest.createFunction({
  id: "publication-generation", triggers: [publicationGenerationRequested], retries: 2,
  concurrency: { limit: 1, key: "event.data.jobId" },
  onFailure: async ({ event }) => {
    const { workspaceId, jobId } = event.data.event.data;
    const { data: job, error } = await createAdminSupabaseClient().from("publication_generation_jobs").select("draft_id").eq("workspace_id", workspaceId).eq("id", jobId).maybeSingle(); check(error);
    if (job) await authoringAction(workspaceId, job.draft_id, "fail", { jobId, error: "Не удалось завершить генерацию. Готовые этапы сохранены; можно повторить попытку." });
  },
}, async ({ event, step }) => {
  const { workspaceId, jobId } = event.data;
  const assetId = await step.run("asset-id", () => randomUUID());
  // All content remains inside step callbacks. Only IDs are returned to Inngest.
  await step.run("text-or-ideas", async () => {
    const job = await load(workspaceId, jobId); if (!job) return;
    try {
      const context = await loadSelectedContext(workspaceId, job.snapshot.input);
      if (job.kind === "outline") {
        if (!job.result) {
          const generated = await generateCarouselOutline({ ...context, input: job.snapshot.input });
          await checkpoint(workspaceId, jobId, { result: { slides: generated.slides }, usage: [...job.usage, generated.usage] });
        }
        await authoringAction(workspaceId, job.draft_id, "complete", { jobId });
      } else if (job.kind === "ideas") {
        // Persist before completion: a replay after a DB failure needn't bill another call.
        let ideas = (job.result as unknown as { ideas?: PostIdea[] } | null)?.ideas;
        if (!ideas) {
          await checkpoint(workspaceId, jobId, { stage: "ideas" });
          const generated = await generatePublicationIdeas({ ...context, input: job.snapshot.input, ideas: job.snapshot.ideas });
          ideas = generated.ideas;
          await checkpoint(workspaceId, jobId, { result: { ideas }, usage: [...job.usage,generated.usage] });
        }
        await authoringAction(workspaceId, job.draft_id, "complete", { jobId, ideas });
      } else if (!job.result?.variants) {
        if (job.kind === "image" && job.snapshot.variants.length) {
          await checkpoint(workspaceId, jobId, { result: { title: job.snapshot.title, variants: job.snapshot.variants, assetIds: job.snapshot.assetIds, imagePrompt: job.snapshot.input.brief.description || job.snapshot.input.brief.topic } });
        } else {
          await checkpoint(workspaceId, jobId, { stage: "text" });
          const generated = await generatePublicationText({ ...context, input: job.snapshot.input, variants: job.snapshot.variants, revision: job.snapshot.revisionRequest });
          if (job.snapshot.revisionRequest?.channelId) generated.result.variants = generated.result.variants.map(v => v.channelId === job.snapshot.revisionRequest?.channelId ? v : job.snapshot.variants.find((old: PublicationVariant) => old.channelId === v.channelId) ?? v);
          if (job.kind === "text") generated.result.assetIds = job.snapshot.assetIds;
          await checkpoint(workspaceId, jobId, { result: generated.result, usage: [...job.usage,generated.usage] });
        }
      }
    } catch (error) {
      if (error instanceof PublicationGenerationError) {
        if (error.retryable) throw new Error(error.message);
        await authoringAction(workspaceId, job.draft_id, "fail", { jobId, error: error.message });
        return;
      }
      throw error;
    }
  });
  // Separate durable steps and checkpoints prevent a failed slide from regenerating its siblings.
  for (let index = 0; index < 10; index++) {
    await step.run(`image-${index}`, async () => {
      const job = await load(workspaceId, jobId);
      if (!job || ["ideas", "outline", "text"].includes(job.kind) || !["image", "carousel"].includes(job.snapshot.input.kind)) return;
      const input = job.snapshot.input;
      const edit = job.kind === "image";
      const count = edit ? 1 : input.kind === "carousel" ? input.slides?.length ?? 0 : 1;
      if (index >= count || (edit ? job.stage === "image-ready" : (job.result?.assetIds.length ?? 0) > index)) return;
      try {
        await loadSelectedContext(workspaceId, input);
        await checkpoint(workspaceId, jobId, { stage: `image-${index + 1}` });
        let id: string;
        if (!edit && input.kind === "image" && input.image.source === "upload" && input.image.assetId) {
          await imageBytes(workspaceId, job.draft_id, input.image.assetId);
          id = input.image.assetId;
        } else {
          const referenceId = edit ? job.snapshot.revisionRequest?.assetId : job.result?.assetIds[0] ?? input.image.referenceId;
          const reference = referenceId ? await imageBytes(workspaceId, job.draft_id, referenceId) : undefined;
          const prompt = input.kind === "carousel" && !edit ? `Slide ${index + 1} of ${count}. ${input.slides![index]}. Follow this approved on-slide text; keep the whole series visually consistent.` : job.result?.imagePrompt ?? input.brief.topic;
          const generated = await generatePublicationImage(input, prompt, reference, job.snapshot.revisionRequest?.instruction);
          id = index === 0 ? assetId : randomUUID();
          await storeImage(workspaceId, job.draft_id, id, generated.bytes);
          await checkpoint(workspaceId, jobId, { usage: [...job.usage, generated.usage] });
        }
        const assetIds = edit ? job.snapshot.assetIds.map((old: string) => old === job.snapshot.revisionRequest?.assetId ? id : old) : [...(job.result?.assetIds ?? []), id];
        await checkpoint(workspaceId, jobId, { result: { ...job.result, assetIds }, stage: edit ? "image-ready" : `slide-${index + 1}-ready` });
      } catch (error) {
        if (error instanceof PublicationGenerationError && !error.retryable) {
          await authoringAction(workspaceId, job.draft_id, "fail", { jobId, error: error.message }); return;
        }
        if (error instanceof PublicationGenerationError) throw new Error(error.message);
        throw error;
      }
    });
  }
  await step.run("finish", async () => {
    const job = await load(workspaceId, jobId); if (!job || ["ideas", "outline"].includes(job.kind)) return;
    if (!validResult(job.result, job.snapshot.input.channelIds) || (job.snapshot.input.kind === "image" && job.result.assetIds.length!==1)) throw new NonRetriableError("Неполный результат генерации.");
    if (job.snapshot.input.kind === "carousel" && job.kind === "post" && job.result.assetIds.length !== job.snapshot.input.slides?.length) throw new NonRetriableError("Карусель ещё не готова.");
    await authoringAction(workspaceId, job.draft_id, "complete", { jobId });
  });
  return { jobId };
});

export const recoverPublicationGenerations = inngest.createFunction({ id: "recover-publication-generations", triggers: [{ cron: "* * * * *" }], retries: 1 }, async ({ step }) => {
  const jobs = await step.run("pending-ids", async () => {
    const { data, error } = await createAdminSupabaseClient().from("publication_generation_jobs").select("id,workspace_id").eq("status", "pending")
      .lt("updated_at", new Date(Date.now()-60000).toISOString()).limit(100); check(error); return data ?? [];
  });
  if (jobs.length) await step.sendEvent("recover", jobs.map(j=>publicationGenerationRequested.create({ workspaceId: j.workspace_id, jobId: j.id })));
  await step.run("retention", async () => {
    const { error } = await createAdminSupabaseClient().from("publication_generation_jobs").delete().neq("status","pending")
      .lt("created_at",new Date(Date.now()-30*86400000).toISOString()); check(error);
  });
});
