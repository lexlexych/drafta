import type { ChannelPlatform } from "@/lib/channels/types";
import type { CategoryBadgeView, ChannelBadgeView } from "@/lib/mock";

import styles from "./ui.module.css";

// `ChannelPlatform` (lib/channels/types.ts) is the real, full platform union
// (telegram/whatsapp/instagram/facebook — T-01); the UI-каркас mock data
// (lib/mock) only ever uses instagram/facebook, a subset of it, so this
// component accepts the wider type and every existing mock-driven caller
// stays valid.
const PLATFORM_DOT_CLASSES: Record<ChannelPlatform | "all", string> = {
  telegram: styles.platformDotTelegram,
  whatsapp: styles.platformDotWhatsapp,
  instagram: styles.platformDotInstagram,
  facebook: styles.platformDotFacebook,
  all: styles.platformDotAll,
};

export function PlatformDot({ platform }: { platform: ChannelPlatform | "all" }) {
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
