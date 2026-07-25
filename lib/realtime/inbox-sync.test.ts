import { describe, expect, it, vi } from "vitest";

import {
  createInboxRealtimeHandler,
  isOwnWorkspaceEvent,
  subscribeToInboxRealtime,
  type InboxRealtimeEvent,
} from "./inbox-sync";

function insertEvent(
  overrides: Partial<{ workspace_id: string | null }> = {},
): InboxRealtimeEvent {
  return {
    schema: "public",
    table: "messages",
    commit_timestamp: new Date().toISOString(),
    errors: [],
    eventType: "INSERT",
    new: { id: "msg_1", workspace_id: "wsp_a", ...overrides },
    old: {},
  };
}

function updateEvent(
  overrides: Partial<{ workspace_id: string | null }> = {},
): InboxRealtimeEvent {
  return {
    schema: "public",
    table: "conversations",
    commit_timestamp: new Date().toISOString(),
    errors: [],
    eventType: "UPDATE",
    new: { id: "cnv_1", workspace_id: "wsp_a", unread_count: 1, ...overrides },
    old: { id: "cnv_1" },
  };
}

describe("isOwnWorkspaceEvent", () => {
  it("matches when the row's workspace_id equals the given workspace", () => {
    expect(isOwnWorkspaceEvent(insertEvent({ workspace_id: "wsp_a" }), "wsp_a")).toBe(
      true,
    );
  });

  it("rejects a row belonging to a different workspace", () => {
    expect(isOwnWorkspaceEvent(insertEvent({ workspace_id: "wsp_b" }), "wsp_a")).toBe(
      false,
    );
  });

  it("rejects a row with no workspace_id at all", () => {
    expect(
      isOwnWorkspaceEvent(insertEvent({ workspace_id: null }), "wsp_a"),
    ).toBe(false);
  });
});

describe("createInboxRealtimeHandler", () => {
  it("calls refresh once a relevant event's debounce window elapses", () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn();
      const handle = createInboxRealtimeHandler("wsp_a", refresh, 250);

      handle(insertEvent());
      expect(refresh).not.toHaveBeenCalled();

      vi.advanceTimersByTime(249);
      expect(refresh).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces a burst of relevant events (messages insert + conversations update) into one refresh call", () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn();
      const handle = createInboxRealtimeHandler("wsp_a", refresh, 250);

      handle(insertEvent());
      vi.advanceTimersByTime(100);
      handle(updateEvent());
      vi.advanceTimersByTime(100);
      handle(insertEvent());
      vi.advanceTimersByTime(250);

      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores an event for a foreign workspace — never schedules a refresh", () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn();
      const handle = createInboxRealtimeHandler("wsp_a", refresh, 250);

      handle(insertEvent({ workspace_id: "wsp_other" }));
      vi.advanceTimersByTime(10_000);

      expect(refresh).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires again for a later event once the previous debounce window already resolved", () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn();
      const handle = createInboxRealtimeHandler("wsp_a", refresh, 250);

      handle(insertEvent());
      vi.advanceTimersByTime(250);
      expect(refresh).toHaveBeenCalledTimes(1);

      handle(updateEvent());
      vi.advanceTimersByTime(250);
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("subscribeToInboxRealtime", () => {
  function createFakeSupabase() {
    const channel = {
      on: vi.fn(),
      subscribe: vi.fn(),
    };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockReturnValue(channel);

    return {
      channel,
      supabase: {
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: { session: { access_token: "test-access-token" } },
            error: null,
          }),
        },
        realtime: {
          setAuth: vi.fn().mockResolvedValue(undefined),
        },
        channel: vi.fn().mockReturnValue(channel),
        removeChannel: vi.fn(),
      },
    };
  }

  it("authenticates and subscribes to workspace-scoped inbox and draft changes", async () => {
    const { channel, supabase } = createFakeSupabase();

    subscribeToInboxRealtime(supabase as never, "wsp_a", vi.fn());

    await vi.waitFor(() => {
      expect(channel.subscribe).toHaveBeenCalledTimes(1);
    });

    expect(supabase.auth.getSession).toHaveBeenCalledTimes(1);
    expect(supabase.realtime.setAuth).toHaveBeenCalledWith("test-access-token");
    expect(supabase.channel).toHaveBeenCalledWith("inbox-realtime:wsp_a");
    expect(channel.on).toHaveBeenCalledTimes(12);
    expect(channel.on).toHaveBeenCalledWith("system", {}, expect.any(Function));
    expect(channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: "workspace_id=eq.wsp_a",
      },
      expect.any(Function),
    );
    expect(channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "drafts",
        filter: "workspace_id=eq.wsp_a",
      },
      expect.any(Function),
    );
    expect(channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "drafts",
        filter: "workspace_id=eq.wsp_a",
      },
      expect.any(Function),
    );
    expect(channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "conversations",
        filter: "workspace_id=eq.wsp_a",
      },
      expect.any(Function),
    );
    expect(channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "conversations",
        filter: "workspace_id=eq.wsp_a",
      },
      expect.any(Function),
    );

    // The comment tables refresh the same way the inbox does.
    for (const table of ["posts", "comments", "comment_drafts"]) {
      for (const event of ["INSERT", "UPDATE"]) {
        expect(channel.on).toHaveBeenCalledWith(
          "postgres_changes",
          {
            event,
            schema: "public",
            table,
            filter: "workspace_id=eq.wsp_a",
          },
          expect.any(Function),
        );
      }
    }
  });

  it("returns an unsubscribe function that removes the authorized channel (ticket step 4)", async () => {
    const { channel, supabase } = createFakeSupabase();

    const unsubscribe = subscribeToInboxRealtime(supabase as never, "wsp_a", vi.fn());

    await vi.waitFor(() => {
      expect(channel.subscribe).toHaveBeenCalledTimes(1);
    });

    expect(supabase.removeChannel).not.toHaveBeenCalled();

    unsubscribe();
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });
});
