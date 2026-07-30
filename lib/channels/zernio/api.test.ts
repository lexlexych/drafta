import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createZernioProfile,
  deleteZernioAccount,
  deleteZernioProfile,
  getZernioConnectAuthUrl,
  listZernioConversations,
  listZernioPostComments,
  sendZernioInboxMessage,
  ZernioApiError,
} from "./api";

const config = { apiBaseUrl: "https://zernio.com/api/v1", apiKey: "zk_test_123" };

function mockFetch(response: {
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    json: async () => response.json,
    text: async () =>
      response.text ?? (response.json != null ? JSON.stringify(response.json) : ""),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createZernioProfile", () => {
  it("POSTs to /profiles with Bearer auth and returns profile._id", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 201,
      json: { message: "Profile created successfully", profile: { _id: "prof_abc123" } },
    });

    const id = await createZernioProfile(config, { name: "Acme" });

    expect(id).toBe("prof_abc123");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://zernio.com/api/v1/profiles");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer zk_test_123");
    expect(JSON.parse(init.body)).toMatchObject({ name: "Acme" });
  });

  it("throws ZernioApiError with the response body on a non-2xx response", async () => {
    mockFetch({ ok: false, status: 400, text: '{"error":"Duplicate profile name"}' });

    await expect(
      createZernioProfile(config, { name: "Acme" }),
    ).rejects.toThrowError(/HTTP 400.*Duplicate profile name/);
  });

  it("throws when the response has no profile._id", async () => {
    mockFetch({ ok: true, status: 201, json: { message: "ok", profile: {} } });

    await expect(createZernioProfile(config, { name: "Acme" })).rejects.toThrow(
      ZernioApiError,
    );
  });
});

describe("deleteZernioAccount", () => {
  it("DELETEs the account with Bearer auth", async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: { message: "Account disconnected successfully" },
    });

    await deleteZernioAccount(config, "acct_ig_17841");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://zernio.com/api/v1/accounts/acct_ig_17841");
    expect(init.method).toBe("DELETE");
    expect(init.headers.Authorization).toBe("Bearer zk_test_123");
  });

  it("treats a 404 as success — the account is already disconnected", async () => {
    mockFetch({ ok: false, status: 404, text: '{"error":"Account not found"}' });

    await expect(deleteZernioAccount(config, "acct_gone")).resolves.toBeUndefined();
  });

  it("throws ZernioApiError on any other failure", async () => {
    mockFetch({ ok: false, status: 500, text: '{"error":"Internal error"}' });

    await expect(deleteZernioAccount(config, "acct_x")).rejects.toThrowError(
      /HTTP 500.*Internal error/,
    );
  });
});

describe("deleteZernioProfile", () => {
  it("DELETEs the profile with Bearer auth", async () => {
    const fetchMock = mockFetch({ ok: true, json: { message: "deleted" } });

    await deleteZernioProfile(config, "prof_abc123");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://zernio.com/api/v1/profiles/prof_abc123");
    expect(init.method).toBe("DELETE");
    expect(init.headers.Authorization).toBe("Bearer zk_test_123");
  });

  it("throws ZernioApiError when compensation fails", async () => {
    mockFetch({ ok: false, status: 400, text: "profile has active accounts" });
    await expect(deleteZernioProfile(config, "prof_1")).rejects.toThrow(
      ZernioApiError,
    );
  });
});

describe("sendZernioInboxMessage", () => {
  it("POSTs the text into the conversation and returns data.messageId", async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: { success: true, data: { messageId: "zmsg_991" } },
    });

    const messageId = await sendZernioInboxMessage(config, {
      accountId: "acct_tg_98213",
      conversationExternalId: "chat 42",
      text: "Добрый день!",
    });

    expect(messageId).toBe("zmsg_991");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://zernio.com/api/v1/inbox/conversations/chat%2042/messages",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer zk_test_123");
    expect(JSON.parse(init.body)).toEqual({
      accountId: "acct_tg_98213",
      message: "Добрый день!",
    });
  });

  it("throws ZernioApiError with status and body on a non-2xx response", async () => {
    mockFetch({ ok: false, status: 422, text: '{"error":"Message window closed"}' });

    await expect(
      sendZernioInboxMessage(config, {
        accountId: "acct_1",
        conversationExternalId: "chat_1",
        text: "hi",
      }),
    ).rejects.toMatchObject({
      name: "ZernioApiError",
      status: 422,
      message: expect.stringMatching(/HTTP 422.*Message window closed/),
    });
  });

  it("throws when the response has no data.messageId", async () => {
    mockFetch({ ok: true, json: { success: true, data: {} } });

    await expect(
      sendZernioInboxMessage(config, {
        accountId: "acct_1",
        conversationExternalId: "chat_1",
        text: "hi",
      }),
    ).rejects.toThrow(ZernioApiError);
  });
});

