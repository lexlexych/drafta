import { describe, expect, it, vi } from "vitest";

// `dashboard.ts` imports `"server-only"`, which throws outside a Next.js build —
// same reason `inbox.test.ts` neutralizes the marker package before importing
// the module under test.
vi.mock("server-only", () => ({}));

const {
  buildCategoryBars,
  buildTokensView,
  formatMedianReplyTime,
  parseDashboardPeriod,
  resolveDashboardRange,
} = await import("./dashboard");

const BADGES = [
  { id: "cat_price", name: "Вопрос о цене", colorVar: "--cat-1" },
  { id: "cat_spam", name: "Спам", colorVar: "--cat-2" },
];

function emptyBucket() {
  return { prompt: 0, completion: 0, total: 0 };
}

describe("parseDashboardPeriod", () => {
  it("accepts the three supported windows", () => {
    expect(parseDashboardPeriod("day")).toBe("day");
    expect(parseDashboardPeriod("week")).toBe("week");
    expect(parseDashboardPeriod("month")).toBe("month");
  });

  it("falls back to the day window for anything else", () => {
    // The value comes straight from the query string, so it is attacker-shaped
    // input: an unknown period must render the default screen, never throw.
    expect(parseDashboardPeriod(null)).toBe("day");
    expect(parseDashboardPeriod("")).toBe("day");
    expect(parseDashboardPeriod("year")).toBe("day");
    expect(parseDashboardPeriod("../../etc/passwd")).toBe("day");
  });
});

describe("resolveDashboardRange", () => {
  const now = new Date("2026-07-25T12:00:00.000Z");

  it("rolls back 24 hours, 7 days and 30 days from now", () => {
    expect(resolveDashboardRange("day", now).from.toISOString()).toBe(
      "2026-07-24T12:00:00.000Z",
    );
    expect(resolveDashboardRange("week", now).from.toISOString()).toBe(
      "2026-07-18T12:00:00.000Z",
    );
    expect(resolveDashboardRange("month", now).from.toISOString()).toBe(
      "2026-06-25T12:00:00.000Z",
    );
  });

  it("ends the window at the current moment", () => {
    expect(resolveDashboardRange("week", now).to.toISOString()).toBe(
      "2026-07-25T12:00:00.000Z",
    );
  });

  it("crosses a DST change without losing an hour", () => {
    // Rolling windows are computed in absolute time precisely so a local
    // clock change cannot shorten or stretch the period.
    const afterDst = new Date("2026-10-26T12:00:00.000Z");

    expect(resolveDashboardRange("day", afterDst).from.toISOString()).toBe(
      "2026-10-25T12:00:00.000Z",
    );
  });
});

describe("formatMedianReplyTime", () => {
  it("shows a dash when nothing was answered in the period", () => {
    expect(formatMedianReplyTime(null)).toBe("—");
  });

  it("does not pretend to second-level precision under a minute", () => {
    expect(formatMedianReplyTime(0)).toBe("< 1 мин");
    expect(formatMedianReplyTime(29)).toBe("< 1 мин");
  });

  it("formats minutes, hours and days", () => {
    expect(formatMedianReplyTime(780)).toBe("13 мин");
    expect(formatMedianReplyTime(3600)).toBe("1 ч");
    expect(formatMedianReplyTime(4500)).toBe("1 ч 15 мин");
    expect(formatMedianReplyTime(86_400)).toBe("1 д");
    expect(formatMedianReplyTime(136_800)).toBe("1 д 14 ч");
  });

  it("refuses to render a nonsensical reading", () => {
    expect(formatMedianReplyTime(-5)).toBe("—");
    expect(formatMedianReplyTime(Number.NaN)).toBe("—");
  });
});

describe("buildCategoryBars", () => {
  it("scales bars against the largest row and sorts by volume", () => {
    const bars = buildCategoryBars(
      [
        { category_id: "cat_spam", total: 25 },
        { category_id: "cat_price", total: 100 },
      ],
      BADGES,
    );

    expect(bars.map((bar) => bar.name)).toEqual(["Вопрос о цене", "Спам"]);
    expect(bars[0]!.share).toBe(100);
    expect(bars[1]!.share).toBe(25);
  });

  it("takes colours from the category badges so chart and chips agree", () => {
    const bars = buildCategoryBars([{ category_id: "cat_price", total: 3 }], BADGES);

    expect(bars[0]!.colorVar).toBe("--cat-1");
  });

  it("labels unclassified messages and messages of a deleted category alike", () => {
    const bars = buildCategoryBars(
      [
        { category_id: null, total: 7 },
        { category_id: "cat_deleted", total: 2 },
      ],
      BADGES,
    );

    expect(bars.map((bar) => bar.name)).toEqual(["Без категории", "Без категории"]);
    expect(bars[0]!.colorVar).toBe("--cat-default");
  });

  it("keeps a single-message category visible instead of a zero-width bar", () => {
    const bars = buildCategoryBars(
      [
        { category_id: "cat_price", total: 1000 },
        { category_id: "cat_spam", total: 1 },
      ],
      BADGES,
    );

    expect(bars[1]!.share).toBeGreaterThanOrEqual(2);
  });

  it("returns nothing for an empty period rather than dividing by zero", () => {
    expect(buildCategoryBars([], BADGES)).toEqual([]);
  });
});

describe("buildTokensView", () => {
  const tokens = {
    message_classification: { prompt: 500, completion: 10, total: 510 },
    message_draft: { prompt: 1200, completion: 300, total: 1500 },
    comment_classification: emptyBucket(),
    comment_draft: { prompt: 800, completion: 200, total: 1000 },
    total: { prompt: 2500, completion: 510, total: 3010 },
  };

  it("splits the spend by operation and surface", () => {
    const view = buildTokensView(tokens, "2026-07-01T00:00:00.000Z");

    expect(view.rows.map((row) => row.label)).toEqual([
      "Классификация сообщений",
      "Черновики сообщений",
      "Черновики комментариев",
    ]);
    expect(view.total.total).toBe(3010);
  });

  it("hides the comment classification row while the pipeline never produces it", () => {
    const view = buildTokensView(tokens, "2026-07-01T00:00:00.000Z");

    expect(view.rows.some((row) => row.id === "comment-classification")).toBe(false);
  });

  it("shows the comment classification row once it carries a number", () => {
    const view = buildTokensView(
      { ...tokens, comment_classification: { prompt: 40, completion: 2, total: 42 } },
      "2026-07-01T00:00:00.000Z",
    );

    expect(view.rows.map((row) => row.id)).toEqual([
      "message-classification",
      "message-draft",
      "comment-classification",
      "comment-draft",
    ]);
  });

  it("separates 'nothing spent this period' from 'accounting never ran'", () => {
    expect(buildTokensView(tokens, "2026-07-01T00:00:00.000Z").hasHistory).toBe(true);
    expect(buildTokensView(tokens, null).hasHistory).toBe(false);
  });
});
