/** Мобильные чипы фильтра по каналу (на десктопе их заменяет расхлоп меню). */

import Link from "next/link";

import type { ChannelFilterView } from "@/lib/mock";

import { PlatformDot } from "./chips";
import { QUERY_KEYS, buildHref } from "./navigation";
import styles from "./panes.module.css";
import uiStyles from "./ui.module.css";

export function FilterChips({
  pathname,
  channels,
  activeChannelId,
  extraParams = {},
}: {
  pathname: string;
  channels: ChannelFilterView[];
  activeChannelId: string | null;
  extraParams?: Record<string, string | null>;
}) {
  return (
    <div className={styles.filters}>
      <Link
        className={styles.filterChip}
        data-active={!activeChannelId}
        href={buildHref(pathname, extraParams)}
      >
        Все каналы
      </Link>
      {channels.map((channel) => (
        <Link
          key={channel.id}
          className={styles.filterChip}
          data-active={activeChannelId === channel.id}
          href={buildHref(pathname, {
            ...extraParams,
            [QUERY_KEYS.channel]: channel.id,
          })}
        >
          <PlatformDot platform={channel.platform} />
          {channel.name}
          {channel.count > 0 ? (
            <span className={uiStyles.num}>{channel.count}</span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
