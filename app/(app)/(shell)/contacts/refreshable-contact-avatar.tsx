"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AvatarView } from "@/lib/mock";

import { useActivityTransition } from "../_components/activity";
import { Avatar } from "../_components/avatar";
import { RefreshIcon } from "../_components/icons";
import { refreshContactAvatarAction } from "./actions";
import styles from "./refreshable-contact-avatar.module.css";

type AvatarSize = "md" | "lg";

export function RefreshableContactAvatar({
  contactId,
  contactName,
  avatar,
  size,
  href,
}: {
  contactId: string;
  contactName: string;
  avatar: AvatarView;
  size: AvatarSize;
  href?: string;
}) {
  const router = useRouter();
  const incomingImageUrl = avatar.imageUrl ?? null;
  const [optimisticImage, setOptimisticImage] = useState<{
    contactId: string;
    source: string | null;
    refreshed: string | null;
  } | null>(null);
  const [refreshError, setRefreshError] = useState<{
    contactId: string;
    message: string;
  } | null>(null);
  const [isPending, startTransition] = useActivityTransition(
    "Обновляем аватар…",
  );
  const imageUrl =
    optimisticImage?.contactId === contactId &&
    optimisticImage.source === incomingImageUrl
      ? optimisticImage.refreshed
      : incomingImageUrl;
  const error =
    refreshError?.contactId === contactId ? refreshError.message : null;

  function refresh() {
    setRefreshError(null);
    startTransition(async () => {
      const result = await refreshContactAvatarAction(contactId);
      if (!result.ok) {
        setRefreshError({ contactId, message: result.error });
        return;
      }

      setOptimisticImage({
        contactId,
        source: incomingImageUrl,
        refreshed: result.data.imageUrl,
      });
      router.refresh();
    });
  }

  const renderedAvatar = (
    <Avatar avatar={{ ...avatar, imageUrl }} size={size} />
  );

  return (
    <span className={styles.root} data-size={size}>
      {href ? (
        <Link
          className={styles.avatarLink}
          href={href}
          aria-label={`Открыть контакт ${contactName}`}
        >
          {renderedAvatar}
        </Link>
      ) : (
        renderedAvatar
      )}
      <button
        className={styles.refresh}
        type="button"
        onClick={refresh}
        disabled={isPending}
        aria-label={`Обновить аватар контакта ${contactName}`}
        title={error ?? "Обновить аватар из канала"}
        data-pending={isPending}
      >
        <RefreshIcon size={12} />
      </button>
      <span className={styles.visuallyHidden} aria-live="polite">
        {error ?? (isPending ? "Обновляем аватар…" : "")}
      </span>
    </span>
  );
}
