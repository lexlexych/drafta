import "server-only";

import {
  AI_REQUEST_LOG_RETENTION_DAYS,
  deleteAiRequestLogsBefore,
} from "@/lib/db/ai-request-log";

import { inngest } from "../client";

const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionCutoff(now: Date): string {
  return new Date(
    now.getTime() - AI_REQUEST_LOG_RETENTION_DAYS * DAY_MS,
  ).toISOString();
}

/**
 * `cleanup-ai-request-log` (docs/architecture/07-data-flows.md#76,
 * docs/architecture/15-compliance-gdpr.md): the retention half of
 * `public.ai_request_log`. That table holds the verbatim prompts and answers —
 * masked, but still conversation content — so it is only defensible with a
 * bounded lifetime, and this cron is what bounds it.
 *
 * Runs nightly across all workspaces at once: rows are deleted by age alone, so
 * there is nothing to schedule per tenant. `now` is captured in a step so a
 * retried run reuses the same cutoff instead of drifting forward.
 */
export const cleanupAiRequestLog = inngest.createFunction(
  {
    id: "cleanup-ai-request-log",
    triggers: [{ cron: "0 3 * * *" }],
    concurrency: [
      { scope: "env", key: '"cleanup-ai-request-log"', limit: 1 },
    ],
  },
  async ({ step }) => {
    const nowIso = await step.run("capture-now", () => new Date().toISOString());
    const deleted = await step.run("delete-expired", () =>
      deleteAiRequestLogsBefore(retentionCutoff(new Date(nowIso))),
    );

    return { deleted };
  },
);
