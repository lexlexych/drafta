import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { categoryBadges, listCategories } from "@/lib/db/categories";

/**
 * Dashboard metrics (`/dashboard`).
 *
 * Everything is answered by a single `get_dashboard_metrics` RPC: the category
 * breakdown is a `group by`, the median reply time needs a window function, and
 * PostgREST's row cap would silently under-count a JS-side rollup. Names and
 * colours for the chart are *not* part of that payload — they come from the
 * category list, so a bar matches its inbox chip exactly.
 *
 * Same convention as `lib/db/inbox.ts`: the caller passes the client and the
 * workspace, this module resolves neither, and what comes back is a view model
 * with formatting already applied.
 */

/**
 * Rolling windows rather than calendar boundaries. A workspace has no time
 * zone in the schema, so "today" would have to be guessed; "the last 24 hours"
 * is both well-defined and the more useful reading for an inbox.
 */
export type DashboardPeriod = "day" | "week" | "month";

export const DASHBOARD_PERIODS: readonly DashboardPeriod[] = [
  "day",
  "week",
  "month",
];

const PERIOD_DAYS: Record<DashboardPeriod, number> = {
  day: 1,
  week: 7,
  month: 30,
};

export const DASHBOARD_PERIOD_LABELS: Record<DashboardPeriod, string> = {
  day: "День",
  week: "Неделя",
  month: "Месяц",
};

/** Spelled out under the heading so a rolling window is not read as a calendar one. */
export const DASHBOARD_PERIOD_RANGE_LABELS: Record<DashboardPeriod, string> = {
  day: "за последние 24 часа",
  week: "за последние 7 дней",
  month: "за последние 30 дней",
};

export type DashboardStat = {
  id: string;
  value: string;
  label: string;
};

export type DashboardCategoryBar = {
  /** `null` is the "no category" bucket: unclassified, or a deleted category. */
  id: string | null;
  name: string;
  colorVar: string;
  total: number;
  /** Width of the bar in percent, relative to the largest row. */
  share: number;
};

export type DashboardTokenRow = {
  id: string;
  label: string;
  prompt: number;
  completion: number;
  total: number;
};

export type DashboardTokensView = {
  rows: DashboardTokenRow[];
  total: DashboardTokenRow;
  /** False until the very first LLM call is recorded — see `tokens_tracked_since`. */
  hasHistory: boolean;
};

export type DashboardMetricsView = {
  period: DashboardPeriod;
  rangeLabel: string;
  stats: DashboardStat[];
  categories: DashboardCategoryBar[];
  categoriesTotal: number;
  tokens: DashboardTokensView;
};

const UNCATEGORIZED_LABEL = "Без категории";
const UNCATEGORIZED_COLOR_VAR = "--cat-default";

type TokenBucket = { prompt: number; completion: number; total: number };

type DashboardMetricsPayload = {
  incoming_messages: number;
  incoming_comments: number;
  drafts_messages: number;
  drafts_comments: number;
  median_reply_seconds: number | null;
  categories: { category_id: string | null; total: number }[];
  tokens: {
    message_classification: TokenBucket;
    message_draft: TokenBucket;
    comment_classification: TokenBucket;
    comment_draft: TokenBucket;
    total: TokenBucket;
  };
  tokens_tracked_since: string | null;
};

export function parseDashboardPeriod(value: string | null): DashboardPeriod {
  return DASHBOARD_PERIODS.includes(value as DashboardPeriod)
    ? (value as DashboardPeriod)
    : "day";
}

export function resolveDashboardRange(
  period: DashboardPeriod,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const from = new Date(now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);

  return { from, to: now };
}

const numberFormatter = new Intl.NumberFormat("ru-RU");

export function formatTokenCount(value: number): string {
  return numberFormatter.format(value);
}

/**
 * Reply time as an operator reads it. Sub-minute replies collapse to "< 1 мин"
 * rather than showing seconds: the number is a median over a whole period, and
 * that much precision would suggest an accuracy it does not have.
 */
export function formatMedianReplyTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }

  const totalMinutes = Math.round(seconds / 60);

  if (totalMinutes < 1) {
    return "< 1 мин";
  }

  if (totalMinutes < 60) {
    return `${totalMinutes} мин`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours < 24) {
    return minutes === 0 ? `${hours} ч` : `${hours} ч ${minutes} мин`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;

  return restHours === 0 ? `${days} д` : `${days} д ${restHours} ч`;
}

