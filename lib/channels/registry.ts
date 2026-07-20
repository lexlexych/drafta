import type { ChannelAdapter, ChannelProvider } from "./types";

/**
 * Provider name → adapter instance. Empty until providers register
 * themselves (Zernio registers in T-02; see
 * docs/architecture/05-channels.md).
 */
const adapters = new Map<ChannelProvider, ChannelAdapter>();

/** Registers a provider's adapter. Each provider module calls this once, at import time. */
export function registerChannelAdapter(adapter: ChannelAdapter): void {
  adapters.set(adapter.provider, adapter);
}

/**
 * Resolves the adapter for a provider name.
 *
 * `provider` is deliberately typed `string`, not `ChannelProvider`: callers
 * such as the webhook route (`app/api/webhooks/[provider]/`) get it from a
 * URL segment, which can be any string — not just a known provider.
 *
 * Throws `UnknownChannelProviderError` when no adapter is registered, either
 * because the name isn't a real provider or because that provider's adapter
 * hasn't been implemented/registered yet.
 */
export function resolveChannelAdapter(provider: string): ChannelAdapter {
  const adapter = adapters.get(provider as ChannelProvider);

  if (!adapter) {
    throw new UnknownChannelProviderError(provider);
  }

  return adapter;
}

/** Thrown by `resolveChannelAdapter` when no adapter is registered for the given provider name. */
export class UnknownChannelProviderError extends Error {
  constructor(public readonly provider: string) {
    super(`No channel adapter is registered for provider "${provider}".`);
    this.name = "UnknownChannelProviderError";
  }
}
