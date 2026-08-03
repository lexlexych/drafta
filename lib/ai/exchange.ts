/**
 * Captures the provider exchange as it actually crosses the wire.
 *
 * The point of interception is `fetch` rather than the arguments handed to
 * `client.chat.completions.create()`: only here do we see the serialized
 * request body the SDK produced, the HTTP status, and — on a failed call — the
 * provider's error body, which never reaches the caller because the SDK turns
 * it into a thrown error.
 *
 * Kept free of `server-only` and of any I/O so it can be unit-tested without
 * mocking the OpenAI SDK. Persisting what it captures is the caller's job
 * (`lib/db/ai-request-log.ts`) — `lib/ai` never touches the database.
 */

/** One provider round trip, verbatim. Never includes headers — they carry the API key. */
export type AiExchange = {
  /** The JSON body sent, parsed. `{ raw }` when the body was not JSON. */
  requestBody: unknown;
  /** The JSON body received, parsed. `null` when no body arrived at all. */
  responseBody: unknown;
  /** `null` when the request failed before a response (timeout, connection error). */
  statusCode: number | null;
  durationMs: number;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ExchangeRecorder = {
  /** Hand this to `new OpenAI({ fetch })`. */
  fetch: FetchLike;
  /** The captured exchange, or `null` if no request was made. */
  read: () => AiExchange | null;
};

function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // A provider may answer with HTML (a gateway error page) or an empty body.
    // Keeping the text is more useful for debugging than dropping it.
    return { raw };
  }
}

function readRequestBody(init: RequestInit | undefined): unknown {
  const body = init?.body;

  if (typeof body === "string") {
    return parseBody(body);
  }

  if (body === undefined || body === null) {
    return null;
  }

  // Chat completions always serialize to a string; anything else means the SDK
  // took a path this recorder was not written for, and guessing at the bytes
  // would defeat the purpose of logging the request verbatim.
  return { raw: "[non-string request body]" };
}

/**
 * The recorder is single-use and lives in the closure of one provider call, so
 * concurrent generations never see each other's bodies. With `maxRetries: 0`
 * the SDK issues exactly one request per call, so there is nothing to overwrite.
 */
export function createExchangeRecorder(
  fetchImpl: FetchLike = fetch,
): ExchangeRecorder {
  let exchange: AiExchange | null = null;

  return {
    fetch: async (input, init) => {
      const startedAt = Date.now();
      const requestBody = readRequestBody(init);

      try {
        const response = await fetchImpl(input, init);
        let responseBody: unknown = null;

        try {
          // A clone, so the SDK still gets an unread body. Safe to buffer:
          // nothing in this codebase streams completions.
          responseBody = parseBody(await response.clone().text());
        } catch {
          // Never let a capture failure break the call it was observing.
          responseBody = null;
        }

        exchange = {
          requestBody,
          responseBody,
          statusCode: response.status,
          durationMs: Date.now() - startedAt,
        };

        return response;
      } catch (error) {
        exchange = {
          requestBody,
          responseBody: null,
          statusCode: null,
          durationMs: Date.now() - startedAt,
        };

        throw error;
      }
    },
    read: () => exchange,
  };
}
