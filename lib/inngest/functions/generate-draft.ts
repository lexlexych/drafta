import type { DraftGenerateRequestedEvent } from "../events";
import { inngest } from "../client";
import {
  draftGenerateCancelledEvent,
  draftGenerateRequestedEvent,
} from "../events";
import {
  failGeneratingDrafts,
  runDraftPipeline,
  type DraftPipelineSteps,
} from "./draft-pipeline";

/**
 * `scope: "env"` bounds how much of the workspace's LLM budget one operator can
 * burn by mashing the AI icon. The second key prevents two runs from finalizing
 * the same conversation concurrently while still allowing two different
 * conversations in a workspace to call the LLM.
 */
export const DRAFT_PIPELINE_CONCURRENCY = [
  {
    scope: "env" as const,
    key: '"workspace:" + event.data.workspaceId',
    limit: 2,
  },
  {
    scope: "env" as const,
    key: '"conversation:" + event.data.conversationId',
    limit: 1,
  },
] as const;

function stepAdapter(step: unknown): DraftPipelineSteps {
  // Inngest types step.run as Promise<Jsonify<T>> while every pipeline value
  // here is deliberately JSON-serializable and therefore round-trips as T.
  // Keeping that SDK-specific conditional type at this boundary makes the
  // shared pipeline directly testable without weakening its own contracts.
  return step as DraftPipelineSteps;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * The only way a DM draft ever comes into existence
 * (docs/architecture/07-data-flows.md#62-генерация-черновика): an incoming
 * message no longer starts anything, the operator presses the AI icon in the
 * thread composer and `draft/generate.requested` starts this run.
 *
 * `cancelOn` backs the «стоп» button. Inngest evaluates cancellation at step
 * boundaries, so a call to the provider that is already in flight still
 * finishes — but the run stops before `finalize`, and the action that sent the
 * event has already discarded the generating draft, which is what the composer
 * actually watches.
 */
export const generateDraft = inngest.createFunction(
  {
    id: "generate-draft",
    triggers: [draftGenerateRequestedEvent],
    concurrency: [...DRAFT_PIPELINE_CONCURRENCY],
    cancelOn: [
      {
        event: draftGenerateCancelledEvent,
        if: "async.data.conversationId == event.data.conversationId",
      },
    ],
    onFailure: async ({ event, step }) => {
      const original = event.data.event.data as Partial<DraftGenerateRequestedEvent>;
      if (!isId(original.workspaceId) || !isId(original.conversationId)) {
        return;
      }

      await step.run("fail-generating-drafts", () =>
        failGeneratingDrafts({
          workspaceId: original.workspaceId!,
          conversationId: original.conversationId!,
        }),
      );
    },
  },
  async ({ event, step, logger }) =>
    runDraftPipeline(event.data, stepAdapter(step), undefined, {
      info: (message) => logger.info(message),
    }),
);
