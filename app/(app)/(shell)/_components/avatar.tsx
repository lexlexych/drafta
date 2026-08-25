"use client";

import type { AvatarView } from "@/lib/mock";

import styles from "./ui.module.css";

const SIZE_CLASSES = {
  sm: styles.avatarSm,
  md: styles.avatarMd,
  lg: styles.avatarLg,
} as const;

export function Avatar({
  avatar,
  size = "md",
}: {
  avatar: AvatarView;
  size?: keyof typeof SIZE_CLASSES;
}) {
  const imageUrl = avatar.imageUrl?.startsWith("/api/avatars/")
    ? avatar.imageUrl
    : null;

  return (
    <span
      className={`${styles.avatar} ${SIZE_CLASSES[size]}`}
      style={{ backgroundColor: `hsl(${avatar.hue} 42% 52%)` }}
      aria-hidden="true"
    >
      {avatar.initials}
      {imageUrl ? (
        // Authenticated same-origin proxy; Next/Image cannot forward the user's
        // Supabase session during server-side optimization.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.avatarImage}
          src={imageUrl}
          alt=""
          draggable={false}
          onError={(event) => {
            // Reveal the initials already rendered underneath the image.
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </span>
  );
}
