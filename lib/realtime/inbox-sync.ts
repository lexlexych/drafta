import type {
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  RealtimeSystemPayload,
  SupabaseClient,
} from "@supabase/supabase-js";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";

/**
 * Client-side glue behind "Realtime-обновления инбокса"
 * (docs/epics/epic_02/T-06-realtime-inbox.md): open a Postgres Changes
 * subscription for `messages` (insert) and `conversations`
 * (insert/update) of the current workspace, and react to it.
 *
 * Deliberately **not** `"server-only"` — this runs in the browser, alongside
 * `lib/db/browser.ts`'s `createBrowserSupabaseClient()` (the
 * publishable-key client, authorized with the user's session — RLS applies,
 * ticket's "Существенные факты").
 *
 * Reacting to an event calls `router.refresh()` (wired up by the caller,
 * `app/(app)/(shell)/_components/inbox-realtime-sync.tsx`) rather than
 * patching a client-side copy of the list/thread/counters view models
 * itself. `lib/db/inbox.ts`'s view models are built from joins across
 * `contacts`/`channel_connections`/`messages` plus formatting helpers
 * (avatar colors, time labels, reply-window countdown) — a raw
 * `postgres_changes` row (just the changed table's own columns) can't
 * reconstruct that, and a brand-new conversation appearing in the list isn't
 * even present client-side to patch. Re-fetching the current route's Server
 * Components is the same convention `../inbox/mark-thread-read.tsx` (T-05)
 * already established for "server data changed, update the screen without a
 * full page reload" — one source of truth, no risk of the client's patched
 * copy drifting from what `lib/db/inbox.ts` would actually return.
 */

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_MAX_WAIT_MS = 1_000;

export type InboxRealtimeConnectionStatus =
  | "connecting"
  | "subscribed"
  | "reconnecting"
  | "error";

export type InboxRealtimeStatusChange = {
  status: InboxRealtimeConnectionStatus;
  error?: Error;
};

type InboxRealtimeHandler = ((event: InboxRealtimeEvent) => void) & {
  cancel: () => void;
};

/** The subset of a changed row this module cares about — every table here has one. */
export type InboxRealtimeRow = Record<string, unknown> & {
  workspace_id?: string | null;
};

/**
 * The two kinds of change events this ticket subscribes to (never DELETE —
 * neither `messages` nor `conversations` are hard-deleted by the app).
 */
export type InboxRealtimeEvent =
  | RealtimePostgresInsertPayload<InboxRealtimeRow>
  | RealtimePostgresUpdatePayload<InboxRealtimeRow>;

/**
 * True when a change-event's row actually belongs to `workspaceId`.
 *
 * Defense in depth, not the primary guard: the subscription below already
 * scopes each `postgres_changes` listener with `filter:
 * "workspace_id=eq.<workspaceId>"`, and delivery is additionally gated by
 * `messages_member_access`/`conversations_member_access` RLS on the
 * publication (supabase/migrations/20260720120000_…) — same
 * belt-and-suspenders as the explicit `workspace_id` filters already used in
 * `lib/db/inbox.ts` despite RLS being the real source of truth.
 */
export function isOwnWorkspaceEvent(
  event: Pick<InboxRealtimeEvent, "new">,
  workspaceId: string,
): boolean {
  return event.new.workspace_id === workspaceId;
}

/**
 * Builds the callback passed to each `postgres_changes` listener. Debounces
 * bursts of events (e.g. several webhook deliveries landing within
 * milliseconds of each other, or the initial insert + subsequent `bump_*`
 * update on the same conversation) into a single `refresh()` call instead of
 * one RSC round-trip per row.
 */
export function createInboxRealtimeHandler(
  workspaceId: string,
  refresh: () => void,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
  maxWaitMs: number = DEFAULT_MAX_WAIT_MS,
): InboxRealtimeHandler {
  let pendingRefresh: ReturnType<typeof setTimeout> | null = null;
  let burstStartedAt: number | null = null;

  const handleEvent = ((event: InboxRealtimeEvent) => {
    if (!isOwnWorkspaceEvent(event, workspaceId)) {
      return;
    }

    const now = Date.now();
    burstStartedAt ??= now;

    if (pendingRefresh !== null) {
      clearTimeout(pendingRefresh);
    }

    const remainingMaxWait = Math.max(0, maxWaitMs - (now - burstStartedAt));
    const delay = Math.min(debounceMs, remainingMaxWait);

    pendingRefresh = setTimeout(() => {
      pendingRefresh = null;
      burstStartedAt = null;
      refresh();
    }, delay);
  }) as InboxRealtimeHandler;

  handleEvent.cancel = () => {
    if (pendingRefresh !== null) {
      clearTimeout(pendingRefresh);
      pendingRefresh = null;
    }

    burstStartedAt = null;
  };

  return handleEvent;
}

/**
 * Opens the subscription (ticket step 2: insert on `messages`; insert/update
 * on `conversations`, filtered by `workspace_id`) and returns an unsubscribe
 * function — call it on cleanup (React `useEffect`'s return value).
 *
 * Reconnection after a dropped connection is supabase-js's own built-in
 * behaviour (ticket step 4: "переподписка при разрыве соединения — штатное
 * поведение supabase-js — проверить, не изобретать своё") — this function
 * does not add its own retry/backoff on top of it.
 */
export function subscribeToInboxRealtime(
  supabase: SupabaseClient,
  workspaceId: string,
  refresh: () => void,
  onStatusChange?: (change: InboxRealtimeStatusChange) => void,
): () => void {
  const handleEvent = createInboxRealtimeHandler(workspaceId, refresh);
  const filter = `workspace_id=eq.${workspaceId}`;
  let disposed = false;
  let hasSubscribed = false;
  let connectionWasInterrupted = false;

  onStatusChange?.({ status: "connecting" });

  const channel = supabase
    .channel(`inbox-realtime:${workspaceId}`)
    .on("system", {}, (payload: RealtimeSystemPayload) => {
      if (disposed || payload.status !== "error") {
        return;
      }

      connectionWasInterrupted = true;
      const error = new Error(payload.message);

      console.error("[inbox/realtime] postgres changes subscription rejected", {
        workspaceId,
        extension: payload.extension,
        channel: payload.channel,
        error,
      });
      onStatusChange?.({ status: "error", error });
    })
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter,
      },
      handleEvent,
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "conversations",
        filter,
      },
      handleEvent,
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "conversations",
        filter,
      },
      handleEvent,
    )
    .subscribe((status, error) => {
      if (disposed) {
        return;
      }

      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        const isReconnect = hasSubscribed || connectionWasInterrupted;
        hasSubscribed = true;
        connectionWasInterrupted = false;

        console.info(
          isReconnect
            ? "[inbox/realtime] subscription restored; refreshing missed changes"
            : "[inbox/realtime] subscription active",
          { workspaceId },
        );
        onStatusChange?.({ status: "subscribed" });

        if (isReconnect) {
          handleEvent.cancel();
          refresh();
        }

        return;
      }

      connectionWasInterrupted = true;

      if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
        console.error("[inbox/realtime] subscription error", {
          workspaceId,
          error,
        });
        onStatusChange?.({ status: "error", error });
        return;
      }

      console.warn("[inbox/realtime] subscription interrupted; waiting for reconnect", {
        workspaceId,
        status,
        error,
      });
      onStatusChange?.({ status: "reconnecting", error });
    });

  return () => {
    disposed = true;
    handleEvent.cancel();
    void supabase.removeChannel(channel);
  };
}
