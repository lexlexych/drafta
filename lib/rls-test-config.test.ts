import { describe, expect, it } from "vitest";

import { getRlsTestConfig } from "./rls-test-config";

function createEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    RLS_TEST_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
    RLS_TEST_SUPABASE_URL: "http://127.0.0.1:54321",
    RLS_TEST_TARGET: "local",
    RLS_TEST_USER_A_PASSWORD: "test-password-a",
    RLS_TEST_USER_B_PASSWORD: "test-password-b",
    ...overrides,
  };
}

describe("getRlsTestConfig", () => {
  it("accepts an explicitly configured local Supabase target", () => {
    expect(getRlsTestConfig(createEnvironment())).toEqual({
      ownerAPassword: "test-password-a",
      ownerBPassword: "test-password-b",
      publishableKey: "sb_publishable_test_key",
      target: "local",
      url: "http://127.0.0.1:54321",
    });
  });

  it("fails before connecting when required configuration is absent", () => {
    expect(() =>
      getRlsTestConfig(
        createEnvironment({ RLS_TEST_SUPABASE_PUBLISHABLE_KEY: undefined }),
      ),
    ).toThrow(
      "Missing required RLS test environment variable: RLS_TEST_SUPABASE_PUBLISHABLE_KEY",
    );
  });

  it("rejects a non-loopback URL for the local target", () => {
    expect(() =>
      getRlsTestConfig(
        createEnvironment({
          RLS_TEST_SUPABASE_URL: "https://example.supabase.co",
        }),
      ),
    ).toThrow("RLS_TEST_TARGET=local only permits");
  });

  it("requires a deliberate confirmation for a cloud dev target", () => {
    expect(() =>
      getRlsTestConfig(
        createEnvironment({
          RLS_TEST_SUPABASE_URL: "https://dev-project.supabase.co",
          RLS_TEST_TARGET: "cloud-dev",
        }),
      ),
    ).toThrow(
      "Remote RLS tests require RLS_TEST_REMOTE_CONFIRMATION=cloud-dev-only",
    );
  });

  it("accepts only the confirmed Supabase Cloud dev route", () => {
    expect(
      getRlsTestConfig(
        createEnvironment({
          RLS_TEST_REMOTE_CONFIRMATION: "cloud-dev-only",
          RLS_TEST_SUPABASE_URL: "https://dev-project.supabase.co",
          RLS_TEST_TARGET: "cloud-dev",
        }),
      ),
    ).toMatchObject({
      target: "cloud-dev",
      url: "https://dev-project.supabase.co",
    });
  });

  it("rejects a secret key even when the target itself is valid", () => {
    expect(() =>
      getRlsTestConfig(
        createEnvironment({
          RLS_TEST_SUPABASE_PUBLISHABLE_KEY: "sb_secret_not_allowed",
        }),
      ),
    ).toThrow(
      "RLS_TEST_SUPABASE_PUBLISHABLE_KEY must not contain a Supabase secret key",
    );
  });
});
