import { inngest } from "../client";
import { contactAvatarSyncRequestedEvent } from "../events";
import {
  runContactAvatarPipeline,
  type ContactAvatarSteps,
} from "./contact-avatar-pipeline";

function stepAdapter(step: unknown): ContactAvatarSteps {
  return step as ContactAvatarSteps;
}

export const contactAvatar = inngest.createFunction(
  {
    id: "contact-avatar",
    triggers: [contactAvatarSyncRequestedEvent],
    retries: 2,
    concurrency: [
      {
        scope: "env",
        key: '"contact-identity:" + event.data.contactIdentityId',
        limit: 1,
      },
    ],
  },
  async ({ event, step }) =>
    runContactAvatarPipeline(event.data, stepAdapter(step)),
);
