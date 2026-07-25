import "server-only";

import { Inngest } from "inngest";

/**
 * The single Inngest client the app sends events through and (starting
 * stage 2 of the rollout plan) serves functions with — see
 * docs/architecture/12-repo-structure.md (`lib/inngest/functions/`) and
 * docs/architecture/07-data-flows.md#66-полный-список-inngest-функций.
 *
 * `id` is the Inngest "app id", unrelated to any workspace/tenant — same
 * value everywhere this client is constructed.
 *
 * No `eventKey` is passed explicitly: the SDK reads `INNGEST_EVENT_KEY` from
 * the environment itself (docs/architecture/13-environments-secrets.md) when
 * it's needed to actually send an event, so importing this module doesn't
 * require the variable to be set — same pattern as
 * `lib/channels/zernio/index.ts`'s deferred secret read. `import "server-only"`
 * for the same reason `lib/db/admin.ts` and `lib/channels/zernio/index.ts`
 * have it: nothing here should ever end up in a client bundle.
 */
export const inngest = new Inngest({ id: "drafta" });
