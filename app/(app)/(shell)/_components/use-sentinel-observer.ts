"use client";

/**
 * Маячок дозагрузки: следит, показался ли служебный элемент на краю
 * скроллящегося контейнера.
 *
 * Корнем берётся сам контейнер (`rootRef`), а не окно: только у него можно
 * осмысленно задать `rootMargin` и начинать подгрузку заранее, не дожидаясь
 * самого края. Где стоит маячок — в конце списка (`usePagedList`) или в начале
 * треда (`useThreadWindow`) — хук не знает и знать не должен.
 */

import { useEffect, useRef } from "react";

/** Насколько заранее до края начинать подгрузку. */
const ROOT_MARGIN = "300px 0px";

export function useSentinelObserver({
  enabled,
  onReached,
}: {
  enabled: boolean;
  onReached: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (!enabled || !sentinel || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onReached();
        }
      },
      { root: rootRef.current, rootMargin: ROOT_MARGIN },
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [enabled, onReached]);

  return { rootRef, sentinelRef };
}