describe("getZernioConnectAuthUrl", () => {
  it("GETs /connect/{platform} with profileId + redirect_url and returns authUrl", async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: { authUrl: "https://api.telegram.org/auth?x=1", state: "z1" },
    });

    const authUrl = await getZernioConnectAuthUrl(config, {
      platform: "telegram",
      profileId: "prof_abc123",
      redirectUrl: "https://app.drafta.example/api/channels/zernio/connect/callback?cn=n1",
    });

    expect(authUrl).toBe("https://api.telegram.org/auth?x=1");
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://zernio.com/api/v1/connect/telegram",
    );
    expect(parsed.searchParams.get("profileId")).toBe("prof_abc123");
    expect(parsed.searchParams.get("redirect_url")).toBe(
      "https://app.drafta.example/api/channels/zernio/connect/callback?cn=n1",
    );
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer zk_test_123");
  });

  it("throws when the response is missing authUrl", async () => {
    mockFetch({ ok: true, json: {} });

    await expect(
      getZernioConnectAuthUrl(config, {
        platform: "telegram",
        profileId: "prof_1",
        redirectUrl: "https://app.example/cb",
      }),
    ).rejects.toThrow(ZernioApiError);
  });
});

describe("listZernioConversations", () => {
  it("GETs /inbox/conversations with Bearer auth and reduces rows to participants", async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: {
        data: [
          {
            participantId: "ig_user_1",
            participantName: "Alexey",
            participantPicture: "https://scontent.example/a.jpg",
          },
          { participantId: "ig_user_2", participantPicture: null },
        ],
        pagination: { hasMore: true, nextCursor: "cur_2" },
      },
    });

    const page = await listZernioConversations(config, {
      accountId: "acct_ig_1",
      limit: 100,
    });

    expect(page).toEqual({
      participants: [
        { externalId: "ig_user_1", avatarUrl: "https://scontent.example/a.jpg" },
        { externalId: "ig_user_2", avatarUrl: null },
      ],
      nextCursor: "cur_2",
    });

    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://zernio.com/api/v1/inbox/conversations",
    );
    expect(parsed.searchParams.get("accountId")).toBe("acct_ig_1");
    expect(parsed.searchParams.get("limit")).toBe("100");
    expect(init.headers.Authorization).toBe("Bearer zk_test_123");
  });

  it("passes the cursor through and reports the last page as nextCursor null", async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: { data: [], pagination: { hasMore: false } },
    });

    const page = await listZernioConversations(config, {
      accountId: "acct_ig_1",
      cursor: "cur_2",
    });

    expect(page.nextCursor).toBeNull();
    const parsed = new URL(fetchMock.mock.calls[0][0] as string);
    expect(parsed.searchParams.get("cursor")).toBe("cur_2");
  });

  it("throws ZernioApiError with the provider's body on a non-2xx", async () => {
    mockFetch({ ok: false, status: 403, text: "Inbox addon required" });

    await expect(
      listZernioConversations(config, { accountId: "acct_ig_1" }),
    ).rejects.toThrow(/Inbox addon required/);
  });
});

describe("listZernioPostComments", () => {
  it("GETs /inbox/comments/{postId} and collects authors, replies included", async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: {
        comments: [
          {
            id: "c1",
            from: { id: "ig_user_1", picture: "https://scontent.example/1.jpg" },
            replies: [
              {
                id: "c1r1",
                from: { id: "ig_user_9", picture: "https://scontent.example/9.jpg" },
              },
            ],
          },
          { id: "c2", from: { id: "ig_user_2", picture: "   " } },
        ],
        // This endpoint reports `cursor`, not `nextCursor`.
        pagination: { hasMore: true, cursor: "cur_c2" },
      },
    });

    const page = await listZernioPostComments(config, {
      accountId: "acct_ig_1",
      postExternalId: "ig_post_88401",
    });

    expect(page).toEqual({
      participants: [
        { externalId: "ig_user_1", avatarUrl: "https://scontent.example/1.jpg" },
        { externalId: "ig_user_9", avatarUrl: "https://scontent.example/9.jpg" },
        // Blank picture is "no photo", not an empty URL to render.
        { externalId: "ig_user_2", avatarUrl: null },
      ],
      nextCursor: "cur_c2",
    });

    const parsed = new URL(fetchMock.mock.calls[0][0] as string);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://zernio.com/api/v1/inbox/comments/ig_post_88401",
    );
    expect(parsed.searchParams.get("accountId")).toBe("acct_ig_1");
  });

  it("throws ZernioApiError on a non-2xx", async () => {
    mockFetch({ ok: false, status: 404, text: "Not found" });

    await expect(
      listZernioPostComments(config, {
        accountId: "acct_ig_1",
        postExternalId: "missing",
      }),
    ).rejects.toThrow(ZernioApiError);
  });
});
