import type { MessageSendRequestedEvent } from "../events";
import { inngest } from "../client";
import { messageSendRequestedEvent } from "../events";
import {
  markMessageSendFailed,
  runSendMessagePipeline,
  type SendMessageSteps,
} from "./send-pipeline";

/**
 * Per-conversation limit 1 both orders sends within a thread and prevents a
 * duplicated event from producing two parallel sends of the same message
 * (the pipeline's guards then no-op the loser). The workspace pool bounds
 * pressure on the provider per tenant, mirroring the draft pipeline.
 */
export const SEND_PIPELINE_CONCURRENCY = [
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

function stepAdapter(step: unknown): SendMessageSteps {
  // Same boundary cast as generate-draft.ts: Inngest types step.run as
  // Promise<Jsonify<T>> while every pipeline value is JSON-serializable and
  // round-trips as T.
  return step as SendMessageSteps;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * `send-message` (docs/architecture/07-data-flows.md#65 список функций):
 * outgoing sends run through Inngest with retries, never inside the request
 * (vibecoding rule 8). Retries exhausted (or a NonRetriableError from the
 * provider) → onFailure marks the message `failed`, which surfaces the
 * retry button in the inbox thread.
 */
export const sendMessage = inngest.createFunction(
  {
    id: "send-message",
    triggers: [messageSendRequestedEvent],
    retries: 4,
    concurrency: [...SEND_PIPELINE_CONCURRENCY],
    onFailure: async ({ event, step }) => {
      const original = event.data.event.data as Partial<MessageSendRequestedEvent>;
      if (!isId(original.workspaceId) || !isId(original.messageId)) {
        return;
      }

      await step.run("mark-send-failed", () =>
        markMessageSendFailed({
          workspaceId: original.workspaceId!,
          messageId: original.messageId!,
        }),
      );
    },
  },
  async ({ event, step }) =>
    runSendMessagePipeline(event.data, stepAdapter(step)),
);
