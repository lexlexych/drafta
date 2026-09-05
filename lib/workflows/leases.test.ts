import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
vi.mock("@/lib/db/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc }),
}));

const slept: string[] = [];
vi.mock("workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("workflow")>();
  return {
    ...actual,
    getWorkflowMetadata: () => ({ workflowRunId: "wrun_test" }),
    sleep: async (duration: string) => {
      slept.push(duration);
    },
  };
});

const { acquireLeases, cronLease, entityLease, releaseLeases, workspaceLlmLease } =
  await import("./leases");

/** Отвечает на acquire по ключу: очередь ответов на каждый ключ. */
function answerWith(answers: Record<string, boolean[]>) {
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "release_workflow_lease") return { data: null, error: null };
    const key = args.p_key as string;
    const queue = answers[key] ?? [true];
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    return { data: next, error: null };
  });
}

beforeEach(() => {
  rpc.mockReset();
  slept.length = 0;
});

describe("acquireLeases", () => {
  it("acquires every lease in the declared order", async () => {
    answerWith({});
    const leases = [
      workspaceLlmLease("ws-1"),
      entityLease("conversation", "conv-1", "ws-1"),
    ];

    await acquireLeases(leases);

    const acquireCalls = rpc.mock.calls.filter(
      ([fn]) => fn === "acquire_workflow_lease",
    );
    expect(acquireCalls.map(([, args]) => args.p_key)).toEqual([
      "workspace:ws-1",
      "conversation:conv-1",
    ]);
    expect(acquireCalls[0]?.[1]).toMatchObject({
      p_limit: 2,
      p_holder: "wrun_test",
      p_workspace_id: "ws-1",
    });
  });

  it("waits and retries while the slot is taken", async () => {
    answerWith({ "workspace:ws-1": [false, false, true] });

    await acquireLeases([workspaceLlmLease("ws-1")]);

    expect(slept).toEqual(["2s", "2s"]);
  });

  it("releases already-held leases when a later one times out", async () => {
    answerWith({
      "workspace:ws-1": [true],
      "conversation:conv-1": [false],
    });

    await expect(
      acquireLeases(
        [workspaceLlmLease("ws-1"), entityLease("conversation", "conv-1", "ws-1")],
        2,
      ),
    ).rejects.toThrow(/Timed out waiting for the workflow lease conversation:conv-1/);

    const released = rpc.mock.calls
      .filter(([fn]) => fn === "release_workflow_lease")
      .map(([, args]) => args.p_key);
    expect(released).toEqual(["workspace:ws-1"]);
  });

  it("surfaces a database error instead of silently continuing", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42883" } });

    await expect(acquireLeases([workspaceLlmLease("ws-1")])).rejects.toThrow(
      /Acquiring the workflow lease workspace:ws-1 failed \(42883\)/,
    );
  });
});

describe("releaseLeases", () => {
  it("never throws when the release call fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "08006" } });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(releaseLeases([cronLease("push-digest", 600)])).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("lease keys", () => {
  it("keeps the documented concurrency limits", () => {
    expect(workspaceLlmLease("ws-1")).toMatchObject({
      key: "workspace:ws-1",
      limit: 2,
    });
    expect(entityLease("post", "post-1", "ws-1")).toMatchObject({
      key: "post:post-1",
      limit: 1,
    });
    expect(cronLease("push-digest", 600)).toMatchObject({
      key: "cron:push-digest",
      limit: 1,
      workspaceId: null,
    });
  });
});
