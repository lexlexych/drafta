import { describe, expect, it } from "vitest";

import { getRlsTestConfig } from "./rls-test-config";

const cloudDevProjectRef = "abcdefghijklmnopqrst";
const currentPublishableKey =
  "sb_publishable_abcdefghijklmnopqrstuv_12345678";

function createEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    RLS_TEST_SUPABASE_PUBLISHABLE_KEY: currentPublishableKey,
    RLS_TEST_SUPABASE_URL: "http://127.0.0.1:54321",
    RLS_TEST_TARGET: "local",
    RLS_TEST_USER_A_PASSWORD: "test-password-a",
    RLS_TEST_USER_B_PASSWORD: "test-password-b",
    ...overrides,
  };
}

function createCloudDevEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return createEnvironment({
    RLS_TEST_DEV_PROJECT_REF: cloudDevProjectRef,
    RLS_TEST_REMOTE_CONFIRMATION: `cloud-dev:${cloudDevProjectRef}`,
    RLS_TEST_SUPABASE_URL: `https://${cloudDevProjectRef}.supabase.co`,
    RLS_TEST_TARGET: "cloud-dev",
    ...overrides,
  });
}

describe("getRlsTestConfig", () => {
  it("accepts an explicitly configured local Supabase target", () => {
    expect(getRlsTestConfig(createEnvironment())).toEqual({
      ownerAPassword: "test-password-a",
      ownerBPassword: "test-password-b",
      publishableKey: currentPublishableKey,
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

  it("requires an explicit Cloud dev project ref before connecting", () => {
    expect(() =>
      getRlsTestConfig(
        createEnvironment({
          RLS_TEST_REMOTE_CONFIRMATION: `cloud-dev:${cloudDevProjectRef}`,
          RLS_TEST_SUPABASE_URL: `https://${cloudDevProjectRef}.supabase.co`,
          RLS_TEST_TARGET: "cloud-dev",
        }),
      ),
    ).toThrow(
      "Missing required RLS test environment variable: RLS_TEST_DEV_PROJECT_REF",
    );
  });

  it("accepts only the exact confirmed Supabase Cloud dev route", () => {
    expect(
      getRlsTestConfig(createCloudDevEnvironment()),
    ).toMatchObject({
      target: "cloud-dev",
      url: `https://${cloudDevProjectRef}.supabase.co`,
    });
  });

  it("rejects a Cloud URL that does not match the declared dev project ref", () => {
    expect(() =>
      getRlsTestConfig(
        createCloudDevEnvironment({
          RLS_TEST_SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co",
        }),
      ),
    ).toThrow(
      `RLS_TEST_SUPABASE_URL must exactly equal https://${cloudDevProjectRef}.supabase.co`,
    );
  });

  it("rejects a production-like project ref even when URL and confirmation match", () => {
    const productionLikeProjectRef = "prodabcdefghijklmnop";

    expect(() =>
      getRlsTestConfig(
        createCloudDevEnvironment({
          RLS_TEST_DEV_PROJECT_REF: productionLikeProjectRef,
          RLS_TEST_REMOTE_CONFIRMATION: `cloud-dev:${productionLikeProjectRef}`,
          RLS_TEST_SUPABASE_URL: `https://${productionLikeProjectRef}.supabase.co`,
        }),
      ),
    ).toThrow(
      'RLS_TEST_DEV_PROJECT_REF must not contain the production-like fragment "prod"',
    );
  });

  it("binds the remote confirmation to the declared dev project ref", () => {
    expect(() =>
      getRlsTestConfig(
        createCloudDevEnvironment({
          RLS_TEST_REMOTE_CONFIRMATION: "cloud-dev-only",
        }),
      ),
    ).toThrow(
      `Remote RLS tests require RLS_TEST_REMOTE_CONFIRMATION=cloud-dev:${cloudDevProjectRef}`,
    );
  });

  it.each([
    ["an arbitrary string", "not-a-publishable-key"],
    [
      "a legacy anon JWT",
      "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signature",
    ],
    [
      "a legacy service-role JWT",
      "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature",
    ],
    ["a current secret key", "sb_secret_abcdefghijklmnopqrstuv_12345678"],
    ["a malformed publishable key", "sb_publishable_too_short"],
  ])("rejects %s as an RLS test key", (_label, key) => {
    expect(() =>
      getRlsTestConfig(
        createEnvironment({ RLS_TEST_SUPABASE_PUBLISHABLE_KEY: key }),
      ),
    ).toThrow(
      "RLS_TEST_SUPABASE_PUBLISHABLE_KEY must be a current sb_publishable_<22-char>_<8-char> key",
    );
  });
});
