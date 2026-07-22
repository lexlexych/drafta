import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  isNonRetriableSendError,
  runSendMessagePipeline,
} = await import("./send-pipeline");
import type {
  LoadedSendContext,
  SendMessageDependencies,
  SendMessageSteps,
} from "./send-pipeline";

class TestSteps implements SendMessageSteps {
  readonly runs: string[] = [];

  async run<T>(id: string, handler: () => Promise<T> | T): Promise<T> {
    this.runs.push(id);
    return handler();
  }
}

function context(overrides: Partial<LoadedSendContext> = {}): LoadedSendContext {
  return {
    workspaceId: "workspace-1",
    messageId: "message-1",
    text: "Добрый день! Отвечаем на ваш вопрос.",
    provider: "zernio",
    channelConnectionId: "connection-1",
    externalAccountId: "acct_tg_98213",
    conversationExternalId: "chat_42",
    interactionKind: "dm",
    parentExternalId: null,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<SendMessageDependencies> = {},
): SendMessageDependencies {
  return {
    loadContext: vi.fn().mockResolvedValue({ status: "ok", context: context() }),
    sendViaAdapter: vi.fn().mockResolvedValue("zmsg_991"),
    markSent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const input = {
  workspaceId: "workspace-1",
  conversationId: "conversation-1",
  messageId: "message-1",
};

describe("send message pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads context, sends via the adapter, and records the provider id", async () => {
    const steps = new TestSteps();
    const deps = dependencies();

    const result = await runSendMessagePipeline(input, steps, deps);

    expect(result).toEqual({ status: "sent", providerMessageId: "zmsg_991" });
    expect(steps.runs).toEqual(["load-context", "send-via-adapter", "mark-sent"]);
    expect(deps.sendViaAdapter).toHaveBeenCalledWith(context());
    expect(deps.markSent).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      messageId: "message-1",
      providerMessageId: "zmsg_991",
    });
  });

  it.each([
    "message-not-found",
    "not-outgoing",
    "already-sent",
    "not-pending",
    "connection-inactive",
  ] as const)("skips without sending when load-context reports %s", async (reason) => {
    const steps = new TestSteps();
    const deps = dependencies({
      loadContext: vi.fn().mockResolvedValue({ status: "skip", reason }),
    });

    const result = await runSendMessagePipeline(input, steps, deps);

    expect(result).toEqual({ status: "skipped", reason });
    expect(deps.sendViaAdapter).not.toHaveBeenCalled();
    expect(deps.markSent).not.toHaveBeenCalled();
  });

  it("wraps a definitive provider rejection in NonRetriableError", async () => {
    const steps = new TestSteps();
    const providerError = Object.assign(
      new Error("Zernio message send failed (HTTP 422): window closed"),
      { status: 422 },
    );
    const deps = dependencies({
      sendViaAdapter: vi.fn().mockRejectedValue(providerError),
    });

    await expect(runSendMessagePipeline(input, steps, deps)).rejects.toMatchObject({
      name: "NonRetriableError",
      cause: providerError,
    });
    expect(deps.markSent).not.toHaveBeenCalled();
  });

  it("rethrows retriable provider errors unwrapped so Inngest retries", async () => {
    const steps = new TestSteps();
    const providerError = Object.assign(
      new Error("Zernio message send failed (HTTP 500)"),
      { status: 500 },
    );
    const deps = dependencies({
      sendViaAdapter: vi.fn().mockRejectedValue(providerError),
    });

    await expect(runSendMessagePipeline(input, steps, deps)).rejects.toBe(
      providerError,
    );
  });
});

describe("isNonRetriableSendError", () => {
  it("treats 4xx as definitive except timeout and rate limit", () => {
    const withStatus = (status: number) => Object.assign(new Error("x"), { status });

    expect(isNonRetriableSendError(withStatus(400))).toBe(true);
    expect(isNonRetriableSendError(withStatus(403))).toBe(true);
    expect(isNonRetriableSendError(withStatus(422))).toBe(true);
    expect(isNonRetriableSendError(withStatus(408))).toBe(false);
    expect(isNonRetriableSendError(withStatus(429))).toBe(false);
    expect(isNonRetriableSendError(withStatus(500))).toBe(false);
    expect(isNonRetriableSendError(new Error("no status"))).toBe(false);
    expect(isNonRetriableSendError(null)).toBe(false);
  });
});