/**
 * Bars are sized against the largest row, not against the total: with a long
 * tail of small categories every bar would otherwise be a sliver. A floor of
 * 2% keeps a category with a single message visible.
 */
export function buildCategoryBars(
  totals: readonly { category_id: string | null; total: number }[],
  badges: readonly { id: string; name: string; colorVar: string }[],
): DashboardCategoryBar[] {
  const badgeById = new Map(badges.map((badge) => [badge.id, badge]));
  const maxTotal = totals.reduce((max, row) => Math.max(max, row.total), 0);

  return totals
    .map((row) => {
      const badge = row.category_id ? badgeById.get(row.category_id) : undefined;

      return {
        id: row.category_id,
        // A category deleted after the fact leaves its messages with a null
        // `category_id`, so both cases land in the same bucket.
        name: badge?.name ?? UNCATEGORIZED_LABEL,
        colorVar: badge?.colorVar ?? UNCATEGORIZED_COLOR_VAR,
        total: row.total,
        share: maxTotal === 0 ? 0 : Math.max(2, Math.round((row.total / maxTotal) * 100)),
      };
    })
    .sort((left, right) => right.total - left.total);
}

function tokenRow(id: string, label: string, bucket: TokenBucket): DashboardTokenRow {
  return {
    id,
    label,
    prompt: bucket.prompt,
    completion: bucket.completion,
    total: bucket.total,
  };
}

export function buildTokensView(
  tokens: DashboardMetricsPayload["tokens"],
  trackedSince: string | null,
): DashboardTokensView {
  const rows = [
    tokenRow("message-classification", "Классификация сообщений", tokens.message_classification),
    tokenRow("message-draft", "Черновики сообщений", tokens.message_draft),
    tokenRow("comment-draft", "Черновики комментариев", tokens.comment_draft),
  ];

  // Comments are never classified today, so this row would be a permanent zero.
  // It appears only if the pipeline ever starts producing it.
  if (tokens.comment_classification.total > 0) {
    rows.splice(
      2,
      0,
      tokenRow(
        "comment-classification",
        "Классификация комментариев",
        tokens.comment_classification,
      ),
    );
  }

  return {
    rows,
    total: tokenRow("total", "Всего", tokens.total),
    hasHistory: trackedSince !== null,
  };
}

function buildStats(payload: DashboardMetricsPayload): DashboardStat[] {
  return [
    {
      id: "incoming-messages",
      value: numberFormatter.format(payload.incoming_messages),
      label: "Входящих сообщений",
    },
    {
      id: "drafts",
      value: numberFormatter.format(
        payload.drafts_messages + payload.drafts_comments,
      ),
      label: "Создано черновиков",
    },
    {
      id: "comments",
      value: numberFormatter.format(payload.incoming_comments),
      label: "Комментариев",
    },
    {
      id: "median-reply",
      value: formatMedianReplyTime(payload.median_reply_seconds),
      label: "Медиана времени ответа",
    },
  ];
}

export async function getDashboardMetrics(
  supabase: SupabaseClient,
  workspaceId: string,
  period: DashboardPeriod,
  now: Date = new Date(),
): Promise<DashboardMetricsView> {
  const { from, to } = resolveDashboardRange(period, now);

  const [metricsResult, categories] = await Promise.all([
    supabase.rpc("get_dashboard_metrics", {
      target_workspace_id: workspaceId,
      period_start: from.toISOString(),
      period_end: to.toISOString(),
    }),
    listCategories(supabase, workspaceId),
  ]);

  if (metricsResult.error) {
    console.error("[dashboard] failed to load metrics", metricsResult.error);
    throw new Error("Unable to load dashboard metrics.");
  }

  const payload = metricsResult.data as DashboardMetricsPayload;
  const bars = buildCategoryBars(payload.categories ?? [], categoryBadges(categories));

  return {
    period,
    rangeLabel: DASHBOARD_PERIOD_RANGE_LABELS[period],
    stats: buildStats(payload),
    categories: bars,
    categoriesTotal: bars.reduce((sum, bar) => sum + bar.total, 0),
    tokens: buildTokensView(payload.tokens, payload.tokens_tracked_since),
  };
}
