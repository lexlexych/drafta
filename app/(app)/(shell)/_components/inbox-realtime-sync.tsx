"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/db/browser";
import { subscribeToInboxRealtime } from "@/lib/realtime/inbox-sync";

/**
 * Realtime-обновления инбокса (docs/epics/epic_02/T-06-realtime-inbox.md).
 * Mounted once in `../layout.tsx` — not inside `../inbox/page.tsx` — because
 * step 3 requires the nav counters (Sidebar/Tabbar, visible on every screen
 * under the shell, not just `/inbox`) to update live from the same events.
 *
 * Subscribes on mount, unsubscribes on unmount (leaving the shell entirely —
 * e.g. logout redirecting to `/login`, since layouts stay mounted across
 * in-shell navigation) — ticket step 4. Reconnection after a dropped
 * connection is supabase-js's own behaviour, not reimplemented here.
 *
 * On a relevant event, calls `router.refresh()` — the same convention
 * `../inbox/mark-thread-read.tsx` (T-05) established: Next.js re-renders the
 * current route's Server Components (this layout + whatever page is active)
 * with fresh data, without a full browser page reload.
 *
 * The subscription effect's dependency array is `[workspaceId]` only — it
 * doesn't need to reopen the socket if `router`'s identity ever changes.
 * `router.refresh` is read through a ref, kept current by a separate effect:
 * writing to a ref belongs in an effect, not in the render body — React
 * forbids mutating refs during render.
 */
export function InboxRealtimeSync({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const routerRef = useRef(router);

  useEffect(() => {
    routerRef.current = router;
  });

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    return subscribeToInboxRealtime(supabase, workspaceId, () => {
      routerRef.current.refresh();
    });
  }, [workspaceId]);

  return null;
}
