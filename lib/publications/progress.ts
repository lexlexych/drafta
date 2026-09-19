// A stalled job can be re-dispatched manually; its per-job concurrency and
// checkpoints still protect work that is already running or completed.
export const GENERATION_STALL_MS = 10 * 60_000;
export const IMPORT_EXPIRY_MS = 270_000;
export function generationStalled(job: { status: string; updated_at?: string; error?: string | null } | null, now = Date.now()) {
  return job?.status === "pending" && (!!job.error || (!!job.updated_at && now - Date.parse(job.updated_at) >= GENERATION_STALL_MS));
}
export function importExpired(draft: { status: string; updated_at: string } | null, now = Date.now()) {
  return draft?.status === "importing" && now - Date.parse(draft.updated_at) >= IMPORT_EXPIRY_MS;
}
