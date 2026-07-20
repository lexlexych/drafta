"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { markConversationReadAction } from "./actions";

/**
 * Marks the open conversation read once the thread actually mounts in the
 * browser (docs/epics/epic_02/T-05-inbox-messages.md, step 3: "Открытие
 * треда сбрасывает счётчик непрочитанного диалога").
 *
 * A `useEffect` on mount, not a write inside `InboxPage`'s Server Component
 * render: that render is just a GET (including `<Link>` prefetches of a
 * conversation the user only hovers, never opens), which must stay
 * side-effect free. Renders nothing — this component exists only to fire
 * the effect.
 */
export function MarkThreadRead({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const markedConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (markedConversationIdRef.current === conversationId) {
      return;
    }

    markedConversationIdRef.current = conversationId;

    markConversationReadAction(conversationId)
      .then((result) => {
        if (result.ok) {
          // Refreshes the server-rendered counters (sidebar/tabbar/list
          // badge) that live outside this component's own subtree.
          router.refresh();
        }
      })
      .catch((error: unknown) => {
        console.error("[inbox] failed to mark thread read", error);
      });
  }, [conversationId, router]);

  return null;
}
