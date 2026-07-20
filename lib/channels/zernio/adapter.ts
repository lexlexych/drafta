import type {
  ChannelAdapter,
  ConnectCallbackResult,
  GetConnectUrlInput,
  NormalizedEvent,
  ParseConnectCallbackInput,
  ParseWebhookInput,
  SendMessageResult,
  VerifyWebhookInput,
} from "../types";
import { ChannelOperationNotImplementedError } from "../types";
import {
  buildZernioConnectUrl,
  parseZernioConnectCallback,
  type ZernioConnectConfig,
} from "./connect";
import { parseZernioWebhook } from "./parse";
import { verifyZernioSignature } from "./verify";

const PROVIDER = "zernio" as const;

/**
 * Builds the Zernio `ChannelAdapter` (docs/architecture/05-channels.md —
 * interface's four operations).
 *
 * Secrets/config are taken as injected getters rather than read from
 * `process.env` directly, so this factory stays a pure function of its
 * inputs: it never touches the environment and never imports the
 * `"server-only"` guard, which keeps it trivially unit-testable (see
 * adapter.test.ts). Reading `ZERNIO_WEBHOOK_SECRET` / `ZERNIO_CONNECT_URL` /
 * `ZERNIO_API_KEY` — and the `import "server-only"` guard that goes with any
 * secret per docs/architecture/13-environments-secrets.md — lives in
 * `./index.ts`, which builds the adapter instance the app registers and uses.
 *
 * `getConnectConfig` is optional: the account-connect (OAuth) flow — the
 * `getConnectUrl` half of the adapter contract — is only wired when connect
 * config is supplied, so unit tests that only exercise webhooks can construct
 * the adapter with just the webhook secret. `parseConnectCallback` needs no
 * config (it only parses the redirect's query), so it is always present.
 */
export function createZernioAdapter(
  getWebhookSecret: () => string,
  getConnectConfig?: () => ZernioConnectConfig,
): ChannelAdapter {
  const adapter: ChannelAdapter = {
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

    parseConnectCallback(input: ParseConnectCallbackInput): ConnectCallbackResult {
      return parseZernioConnectCallback(input.query);
    },
  };

  if (getConnectConfig) {
    adapter.getConnectUrl = (input: GetConnectUrlInput): string =>
      buildZernioConnectUrl(getConnectConfig(), input);
  }

  return adapter;
}
