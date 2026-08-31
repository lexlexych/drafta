import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChannelAdapter, ChannelProvider } from "./types";

function makeStubAdapter(provider: ChannelProvider): ChannelAdapter {
  return {
    provider,
    verifyWebhook: () => true,
    parseWebhook: () => ({ events: [], unparsed: [] }),
    sendMessage: async () => {
      throw new Error("not implemented in stub");
    },
  };
}

// The registry keeps state in a module-level Map. Reset the module registry
// between tests and re-import so each test starts from an empty registry.
describe("channel adapter registry", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("resolves a registered adapter by provider name", async () => {
    const { registerChannelAdapter, resolveChannelAdapter } = await import(
      "./registry"
    );
    const adapter = makeStubAdapter("zernio");

    registerChannelAdapter(adapter);

    expect(resolveChannelAdapter("zernio")).toBe(adapter);
  });

  it("throws a descriptive error for a known provider name with no registered adapter", async () => {
    const { resolveChannelAdapter, UnknownChannelProviderError } =
      await import("./registry");

    expect(() => resolveChannelAdapter("meta")).toThrow(
      UnknownChannelProviderError,
    );
    expect(() => resolveChannelAdapter("meta")).toThrow(/meta/);
  });

  it("throws the same descriptive error for a provider name that isn't a channel provider at all", async () => {
    const { resolveChannelAdapter, UnknownChannelProviderError } =
      await import("./registry");

    expect(() => resolveChannelAdapter("totally-unknown")).toThrow(
      UnknownChannelProviderError,
    );
    expect(() => resolveChannelAdapter("totally-unknown")).toThrow(
      /totally-unknown/,
    );
  });

  it("keeps providers isolated — registering one does not resolve another", async () => {
    const { registerChannelAdapter, resolveChannelAdapter } = await import(
      "./registry"
    );
    registerChannelAdapter(makeStubAdapter("zernio"));

    expect(() => resolveChannelAdapter("postmark")).toThrow();
  });
});
