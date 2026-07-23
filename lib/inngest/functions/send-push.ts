import { inngest } from "../client";
import { pushNotifyRequestedEvent } from "../events";
import {
  runSendPushPipeline,
  type SendPushSteps,
} from "./send-push-pipeline";

/**
 * One send per workspace at a time bounds pressure while keeping tenants
 * independent; a redelivered `push/notify.requested` for the same message just
 * re-runs the idempotent pipeline (step memoization prevents double-sends).
 */
export const SEND_PUSH_CONCURRENCY = [
  {
    scope: "env" as const,
    key: '"workspace:" + event.data.workspaceId',
    limit: 4,
  },
] as const;

function stepAdapter(step: unknown): SendPushSteps {
  // Same boundary cast as the other pipelines: Inngest types step.run as
  // Promise<Jsonify<T>> while every pipeline value is JSON-serializable.
  return step as SendPushSteps;
}

/**
 * `send-push` (docs/architecture/11-realtime-pwa.md#web-push): instant Web Push
 * for users in the «каждое входящее» mode. Runs through Inngest with retries
 * (vibecoding rule 8). A missed push is not fatal — the digest covers it — so
 * there is no failure-marking onFailure like send-message has.
 */
export const sendPush = inngest.createFunction(
  {
    id: "send-push",
    triggers: [pushNotifyRequestedEvent],
    retries: 3,
    concurrency: [...SEND_PUSH_CONCURRENCY],
  },
  async ({ event, step }) =>
    runSendPushPipeline(event.data, stepAdapter(step)),
);
