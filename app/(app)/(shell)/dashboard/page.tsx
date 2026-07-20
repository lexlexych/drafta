/**
 * Дашборд. Состав экрана — иллюстративный и уточняется при детализации
 * (docs/architecture/10-ui.md); перенесён из макета как есть.
 */

import Link from "next/link";

import { getDashboard } from "@/lib/mock";

import { Avatar } from "../_components/avatar";
import { CategoryChip, ChannelChip, PlatformDot } from "../_components/chips";
import { QUERY_KEYS, buildHref } from "../_components/navigation";
import styles from "./dashboard.module.css";
import uiStyles from "../_components/ui.module.css";

export default function DashboardPage() {
  const dashboard = getDashboard();

  return (
    <div className={styles.single}>
      <div className={styles.inner}>
        <div className={styles.headRow}>
          <h1>Дашборд</h1>
          <span className={styles.date}>{dashboard.date}</span>
        </div>

        <div className={styles.statGrid}>
          {dashboard.stats.map((stat) => (
            <div
              key={stat.id}
              className={`${styles.stat} ${stat.highlighted ? styles.statHot : ""}`}
            >
              <div className={`${styles.statValue} ${uiStyles.num}`}>
                {stat.value}
              </div>
              <div className={styles.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>

        <div className={styles.twoColumns}>
          <div className={uiStyles.card}>
            <h3>По каналам</h3>
            {dashboard.channelLoad.map((channel) => (
              <div key={channel.id} className={styles.channelRow}>
                <PlatformDot platform={channel.platform} />
                <span className={styles.channelName}>{channel.name}</span>
                <span className={styles.bar}>
                  <i
                    className={`${styles.barFill} ${
                      channel.platform === "instagram"
                        ? styles.barFillInstagram
                        : styles.barFillFacebook
                    }`}
                    style={{ width: `${channel.share}%` }}
                  />
                </span>
                <span className={`${styles.channelTotal} ${uiStyles.num}`}>
                  {channel.total}
                </span>
              </div>
            ))}
            <div className={`${styles.channelRow} ${styles.channelNote}`}>
              {dashboard.channelLoadNote}
            </div>
          </div>

          <div className={uiStyles.card}>
            <h3>Последние входящие</h3>
            <div className={styles.feed}>
              {dashboard.feed.map((item) => (
                <Link
                  key={item.conversationId}
                  className={styles.feedRow}
                  href={buildHref(
                    item.kind === "dm" ? "/inbox" : "/comments",
                    { [QUERY_KEYS.conversation]: item.conversationId },
                  )}
                >
                  <Avatar avatar={item.avatar} size="sm" />
                  <span className={styles.feedBody}>
                    <span className={styles.feedText}>{item.text}</span>
                    <span className={styles.feedMeta}>
                      <ChannelChip channel={item.channel} />
                      {item.category ? (
                        <CategoryChip category={item.category} />
                      ) : null}
                    </span>
                  </span>
                  <time className={uiStyles.num}>{item.time}</time>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <p className={styles.footnote}>
          Состав дашборда — иллюстративный; уточняется при детализации
          (docs/architecture/10-ui.md).
        </p>
      </div>
    </div>
  );
}
