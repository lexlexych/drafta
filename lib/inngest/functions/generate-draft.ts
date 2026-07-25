import type {
  DraftRegenerateRequestedEvent,
  InteractionReceivedEvent,
} from "../events";
import { inngest } from "../client";
import {
  draftRegenerateRequestedEvent,
  interactionReceivedEvent,
} from "../events";
import {
  cleanupGeneratingDrafts,
  runDraftPipeline,
  type DraftPipelineSteps,
} from "./draft-pipeline";

/**
 * `scope: "env"` makes the workspace pool shared by normal generation and
 * regeneration. The second key prevents two runs from finalizing the same
 * conversation concurrently while still allowing two different conversations
 * in a workspace to call the LLM.
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

export const generateDraft = inngest.createFunction(
  {
    id: "generate-draft",
    triggers: [interactionReceivedEvent],
    concurrency: [...DRAFT_PIPELINE_CONCURRENCY],
    onFailure: async ({ event, step }) => {
      const original = event.data.event.data as Partial<InteractionReceivedEvent>;
      if (
        !isId(original.workspaceId) ||
        !isId(original.conversationId) ||
        !isId(original.messageId)
      ) {
        return;
      }

      await step.run("cleanup-generating-drafts", () =>
        cleanupGeneratingDrafts({
          workspaceId: original.workspaceId!,
          conversationId: original.conversationId!,
          lastMessageId: original.messageId!,
        }),
      );
    },
  },
  async ({ event, step, logger }) =>
    runDraftPipeline(
      {
        ...event.data,
        regenerate: false,
      },
      stepAdapter(step),
      undefined,
      { info: (message) => logger.info(message) },
    ),
);

export const regenerateDraft = inngest.createFunction(
  {
    id: "regenerate-draft",
    triggers: [draftRegenerateRequestedEvent],
    concurrency: [...DRAFT_PIPELINE_CONCURRENCY],
    onFailure: async ({ event, step }) => {
      const original = event.data.event.data as Partial<DraftRegenerateRequestedEvent>;
      if (!isId(original.workspaceId) || !isId(original.conversationId)) {
        return;
      }

      await step.run("cleanup-generating-drafts", () =>
        cleanupGeneratingDrafts({
          workspaceId: original.workspaceId!,
          conversationId: original.conversationId!,
        }),
      );
    },
  },
  async ({ event, step, logger }) =>
    runDraftPipeline(
      {
        ...event.data,
        regenerate: true,
      },
      stepAdapter(step),
      undefined,
      { info: (message) => logger.info(message) },
    ),
);
