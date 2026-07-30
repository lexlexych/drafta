import { inngest } from "../client";
import { contactAvatarSyncRequestedEvent } from "../events";
import {
  runContactAvatarPipeline,
  type ContactAvatarSteps,
} from "./contact-avatar-pipeline";

function stepAdapter(step: unknown): ContactAvatarSteps {
  // Same boundary cast as the other pipelines: every pipeline value is
  // JSON-serializable and round-trips through step.run.
  return step as ContactAvatarSteps;
}

/**
 * `contact-avatar` — fetches a contact's profile picture from the channel
 * provider (vibecoding rule 8: the outbound call runs here with retries, not
 * in the webhook request).
 *
 * Limit 1 per identity so two messages arriving together can't both call the
 * provider for the same person; the pipeline's TTL re-check then no-ops the
 * loser. No `onFailure` compensation: a missed avatar leaves the contact on
 * their initials, and their next message re-triggers the lookup.
 */
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
