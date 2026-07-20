import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createAuthCallbackUrl,
  emailConfirmationCallbackPath,
  passwordRecoveryCallbackPath,
} from "./callback-paths";

describe("auth callback paths", () => {
  it("builds distinct exact URLs without caller-controlled query parameters", () => {
    const confirmationUrl = createAuthCallbackUrl(
      "http://localhost:3000",
      emailConfirmationCallbackPath,
    );
    const recoveryUrl = createAuthCallbackUrl(
      "http://localhost:3000",
      passwordRecoveryCallbackPath,
    );

    expect(confirmationUrl).toBe("http://localhost:3000/auth/confirm");
    expect(recoveryUrl).toBe("http://localhost:3000/auth/recovery");
    expect(new URL(confirmationUrl).search).toBe("");
    expect(new URL(recoveryUrl).search).toBe("");
  });

  it("keeps every local exact callback in the Supabase allow-list", () => {
    const config = readFileSync(
      join(process.cwd(), "supabase", "config.toml"),
      "utf8",
    );

    for (const origin of ["http://127.0.0.1:3000", "http://localhost:3000"]) {
      expect(config).toContain(
        `"${createAuthCallbackUrl(origin, emailConfirmationCallbackPath)}"`,
      );
      expect(config).toContain(
        `"${createAuthCallbackUrl(origin, passwordRecoveryCallbackPath)}"`,
      );
    }
  });
});
