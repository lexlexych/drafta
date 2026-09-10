// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../inbox/actions", () => ({ translateMessageAction: vi.fn() }));
vi.mock("../comments/actions", () => ({ translateCommentAction: vi.fn() }));
vi.mock("./stub", () => ({ showToast: vi.fn() }));

import { translateMessageAction } from "../inbox/actions";
import { translateCommentAction } from "../comments/actions";
import { MessageBubble } from "./message-bubble";
import { CommentCard } from "../comments/_components/comment-card";

const translation = { text: "Old translation", sourceLanguage: "en" };

function renderMessage() {
  render(<MessageBubble conversationId="parent" message={{ id: "item", direction: "in", text: "Original", time: "12:00", deliveryLabel: null, attachmentName: null, canRetrySend: false, isAutoReply: false, translation }} />);
}

function renderComment() {
  render(<CommentCard postId="parent" commentTemplates={[]} messageTemplates={[]} templateLanguage="ru" comment={{ id: "item", externalId: "external", parentExternalId: null, authorName: "Author", avatar: null, text: "Original", createdAt: "2026-09-10T12:00:00Z", time: "12:00", isOurs: false, deliveryLabel: null, translation, privateReply: null, canPrivateReply: false, dmHref: null }} />);
}

beforeEach(() => { cleanup(); vi.resetAllMocks(); });

describe.each([
  { name: "message", mount: renderMessage, action: translateMessageAction },
  { name: "comment", mount: renderComment, action: translateCommentAction },
])("$name refresh control", ({ mount, action }) => {
  it("refreshes a cached translation and uses the new text on subsequent toggles", async () => {
    vi.mocked(action).mockResolvedValue({ ok: true, text: "New translation", sourceLanguage: "de" });
    mount();
    expect(screen.queryByRole("button", { name: "Перевести заново" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Перевести" }));
    expect(screen.getByText("Old translation")).toBeDefined();
    expect(action).not.toHaveBeenCalled();
    const refresh = screen.getByRole("button", { name: "Перевести заново" });
    expect(refresh.nextElementSibling?.getAttribute("aria-label")).toMatch(/^Показать оригинал/);
    fireEvent.click(refresh);
    expect(await screen.findByText("New translation")).toBeDefined();
    expect(action).toHaveBeenCalledWith("parent", "item", true);
    fireEvent.click(screen.getByRole("button", { name: /Показать оригинал/ }));
    expect(screen.getByText("Original")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Перевести" }));
    expect(screen.getByText("New translation")).toBeDefined();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("preserves the translation on failure and allows another attempt", async () => {
    vi.mocked(action).mockRejectedValueOnce(new Error("Network error"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Перевести" }));
    fireEvent.click(screen.getByRole("button", { name: "Перевести заново" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Перевести заново" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText("Old translation")).toBeDefined();
    vi.mocked(action).mockResolvedValue({ ok: true, text: "Retried translation", sourceLanguage: "en" });
    fireEvent.click(screen.getByRole("button", { name: "Перевести заново" }));
    expect(await screen.findByText("Retried translation")).toBeDefined();
  });

  it("disables both controls during a refresh", async () => {
    let resolve!: (result: Awaited<ReturnType<typeof action>>) => void;
    vi.mocked(action).mockReturnValue(new Promise((done) => { resolve = done; }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Перевести" }));
    fireEvent.click(screen.getByRole("button", { name: "Перевести заново" }));
    const refresh = screen.getByRole("button", { name: "Перевести заново" }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);
    expect((refresh.nextElementSibling as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(refresh);
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ ok: false, error: "Failed" }); });
    expect(refresh.disabled).toBe(false);
  });
});
