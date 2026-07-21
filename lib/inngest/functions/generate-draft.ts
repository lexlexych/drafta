import { inngest } from "../client";
import { interactionReceivedEvent } from "../events";

/**
 * Delivery skeleton for T-01. T-05 replaces this single logging step with
 * the debounced draft-generation pipeline; until then it deliberately reads,
 * logs, and returns IDs only.
 */
export const generateDraft = inngest.createFunction(
  {
    id: "generate-draft",
    triggers: [interactionReceivedEvent],
  },
  async ({ event, step, logger }) => {
    const { messageId, conversationId, workspaceId } = event.data;

    return step.run("log-event-identifiers", () => {
      logger.info(
        { messageId, conversationId, workspaceId },
        "generate-draft skeleton received interaction",
      );

      return { messageId, conversationId, workspaceId };
    });
  },
);
