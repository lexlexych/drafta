import type {
  ChannelAdapter,
  ConnectCallbackResult,
  GetConnectUrlInput,
  GetConnectUrlResult,
  NormalizedEvent,
  ParseConnectCallbackInput,
  ParseWebhookInput,
  SendMessageResult,
  VerifyWebhookInput,
} from "../types";
import { ChannelOperationNotImplementedError } from "../types";
import {
  getZernioConnectAuthUrl,
  ZernioApiError,
  type ZernioApiConfig,
} from "./api";
import { parseZernioConnectCallback } from "./connect";
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
 * adapter.test.ts). Reading `ZERNIO_WEBHOOK_SECRET` / `ZERNIO_API_BASE_URL` /
 * `ZERNIO_API_KEY` — and the `import "server-only"` guard that goes with any
 * secret per docs/architecture/13-environments-secrets.md — lives in
 * `./index.ts`, which builds the adapter instance the app registers and uses.
 *
 * `getApiConfig` is optional: the account-connect (OAuth) flow — the
 * `getConnectUrl` half of the adapter contract — is only wired when the REST
 * config is supplied, so unit tests that only exercise webhooks can construct
 * the adapter with just the webhook secret. `parseConnectCallback` needs no
 * config (it only parses the redirect's query), so it is always present.
 */
export function createZernioAdapter(
  getWebhookSecret: () => string,
  getApiConfig?: () => ZernioApiConfig,
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

  if (getApiConfig) {
    adapter.getConnectUrl = async (
      input: GetConnectUrlInput,
    ): Promise<GetConnectUrlResult> => {
      const config = getApiConfig();
      const providerProfileId = input.providerProfileId?.trim();

      if (!providerProfileId) {
        throw new ZernioApiError(
          "Workspace has no Zernio profile. Workspace provisioning is incomplete.",
        );
      }

      const url = await getZernioConnectAuthUrl(config, {
        platform: input.platform,
        profileId: providerProfileId,
        redirectUrl: input.redirectUrl,
      });

      return { url, providerProfileId };
    };
  }

  return adapter;
}
