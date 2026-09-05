import { NextResponse, type NextRequest } from "next/server";

// Side-effect import: registers the Zernio adapter under the "zernio"
// provider name (lib/channels/registry.ts) — see
// lib/channels/zernio/index.ts and docs/epics/epic_02/T-02-zernio-adapter.md
// ("Ничего в этом эпике пока не импортирует index.ts — это сделает
// вебхук-роут в T-03"). Postmark/Meta aren't registered yet — resolving
// those provider names 404s below, same as any other unrecognized value.
import "@/lib/channels/zernio";
import { resolveChannelAdapter, UnknownChannelProviderError } from "@/lib/channels/registry";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { journalUnparsedEnvelope } from "@/lib/webhooks/journal-unparsed";
import { processInboundEvent } from "@/lib/webhooks/process-event";

/**
 * `POST /api/webhooks/[provider]` — the single inbound webhook entry point
 * for every channel provider (docs/architecture/12-repo-structure.md),
 * implementing §6.1's pipeline
 * (docs/architecture/07-data-flows.md#61-входящее-dm-или-комментарий):
 *
 *   verify signature → webhook_events idempotency write → adapter normalizes
 *   → upsert contact_identity(+contact), conversation → insert message
 *   → start the send-push / contact-avatar workflows → 200
 *
 * Vibecoding rule 6 (docs/architecture/14-vibecoding-rules.md#6): no LLM
 * calls here, answers fast. The route itself only does HTTP concerns
 * (resolve provider, read the raw request, verify, respond); the DB
 * pipeline for each normalized event is `lib/webhooks/process-event.ts`,
 * which never throws — every event is processed independently so one bad
 * event in a batch can't take the rest down.
 *
 * Envelopes the adapter could not normalize are journaled too
 * (`lib/webhooks/journal-unparsed.ts`), so an unreadable delivery is visible
 * in `webhook_events` rather than only in logs that rotate within the hour.
 *
 * No LLM calls, no external sends — this route never imports `lib/ai` or
 * sends anything itself (rules 6, 8, 9).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await params;

  let adapter;
  try {
    adapter = resolveChannelAdapter(provider);
  } catch (error) {
    if (error instanceof UnknownChannelProviderError) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
    }
    throw error;
  }

  const rawBody = await request.text();
  // `Headers#entries()`/`Object.fromEntries` yield lower-cased header names
  // per the Fetch spec — matches `VerifyWebhookInput.headers`'s contract
  // (lib/channels/types.ts) without any extra normalization here.
  const headers = Object.fromEntries(request.headers.entries());

  const verified = await adapter.verifyWebhook({ rawBody, headers });
  if (!verified) {
    // Nothing written to the DB for an invalid signature — see T-03
    // acceptance criteria.
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = await adapter.parseWebhook({ rawBody, headers });
  } catch (error) {
    console.error(`[webhooks/${provider}] failed to parse webhook payload`, error);
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  const supabase = createAdminSupabaseClient();

  // Envelopes the adapter refused go into the journal before the ones it
  // understood are processed: an unreadable delivery that leaves no row is
  // indistinguishable from a delivery the provider never made, and telling
  // those two apart is the difference between a `select` and asking the
  // provider for their own logs. Same fail-safe discipline as below — this
  // never throws and never changes the response.
  for (const envelope of parsed.unparsed) {
    await journalUnparsedEnvelope(supabase, provider, envelope);
  }

  // Sequential, not Promise.all: events in one delivery can affect the same
  // conversation (e.g. two messages in a batch), so processing them one at
  // a time avoids two concurrent "create the conversation" races colliding
  // on top of the retry logic `process-event.ts` already has for a single
  // event. Batches are small (a handful of events at most), so this stays
  // well inside the <1s budget (rule 6).
  for (const event of parsed.events) {
    await processInboundEvent(supabase, event);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
