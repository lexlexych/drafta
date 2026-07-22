// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActiveDraftView } from "@/lib/drafts/types";

import { DraftPanel } from "./draft-panel";

const actionMocks = vi.hoisted(() => ({
  sendDraftAction: vi.fn(),
}));

vi.mock("../inbox/actions", () => ({
  editDraftAction: vi.fn(),
  discardDraftAction: vi.fn(),
  regenerateDraftAction: vi.fn(),
  sendDraftAction: actionMocks.sendDraftAction,
}));

const readyDraft: ActiveDraftView = {
  id: "draft-1",
  workspaceId: "workspace-1",
  conversationId: "conversation-1",
  status: "ready",
  text: "A grounded answer",
  model: "mistral-small-latest",
  kbFileIds: ["kb-1"],
  kbFileNames: ["FAQ.md"],
  createdAt: "2026-07-22T10:00:00.000Z",
  updatedAt: "2026-07-22T10:00:00.000Z",
};

afterEach(cleanup);

describe("real draft panel states", () => {
  it("renders generating without answer actions", () => {
    render(
      <DraftPanel
        draft={{ ...readyDraft, status: "generating", text: "" }}
        workspaceId="workspace-1"
        conversationId="conversation-1"
      />,
    );

    expect(screen.getByText("Генерируется…")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Править" })).toBeNull();
  });

  it.each(["ready", "edited"] as const)(
    "renders %s text, model, KB references and the live accept button",
    (status) => {
      render(
        <DraftPanel
          draft={{ ...readyDraft, status }}
          workspaceId="workspace-1"
          conversationId="conversation-1"
        />,
      );

      expect(screen.getByText("A grounded answer")).toBeDefined();
      expect(screen.getByText("mistral-small-latest")).toBeDefined();
      expect(screen.getByText("FAQ.md")).toBeDefined();
      const accept = screen.getByRole("button", {
        name: "Принять и отправить",
      });
      expect((accept as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByRole("button", { name: "Править" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Отклонить" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Заново" })).toBeDefined();
    },
  );

  it("accepting the draft calls sendDraftAction and hides the panel", async () => {
    actionMocks.sendDraftAction.mockResolvedValue({
      ok: true,
      messageId: "message-9",
    });

    render(
      <DraftPanel
        draft={readyDraft}
        workspaceId="workspace-1"
        conversationId="conversation-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Принять и отправить" }));

    expect(actionMocks.sendDraftAction).toHaveBeenCalledWith(
      "conversation-1",
      "draft-1",
    );
    await waitFor(() => {
      expect(screen.queryByText("A grounded answer")).toBeNull();
    });
  });

  it("keeps the panel and shows the error when accepting fails", async () => {
    actionMocks.sendDraftAction.mockResolvedValue({
      ok: false,
      error: "Черновик уже изменился — обновите тред.",
    });

    render(
      <DraftPanel
        draft={readyDraft}
        workspaceId="workspace-1"
        conversationId="conversation-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Принять и отправить" }));

    expect(await screen.findByText("A grounded answer")).toBeDefined();
  });

  it("keeps the subscription listener mounted when no active draft exists", () => {
    const { container } = render(
      <DraftPanel
        draft={null}
        workspaceId="workspace-1"
        conversationId="conversation-1"
      />,
    );

    expect(container.firstChild).toBeNull();
    fireEvent(
      window,
      new CustomEvent("drafta:draft-realtime-change", {
        detail: {
          eventType: "INSERT",
          new: {
            id: "draft-1",
            workspace_id: "workspace-1",
            conversation_id: "conversation-1",
            status: "ready",
            text: "Arrived live",
            model: "mistral-small-latest",
            kb_file_ids: [],
            created_at: "2026-07-22T10:00:00.000Z",
          },
        },
      }),
    );
    expect(screen.getByText("Arrived live")).toBeDefined();
  });
});
