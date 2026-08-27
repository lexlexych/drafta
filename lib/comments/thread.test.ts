/**
 * Сборка веток комментариев из плоского окна страниц.
 *
 * Раньше этим занимался `lib/db/comments.ts` над строками таблицы; с
 * постраничной загрузкой ветки собирает клиент из накопленного окна, поэтому
 * функция стала чистой — и тестируется без Supabase.
 */

import { describe, expect, it } from "vitest";

import { buildCommentThread } from "./thread";
import type { CommentEntryView } from "./types";

function entry(
  id: string,
  externalId: string | null,
  parentExternalId: string | null,
): CommentEntryView {
  return {
    id,
    externalId,
    parentExternalId,
    authorName: "Кто-то",
    avatar: null,
    text: id,
    createdAt: "2026-08-27T10:00:00+00:00",
    time: "10:00",
    isOurs: false,
    deliveryLabel: null,
    translation: null,
    privateReply: null,
    canPrivateReply: false,
    dmHref: null,
  };
}

describe("buildCommentThread", () => {
  it("puts a reply under the comment it answers", () => {
    const threads = buildCommentThread([
      entry("c1", "ig_1", null),
      entry("c2", "ig_2", "ig_1"),
      entry("c3", "ig_3", null),
    ]);

    expect(threads.map((thread) => thread.id)).toEqual(["c1", "c3"]);
    expect(threads[0]?.replies.map((reply) => reply.id)).toEqual(["c2"]);
    expect(threads[1]?.replies).toEqual([]);
  });

  it("keeps a reply to a reply in the same branch — Instagram has two levels", () => {
    const threads = buildCommentThread([
      entry("c1", "ig_1", null),
      entry("c2", "ig_2", "ig_1"),
      entry("c3", "ig_3", "ig_2"),
    ]);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.replies.map((reply) => reply.id)).toEqual(["c2", "c3"]);
  });

  it("keeps a reply whose parent is outside the window as a top-level card", () => {
    // Родителя не дотянули (удалён или ещё не доехал) — показать комментарий
    // не с тем отступом лучше, чем потерять его.
    const threads = buildCommentThread([entry("c2", "ig_2", "ig_missing")]);

    expect(threads.map((thread) => thread.id)).toEqual(["c2"]);
  });

  it("survives a parent cycle", () => {
    const threads = buildCommentThread([
      entry("c1", "ig_1", "ig_2"),
      entry("c2", "ig_2", "ig_1"),
    ]);

    expect(threads.length + (threads[0]?.replies.length ?? 0)).toBe(2);
  });

  it("nests a reply once its parent arrives with the previous page", () => {
    const reply = entry("c2", "ig_2", "ig_1");

    expect(buildCommentThread([reply]).map((thread) => thread.id)).toEqual(["c2"]);

    const withParent = buildCommentThread([entry("c1", "ig_1", null), reply]);

    expect(withParent.map((thread) => thread.id)).toEqual(["c1"]);
    expect(withParent[0]?.replies.map((item) => item.id)).toEqual(["c2"]);
  });
});
