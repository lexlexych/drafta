import type {
  ChannelAdapter,
  ConnectCallbackResult,
  DisconnectAccountInput,
  FetchParticipantAvatarInput,
  FetchParticipantAvatarResult,
  FetchPostThumbnailInput,
  FetchPostThumbnailResult,
  SendCommentPrivateReplyInput,
  SendCommentPrivateReplyResult,
  GetConnectUrlInput,
  GetConnectUrlResult,
  NormalizedEvent,
  ParseConnectCallbackInput,
  ParseWebhookInput,
  SendMessageInput,
  SendMessageResult,
  VerifyWebhookInput,
} from "../types";
import { ChannelOperationNotImplementedError } from "../types";
import {
  deleteZernioAccount,
  getZernioConversationParticipant,
  getZernioConnectAuthUrl,
  listZernioConversationParticipants,
  listZernioPostThumbnails,
  sendZernioCommentPrivateReply,
  sendZernioCommentReply,
  sendZernioInboxMessage,
  ZernioApiError,
  type ZernioApiConfig,
} from "./api";
import { parseZernioConnectCallback } from "./connect";
import { parseZernioWebhook } from "./parse";
import { verifyZernioSignature } from "./verify";

const PROVIDER = "zernio" as const;
const MAX_POST_THUMBNAIL_PAGES = 10;

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
 * `getApiConfig` is optional: the operations that call Zernio's REST API —
 * `getConnectUrl` and `disconnectAccount` — are only wired when the REST
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
     * Stage 3 of the rollout plan (docs/architecture/16-rollout-plan.md,
     * docs/architecture/07-data-flows.md#63-отправка-ответа): send the text
     * through Zernio's inbox API. Attachments stay out of the MVP send path
     * (mirroring the inbound metadata-only scope) — only `text` is sent.
     * Without the REST config (webhook-only adapter in tests) the operation
     * remains the explicit NotImplemented stub the interface requires.
     *
     * Stage 5: a comment reply (`interactionKind === "comment"`) is published
     * against the specific parent comment (`parentExternalId`) rather than
     * into the DM conversation thread.
     */
    async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
      if (!getApiConfig) {
        throw new ChannelOperationNotImplementedError(PROVIDER, "sendMessage");
      }

      if (input.interactionKind === "comment") {
        const commentId = input.parentExternalId?.trim();
        if (!commentId) {
          // A comment reply must target a specific comment. Missing here means
          // the outgoing row lost its `parent_external_id` — a bug, not a
          // transient failure, so it surfaces rather than sending a stray DM.
          throw new ZernioApiError(
            "Comment reply is missing the parent comment id to reply to.",
          );
        }

        const providerCommentId = await sendZernioCommentReply(getApiConfig(), {
          accountId: input.externalAccountId,
          // conversations.external_id for a comment thread is the post's
          // platformPostId — the {postId} the reply endpoint addresses.
          postExternalId: input.conversationExternalId,
          commentId,
          text: input.text,
        });

        return { providerMessageId: providerCommentId };
      }

      const providerMessageId = await sendZernioInboxMessage(getApiConfig(), {
        accountId: input.externalAccountId,
        conversationExternalId: input.conversationExternalId,
        text: input.text,
      });

      return { providerMessageId };
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

    adapter.disconnectAccount = async (
      input: DisconnectAccountInput,
    ): Promise<void> => {
      await deleteZernioAccount(getApiConfig(), input.externalAccountId);
    };

    adapter.fetchParticipantAvatar = async (
      input: FetchParticipantAvatarInput,
    ): Promise<FetchParticipantAvatarResult> => {
      let participantFoundDirectly = false;

      if (input.conversationExternalId) {
        const participant = await getZernioConversationParticipant(
          getApiConfig(),
          {
            accountId: input.externalAccountId,
            conversationExternalId: input.conversationExternalId,
            participantExternalId: input.participantExternalId,
          },
        );
        if (
          participant?.participantExternalId === input.participantExternalId
        ) {
          participantFoundDirectly = true;
          if (participant.avatarUrl) {
            return { avatarUrl: participant.avatarUrl, found: true };
          }
        }
      }

      let cursor: string | undefined;
      for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
        const page = await listZernioConversationParticipants(getApiConfig(), {
          accountId: input.externalAccountId,
          cursor,
          limit: 100,
        });
        const participant = page.participants.find(
          (candidate) =>
            candidate.participantExternalId === input.participantExternalId,
        );
        if (participant) {
          return { avatarUrl: participant.avatarUrl, found: true };
        }
        if (!page.nextCursor) {
          break;
        }
        cursor = page.nextCursor;
      }

      return { avatarUrl: null, found: participantFoundDirectly };
    };

    adapter.sendCommentPrivateReply = async (
      input: SendCommentPrivateReplyInput,
    ): Promise<SendCommentPrivateReplyResult> => {
      const providerMessageId = await sendZernioCommentPrivateReply(
        getApiConfig(),
        {
          accountId: input.externalAccountId,
          postExternalId: input.postExternalId,
          commentExternalId: input.commentExternalId,
          text: input.text,
        },
      );

      return { providerMessageId };
    };

    adapter.fetchPostThumbnail = async (
      input: FetchPostThumbnailInput,
    ): Promise<FetchPostThumbnailResult> => {
      let cursor: string | undefined;

      for (let pageNumber = 0; pageNumber < MAX_POST_THUMBNAIL_PAGES; pageNumber += 1) {
        const page = await listZernioPostThumbnails(getApiConfig(), {
          accountId: input.externalAccountId,
          cursor,
          limit: 100,
        });
        const post = page.posts.find(
          (candidate) => candidate.postExternalId === input.postExternalId,
        );
        if (post) {
          return { thumbnailUrl: post.thumbnailUrl };
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      return { thumbnailUrl: null };
    };
  }

  return adapter;
}
