import type { CategoryBadgeView, ChannelBadgeView, Platform } from "@/lib/mock";

import styles from "./ui.module.css";

const PLATFORM_DOT_CLASSES: Record<Platform | "all", string> = {
  instagram: styles.platformDotInstagram,
  facebook: styles.platformDotFacebook,
  all: styles.platformDotAll,
};

export function PlatformDot({ platform }: { platform: Platform | "all" }) {
  return (
    <span
      className={`${styles.platformDot} ${PLATFORM_DOT_CLASSES[platform]}`}
      aria-hidden="true"
    />
  );
}

/** Именованный канал-источник: точка платформы + имя `channel_connection`. */
export function ChannelChip({ channel }: { channel: ChannelBadgeView }) {
  return (
    <span className={styles.chip}>
      <PlatformDot platform={channel.platform} />
      {channel.name}
    </span>
  );
}

/** Присвоенная категория входящего. */
export function CategoryChip({ category }: { category: CategoryBadgeView }) {
  return (
    <span className={`${styles.chip} ${styles.chipPlain}`}>
      <span
        className={styles.categoryDot}
        style={{ background: `var(${category.colorVar})` }}
        aria-hidden="true"
      />
      {category.name}
    </span>
  );
}
