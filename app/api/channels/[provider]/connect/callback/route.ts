import { NextResponse, type NextRequest } from "next/server";

// Side-effect import: registers the Zernio adapter under the "zernio"
// provider name (lib/channels/registry.ts) so `resolveChannelAdapter` finds
// its `parseConnectCallback` — same registration the webhook route relies on.
import "@/lib/channels/zernio";
import {
  resolveChannelAdapter,
  UnknownChannelProviderError,
} from "@/lib/channels/registry";
import {
  CONNECT_STATE_COOKIE,
  CONNECT_STATE_NONCE_PARAM,
  verifyConnectState,
} from "@/lib/channels/connect-state";
import { createChannelConnection } from "@/lib/db/channel-connections";
import { createServerSupabaseClient } from "@/lib/db/server";

export const dynamic = "force-dynamic";

/**
 * `GET /api/channels/[provider]/connect/callback` — where the provider's
 * hosted account-connect (OAuth) flow redirects the browser back once the
 * user authorized their account (docs/architecture/05-channels.md).
 *
 * It reads the signed pending-intent token from the httpOnly cookie set by
 * `startChannelConnectionAction`, verifies its signature + expiry, and
 * requires the nonce echoed in the URL (`cn`) to match the token's nonce (a
 * CSRF double-submit — the provider doesn't round-trip our state). It then
 * asks the provider's adapter to turn its callback query into the connected
 * account's external ID (`parseConnectCallback` — provider-specific parsing
 * stays in `lib/channels/<provider>/`, rule 4), creates the
 * `channel_connections` row under the user's RLS session, and redirects back
 * to Settings → Channels with a result banner. The user never touches the
 * provider's own dashboard.
 *
 * Mirrors the auth-callback pattern in app/(auth)/auth/confirm/route.ts
 * (force-dynamic, redirects built from `request.url`).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await params;
  const searchParams = request.nextUrl.searchParams;

  // Source of truth for the pending intent is the httpOnly cookie, not the
  // URL — the provider can't set it, so a forged callback has no valid state.
  const stateToken = request.cookies.get(CONNECT_STATE_COOKIE)?.value;
  if (!stateToken) {
    return redirectToChannels(request, "error", "state");
  }

  const verified = verifyConnectState(stateToken);
  if (!verified.ok) {
    return redirectToChannels(request, "error", "state");
  }

  // CSRF double-submit: the nonce echoed in our redirect_url must match the
  // cookie-stored token's nonce.
  const urlNonce = searchParams.get(CONNECT_STATE_NONCE_PARAM);
  if (!urlNonce || urlNonce !== verified.state.nonce) {
    return redirectToChannels(request, "error", "state");
  }

  let adapter;
  try {
    adapter = resolveChannelAdapter(provider);
  } catch (error) {
    if (error instanceof UnknownChannelProviderError) {
      return redirectToChannels(request, "error", "provider");
    }
    throw error;
  }

  if (!adapter.parseConnectCallback) {
    return redirectToChannels(request, "error", "provider");
  }

  const query = Object.fromEntries(searchParams.entries());

  let externalAccountId: string;
  let reportedPlatform: string | undefined;
  try {
    const parsed = await adapter.parseConnectCallback({ query });
    externalAccountId = parsed.externalAccountId;
    reportedPlatform = parsed.platform;
  } catch (error) {
    console.error(
      `[channels/${provider}] connect callback did not yield an account`,
      error,
    );
    return redirectToChannels(request, "error", "callback");
  }

  // Sanity: the platform the provider reports should match the one we started
  // the flow for. A mismatch means a crossed/forged flow — refuse it.
  if (reportedPlatform && reportedPlatform !== verified.state.platform) {
    return redirectToChannels(request, "error", "state");
  }

  const supabase = await createServerSupabaseClient();
  const result = await createChannelConnection(supabase, verified.state.workspaceId, {
    provider,
    platform: verified.state.platform,
    externalId: externalAccountId,
    name: verified.state.name,
  });

  if (!result.ok) {
    // A duplicate (workspace, provider, external_id) is the one expected
    // business error; everything else (e.g. RLS rejecting because the session
    // isn't a member) is a generic failure.
    const reason = /уже подключён/.test(result.error) ? "duplicate" : "failed";
    return redirectToChannels(request, "error", reason);
  }

  return redirectToChannels(request, "connected");
}

/**
 * Redirects to Settings → Channels with a result banner, always clearing the
 * single-use connect-state cookie on the way out.
 */
function redirectToChannels(
  request: NextRequest,
  connect: "connected" | "error",
  reason?: string,
): NextResponse {
  const url = new URL("/settings", request.url);
  url.searchParams.set("section", "channels");
  url.searchParams.set("connect", connect);
  if (reason) {
    url.searchParams.set("reason", reason);
  }

  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(CONNECT_STATE_COOKIE, "", {
    maxAge: 0,
    path: "/",
  });

  return response;
}
