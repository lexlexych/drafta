import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// `comments.ts` imports `"server-only"`, which throws outside a Next.js build —
// same neutralization as `inbox.test.ts`.
vi.mock("server-only", () => ({}));

// DB-backed tests: нужен поднятый локальный Supabase (`supabase start`,
// `supabase db reset`) через те же переменные, что читает продовый код —
// иначе пропускаются, а не падают (та же конвенция, что в `inbox.test.ts`).
const hasLocalSupabaseConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SECRET_KEY,
);

if (!hasLocalSupabaseConfig) {
  console.warn(
    "[comments.test.ts] skipping DB-backed tests — set NEXT_PUBLIC_SUPABASE_URL, " +
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY to a running local Supabase " +
      "(`supabase start`, values from `supabase status`) to run them.",
  );
}

describe.skipIf(!hasLocalSupabaseConfig)("lib/db/comments", () => {
  let supabase: SupabaseClient;
  let getPostListView: typeof import("./comments").getPostListView;
  let getPostThreadView: typeof import("./comments").getPostThreadView;
  let getOlderPostComments: typeof import("./comments").getOlderPostComments;
  let COMMENT_PAGE_SIZE: typeof import("./comments").COMMENT_PAGE_SIZE;
  let listChannelConnections: typeof import("./channel-connections").listChannelConnections;
  const workspaceIdsToClean: string[] = [];

  beforeAll(async () => {
    ({
      getPostListView,
      getPostThreadView,
      getOlderPostComments,
      COMMENT_PAGE_SIZE,
    } = await import("./comments"));
    ({ listChannelConnections } = await import("./channel-connections"));
    const { createAdminSupabaseClient } = await import("./admin");
    // Admin (service_role) — эти тесты про логику `comments.ts` (страницы,
    // ветки, счётчики), а не про RLS; изоляция проверяется отдельно в
    // tests/rls/isolation.integration.ts.
    supabase = createAdminSupabaseClient();
  });

  afterEach(async () => {
    while (workspaceIdsToClean.length > 0) {
      const workspaceId = workspaceIdsToClean.pop();
      await supabase.from("workspaces").delete().eq("id", workspaceId);
    }
  });

  async function createTestWorkspace(): Promise<string> {
    const { data, error } = await supabase
      .from("workspaces")
      .insert({ name: `comments test ${randomUUID()}` })
      .select("id")
      .single();
    if (error) throw error;
    workspaceIdsToClean.push(data.id);
    return data.id;
  }

  async function createChannel(workspaceId: string): Promise<string> {
    const { data, error } = await supabase
      .from("channel_connections")
      .insert({
        workspace_id: workspaceId,
        name: "Instagram Shop",
        provider: "zernio",
        platform: "instagram",
        external_id: `ext-${randomUUID()}`,
        capabilities: { supportsComments: true },
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async function createPost(workspaceId: string, channelId: string): Promise<string> {
    const { data, error } = await supabase
      .from("posts")
      .insert({
        workspace_id: workspaceId,
        channel_connection_id: channelId,
        external_id: `post-${randomUUID()}`,
        text: "Осенняя коллекция уже в продаже",
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async function createComment(
    workspaceId: string,
    postId: string,
    overrides: {
      direction?: "incoming" | "outgoing";
      text?: string;
      createdAt?: string;
      externalId?: string | null;
      parentExternalId?: string | null;
    } = {},
  ): Promise<string> {
    const direction = overrides.direction ?? "incoming";
    const { data, error } = await supabase
      .from("comments")
      .insert({
        workspace_id: workspaceId,
        post_id: postId,
        external_id:
          overrides.externalId === undefined
            ? `cmt-${randomUUID()}`
            : overrides.externalId,
        parent_external_id: overrides.parentExternalId ?? null,
        direction,
        text: overrides.text ?? "Сколько стоит доставка?",
        delivery_status: direction === "incoming" ? "received" : "sent",
        created_at: overrides.createdAt ?? new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  /** Публикация с лентой длиннее страницы: `count` комментариев по минуте. */
  async function createBusyPost(count: number) {
    const workspaceId = await createTestWorkspace();
    const channelId = await createChannel(workspaceId);
    const postId = await createPost(workspaceId, channelId);
    const start = Date.now() - count * 60_000;

    for (let index = 0; index < count; index += 1) {
      await createComment(workspaceId, postId, {
        text: `Comment ${index}`,
        externalId: `ig_${index}`,
        createdAt: new Date(start + index * 60_000).toISOString(),
      });
    }

    return { workspaceId, postId };
  }

  it("opens a busy post on its last page, not on the whole feed", async () => {
    const total = COMMENT_PAGE_SIZE + 5;
    const { workspaceId, postId } = await createBusyPost(total);

    const channels = await listChannelConnections(supabase, workspaceId);
    const thread = await getPostThreadView(supabase, workspaceId, channels, postId);

    expect(thread?.comments).toHaveLength(COMMENT_PAGE_SIZE);
    expect(thread?.comments[0]?.text).toBe("Comment 5");
    expect(thread?.hasMoreBefore).toBe(true);
    // Счётчик в шапке — по всей публикации, а не по загруженной странице.
    expect(thread?.postMeta).toBe(`${total} комментариев`);
  });

  it("walks the feed upwards by cursor until it runs out", async () => {
    const total = COMMENT_PAGE_SIZE + 3;
    const { workspaceId, postId } = await createBusyPost(total);

    const channels = await listChannelConnections(supabase, workspaceId);
    const thread = await getPostThreadView(supabase, workspaceId, channels, postId);
    const oldest = thread!.comments[0]!;

    const older = await getOlderPostComments(
      supabase,
      workspaceId,
      channels,
      postId,
      { createdAt: oldest.createdAt, id: oldest.id },
    );

    expect(older?.items.map((comment) => comment.text)).toEqual([
      "Comment 0",
      "Comment 1",
      "Comment 2",
    ]);
    expect(older?.hasMoreBefore).toBe(false);
  });

  it("pulls in the parent of a reply that fell outside the page", async () => {
    const workspaceId = await createTestWorkspace();
    const channelId = await createChannel(workspaceId);
    const postId = await createPost(workspaceId, channelId);
    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // Вопрос месячной давности — заведомо за краем страницы…
    await createComment(workspaceId, postId, {
      text: "Старый вопрос",
      externalId: "ig_old_question",
      createdAt: new Date(monthAgo).toISOString(),
    });

    // …и свежая лента поверх него.
    for (let index = 0; index < COMMENT_PAGE_SIZE; index += 1) {
      await createComment(workspaceId, postId, {
        text: `Comment ${index}`,
        externalId: `ig_${index}`,
        createdAt: new Date(Date.now() - (COMMENT_PAGE_SIZE - index) * 60_000).toISOString(),
      });
    }

    // Ответ на старый вопрос, опубликованный только что.
    await createComment(workspaceId, postId, {
      direction: "outgoing",
      text: "Ответ на старый вопрос",
      externalId: "ig_old_answer",
      parentExternalId: "ig_old_question",
      createdAt: new Date().toISOString(),
    });

    const channels = await listChannelConnections(supabase, workspaceId);
    const thread = await getPostThreadView(supabase, workspaceId, channels, postId);
    const texts = thread!.comments.map((comment) => comment.text);

    // Родитель дотянут вместе со страницей — иначе ответ висел бы отдельной
    // карточкой и перепрыгнул бы под родителя при подгрузке вверх.
    expect(texts).toContain("Старый вопрос");
    expect(texts).toContain("Ответ на старый вопрос");
    expect(thread?.hasMoreBefore).toBe(true);
    // Дотянутый предок стоит на своём месте в хронологии — в самом начале.
    expect(texts[0]).toBe("Старый вопрос");
  });

  it("previews a post with its last comment and its incoming count", async () => {
    const workspaceId = await createTestWorkspace();
    const channelId = await createChannel(workspaceId);
    const postId = await createPost(workspaceId, channelId);

    await createComment(workspaceId, postId, {
      text: "Первый вопрос",
      createdAt: new Date(Date.now() - 120_000).toISOString(),
    });
    await createComment(workspaceId, postId, {
      text: "Второй вопрос",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await createComment(workspaceId, postId, {
      direction: "outgoing",
      text: "Наш ответ",
      externalId: null,
      createdAt: new Date().toISOString(),
    });

    const channels = await listChannelConnections(supabase, workspaceId);
    const list = await getPostListView(supabase, workspaceId, channels, {});
    const item = list.items.find((entry) => entry.id === postId);

    expect(item?.preview).toBe("Вы: Наш ответ");
    // Счётчик — только входящие: наш ответ комментарием клиента не считается.
    expect(item?.commentCount).toBe(2);
  });
});
