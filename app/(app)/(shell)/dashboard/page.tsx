/**
 * Дашборд: показатели workspace за выбранный период
 * (docs/architecture/10-ui.md).
 *
 * Период живёт в адресе (`?period=day|week|month`), а не в состоянии клиента:
 * переключатель — три обычные ссылки, поэтому экран целиком остаётся серверным
 * и работает без JS. Все числа приходят одним RPC (`lib/db/dashboard.ts`).
 */

import Link from "next/link";

import {
  DASHBOARD_PERIODS,
  DASHBOARD_PERIOD_LABELS,
  formatTokenCount,
  getDashboardMetrics,
  parseDashboardPeriod,
} from "@/lib/db/dashboard";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

import { QUERY_KEYS, buildHref, firstParam } from "../_components/navigation";
import styles from "./dashboard.module.css";
import uiStyles from "../_components/ui.module.css";

const PATHNAME = "/dashboard";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const period = parseDashboardPeriod(firstParam(params[QUERY_KEYS.period]));

  const user = await getAuthenticatedUser();
  const workspace = user ? await getCurrentWorkspace(user.id) : null;

  if (!workspace) {
    // The shell layout already gates auth/workspace; this is a defensive null.
    return null;
  }

  const supabase = await createServerSupabaseClient();
  const metrics = await getDashboardMetrics(supabase, workspace.id, period);

  return (
    <div className={styles.single}>
      <div className={styles.inner}>
        <div className={styles.headRow}>
          <h1>Дашборд</h1>
          <span className={styles.date}>{metrics.rangeLabel}</span>
        </div>

        <nav className={styles.periodSwitch} aria-label="Период">
          {DASHBOARD_PERIODS.map((candidate) => {
            const isActive = candidate === period;

            return (
              <Link
                key={candidate}
                className={`${styles.periodOption} ${isActive ? styles.periodOptionActive : ""}`}
                href={buildHref(PATHNAME, { [QUERY_KEYS.period]: candidate })}
                aria-current={isActive ? "page" : undefined}
              >
                {DASHBOARD_PERIOD_LABELS[candidate]}
              </Link>
            );
          })}
        </nav>

        <div className={styles.statGrid}>
          {metrics.stats.map((stat) => (
            <div key={stat.id} className={styles.stat}>
              <div className={`${styles.statValue} ${uiStyles.num}`}>
                {stat.value}
              </div>
              <div className={styles.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>

        <div className={uiStyles.cardStack}>
          <section className={uiStyles.card}>
            <h3>Сообщения по категориям</h3>
            {metrics.categories.length === 0 ? (
              <p className={styles.empty}>За период входящих сообщений не было.</p>
            ) : (
              <ul className={styles.categoryList}>
                {metrics.categories.map((category) => (
                  <li key={category.id ?? "none"} className={styles.categoryRow}>
                    <span className={styles.categoryName} title={category.name}>
                      {category.name}
                    </span>
                    {/*
                     * Полоса — иллюстрация, а не единственный носитель значения:
                     * число рядом читается и без цвета, и скринридером.
                     */}
                    <span className={styles.bar} aria-hidden="true">
                      <i
                        className={styles.barFill}
                        style={{
                          width: `${category.share}%`,
                          background: `var(${category.colorVar})`,
                        }}
                      />
                    </span>
                    <span className={`${styles.categoryTotal} ${uiStyles.num}`}>
                      {formatTokenCount(category.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={uiStyles.card}>
            <h3>Расход токенов</h3>
            {metrics.tokens.hasHistory ? (
              <div className={styles.tokenTable}>
                <div className={`${styles.tokenRow} ${styles.tokenHead}`}>
                  <span className={styles.tokenLabel}>Операция</span>
                  <span className={styles.tokenCell}>Запрос</span>
                  <span className={styles.tokenCell}>Ответ</span>
                  <span className={styles.tokenCell}>Всего</span>
                </div>
                {metrics.tokens.rows.map((row) => (
                  <div key={row.id} className={styles.tokenRow}>
                    <span className={styles.tokenLabel}>{row.label}</span>
                    <span className={`${styles.tokenCell} ${uiStyles.num}`}>
                      <span className={styles.tokenCellLabel}>Запрос</span>
                      {formatTokenCount(row.prompt)}
                    </span>
                    <span className={`${styles.tokenCell} ${uiStyles.num}`}>
                      <span className={styles.tokenCellLabel}>Ответ</span>
                      {formatTokenCount(row.completion)}
                    </span>
                    <span className={`${styles.tokenCell} ${uiStyles.num}`}>
                      <span className={styles.tokenCellLabel}>Всего</span>
                      {formatTokenCount(row.total)}
                    </span>
                  </div>
                ))}
                <div className={`${styles.tokenRow} ${styles.tokenTotal}`}>
                  <span className={styles.tokenLabel}>
                    {metrics.tokens.total.label}
                  </span>
                  <span className={`${styles.tokenCell} ${uiStyles.num}`}>
                    <span className={styles.tokenCellLabel}>Запрос</span>
                    {formatTokenCount(metrics.tokens.total.prompt)}
                  </span>
                  <span className={`${styles.tokenCell} ${uiStyles.num}`}>
                    <span className={styles.tokenCellLabel}>Ответ</span>
                    {formatTokenCount(metrics.tokens.total.completion)}
                  </span>
                  <span className={`${styles.tokenCell} ${uiStyles.num}`}>
                    <span className={styles.tokenCellLabel}>Всего</span>
                    {formatTokenCount(metrics.tokens.total.total)}
                  </span>
                </div>
              </div>
            ) : (
              <p className={styles.empty}>
                Учёт расхода токенов только что включён — цифры появятся после
                первых классификаций и черновиков.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
