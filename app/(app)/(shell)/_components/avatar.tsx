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
  return (
    <span
      className={`${styles.avatar} ${SIZE_CLASSES[size]}`}
      style={{ background: `hsl(${avatar.hue} 42% 52%)` }}
      aria-hidden="true"
    >
      {avatar.initials}
    </span>
  );
}
