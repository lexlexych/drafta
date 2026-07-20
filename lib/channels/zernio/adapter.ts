import type {
  ChannelAdapter,
  NormalizedEvent,
  ParseWebhookInput,
  SendMessageResult,
  VerifyWebhookInput,
} from "../types";
import { ChannelOperationNotImplementedError } from "../types";
import { parseZernioWebhook } from "./parse";
import { verifyZernioSignature } from "./verify";

const PROVIDER = "zernio" as const;

/**
 * Builds the Zernio `ChannelAdapter` (docs/architecture/05-channels.md —
 * interface's four operations).
 *
 * The webhook secret is taken as an injected getter rather than read from
 * `process.env` directly, so this factory stays a pure function of its
 * inputs: it never touches the environment and never imports the
 * `"server-only"` guard, which keeps it trivially unit-testable (see
 * adapter.test.ts). Reading `ZERNIO_WEBHOOK_SECRET` — and the
 * `import "server-only"` guard that goes with any secret per
 * docs/architecture/13-environments-secrets.md — lives in `./index.ts`,
 * which builds the adapter instance the app actually registers and uses.
 */
export function createZernioAdapter(
  getWebhookSecret: () => string,
): ChannelAdapter {
  return {
    provider: PROVIDER,

    verifyWebhook(input: VerifyWebhookInput): boolean {
      return verifyZernioSignature(input, getWebhookSecret());
    },

    parseWebhook(input: ParseWebhookInput): NormalizedEvent[] {
      return parseZernioWebhook(input);
    },

    /**
     * Outgoing sends are stage 3 of the rollout plan
     * (docs/architecture/16-rollout-plan.md) — this is the explicit stub the
     * adapter interface requires until then
     * (docs/epics/epic_02/T-01-channels-core.md).
     */
    async sendMessage(): Promise<SendMessageResult> {
      throw new ChannelOperationNotImplementedError(PROVIDER, "sendMessage");
    },
  };
}
