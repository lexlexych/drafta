// @vitest-environment jsdom

/**
 * Client-side behavior of `MarkThreadRead` (T-05): fires the server action
 * once per opened conversation, refreshes the router on success, doesn't
 * re-fire for the same id, does fire again for a new one. The action itself
 * (`./actions.ts`) is mocked — its DB-backed logic is covered by
 * `lib/db/inbox.test.ts`, same split `channels-panel.test.tsx` (T-04) uses
 * for its server actions.
 */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkThreadRead } from "./mark-thread-read";

const markConversationReadAction = vi.fn();

vi.mock("./actions", () => ({
  markConversationReadAction: (...args: unknown[]) =>
    markConversationReadAction(...args),
}));

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MarkThreadRead", () => {
  it("marks the conversation read once on mount and refreshes on success", async () => {
    markConversationReadAction.mockResolvedValue({ ok: true });

    render(<MarkThreadRead conversationId="cnv_1" />);

    await waitFor(() =>
      expect(markConversationReadAction).toHaveBeenCalledWith("cnv_1"),
    );
    expect(markConversationReadAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("does not refresh the router when the action fails", async () => {
    markConversationReadAction.mockResolvedValue({
      ok: false,
      error: "Диалог не найден.",
    });

    render(<MarkThreadRead conversationId="cnv_1" />);

    await waitFor(() =>
      expect(markConversationReadAction).toHaveBeenCalledWith("cnv_1"),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not re-fire for the same conversation id across re-renders", async () => {
    markConversationReadAction.mockResolvedValue({ ok: true });

    const { rerender } = render(<MarkThreadRead conversationId="cnv_1" />);
    await waitFor(() =>
      expect(markConversationReadAction).toHaveBeenCalledTimes(1),
    );

    rerender(<MarkThreadRead conversationId="cnv_1" />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(markConversationReadAction).toHaveBeenCalledTimes(1);
  });

  it("fires again when the conversation id changes (opening a different thread)", async () => {
    markConversationReadAction.mockResolvedValue({ ok: true });

    const { rerender } = render(<MarkThreadRead conversationId="cnv_1" />);
    await waitFor(() =>
      expect(markConversationReadAction).toHaveBeenCalledWith("cnv_1"),
    );

    rerender(<MarkThreadRead conversationId="cnv_2" />);

    await waitFor(() =>
      expect(markConversationReadAction).toHaveBeenCalledWith("cnv_2"),
    );
    expect(markConversationReadAction).toHaveBeenCalledTimes(2);
  });
});
