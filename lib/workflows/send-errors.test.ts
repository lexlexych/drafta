import { describe, expect, it } from "vitest";

import {
  isNonRetriableSendError,
  rethrowAsWorkflowSendError,
} from "./send-errors";

const withStatus = (status: number) =>
  Object.assign(new Error("provider said no"), { status });

describe("isNonRetriableSendError", () => {
  it("treats 4xx as definitive except timeout and rate limit", () => {
    expect(isNonRetriableSendError(withStatus(400))).toBe(true);
    expect(isNonRetriableSendError(withStatus(403))).toBe(true);
    expect(isNonRetriableSendError(withStatus(422))).toBe(true);
    expect(isNonRetriableSendError(withStatus(408))).toBe(false);
    expect(isNonRetriableSendError(withStatus(429))).toBe(false);
    expect(isNonRetriableSendError(withStatus(500))).toBe(false);
    expect(isNonRetriableSendError(new Error("no status"))).toBe(false);
    expect(isNonRetriableSendError(null)).toBe(false);
  });
});

describe("rethrowAsWorkflowSendError", () => {
  it("turns a definitive rejection into a FatalError that keeps the status", () => {
    expect(() => rethrowAsWorkflowSendError(withStatus(422))).toThrow(
      /Provider rejected the send \(HTTP 422\): provider said no/,
    );

    try {
      rethrowAsWorkflowSendError(withStatus(422));
    } catch (error) {
      // FatalError отменяет ретраи шага — это и заменяет NonRetriableError.
      expect((error as { fatal?: boolean }).fatal).toBe(true);
    }
  });

  it("rethrows a retriable provider error untouched so the step retries", () => {
    const providerError = withStatus(500);

    expect(() => rethrowAsWorkflowSendError(providerError)).toThrow(providerError);
  });
});
