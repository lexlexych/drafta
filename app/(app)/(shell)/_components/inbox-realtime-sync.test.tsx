// @vitest-environment jsdom

/**
 * Lifecycle behavior of `InboxRealtimeSync` (T-06): subscribes once on mount
 * with the browser Supabase client + workspace id, refreshes the router when
 * the subscription reports a relevant event, unsubscribes on unmount, and
 * resubscribes if the workspace id ever changes. The subscription's own
 * wiring (`postgres_changes` filters, debounce) is covered separately —
 * `lib/realtime/inbox-sync.test.ts` — and mocked here.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InboxRealtimeSync } from "./inbox-realtime-sync";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const browserClient = { marker: "fake-browser-client" };
const createBrowserSupabaseClient = vi.fn(() => browserClient);

vi.mock("@/lib/db/browser", () => ({
  createBrowserSupabaseClient: () => createBrowserSupabaseClient(),
}));

const unsubscribe = vi.fn();
const subscribeToInboxRealtime = vi.fn(() => unsubscribe);

vi.mock("@/lib/realtime/inbox-sync", () => ({
  subscribeToInboxRealtime: (...args: unknown[]) =>
    subscribeToInboxRealtime(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InboxRealtimeSync", () => {
  it("subscribes on mount with the browser client and the given workspace id", () => {
    render(<InboxRealtimeSync workspaceId="wsp_a" />);

    expect(subscribeToInboxRealtime).toHaveBeenCalledTimes(1);
    const [client, workspaceId] = subscribeToInboxRealtime.mock.calls[0];
    expect(client).toBe(browserClient);
    expect(workspaceId).toBe("wsp_a");
  });

  it("refreshes the router when the subscription reports an event", () => {
    render(<InboxRealtimeSync workspaceId="wsp_a" />);

    const onEvent = subscribeToInboxRealtime.mock.calls[0][2] as () => void;
    expect(refresh).not.toHaveBeenCalled();

    onEvent();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = render(<InboxRealtimeSync workspaceId="wsp_a" />);
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("tears down the old subscription and opens a new one when the workspace id changes", () => {
    const { rerender } = render(<InboxRealtimeSync workspaceId="wsp_a" />);
    expect(subscribeToInboxRealtime).toHaveBeenCalledTimes(1);

    rerender(<InboxRealtimeSync workspaceId="wsp_b" />);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribeToInboxRealtime).toHaveBeenCalledTimes(2);
    expect(subscribeToInboxRealtime.mock.calls[1][1]).toBe("wsp_b");
  });

  it("does not resubscribe on a re-render with the same workspace id", () => {
    const { rerender } = render(<InboxRealtimeSync workspaceId="wsp_a" />);
    expect(subscribeToInboxRealtime).toHaveBeenCalledTimes(1);

    rerender(<InboxRealtimeSync workspaceId="wsp_a" />);

    expect(unsubscribe).not.toHaveBeenCalled();
    expect(subscribeToInboxRealtime).toHaveBeenCalledTimes(1);
  });

  it("renders nothing", () => {
    const { container } = render(<InboxRealtimeSync workspaceId="wsp_a" />);
    expect(container.firstChild).toBeNull();
  });
});
