import { inngest } from "../client";
import {
  runPushDigestPipeline,
  type PushDigestSteps,
} from "./push-digest-pipeline";

function stepAdapter(step: unknown): PushDigestSteps {
  // Same boundary cast as the other pipelines: every pipeline value is
  // JSON-serializable and round-trips through step.run.
  return step as PushDigestSteps;
}

/**
 * `push-digest` (docs/architecture/07-data-flows.md#65, docs/architecture/11-realtime-pwa.md):
 * cron that sends interval summaries to users in «дайджест» mode. Fires every 5
 * minutes; the pipeline itself checks each recipient's own interval against
 * `last_digest_at`, so per-user cadence is honoured without a per-user schedule.
 * `now` is captured in a step so it stays stable across retries.
 */
export const pushDigest = inngest.createFunction(
  {
    id: "push-digest",
    triggers: [{ cron: "*/5 * * * *" }],
    concurrency: [{ scope: "env", key: '"push-digest"', limit: 1 }],
  },
  async ({ step }) => {
    const nowIso = await step.run("capture-now", () => new Date().toISOString());
    return runPushDigestPipeline(new Date(nowIso), stepAdapter(step));
  },
);
