"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { markPostReadAction } from "../actions";

/**
 * Resets the open post's unread counter once the thread mounts in the browser.
 * A `useEffect`, not a write during the Server Component render: that render
 * also runs for `<Link>` prefetches of a post the user never opens — same
 * reasoning as `../../inbox/mark-thread-read.tsx`.
 */
export function MarkPostRead({ postId }: { postId: string }) {
  const router = useRouter();
  const markedPostIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (markedPostIdRef.current === postId) {
      return;
    }

    markedPostIdRef.current = postId;

    markPostReadAction(postId)
      .then((result) => {
        if (result.ok) {
          // Refreshes the server-rendered counters (sidebar/tabbar/list badge)
          // that live outside this component's own subtree.
          router.refresh();
        }
      })
      .catch((error: unknown) => {
        console.error("[comments] failed to mark post read", error);
      });
  }, [postId, router]);

  return null;
}
