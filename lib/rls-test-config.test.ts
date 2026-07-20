import { afterEach, describe, expect, it } from "vitest";

import { getRlsTestConfig } from "./rls-test-config";
import { approvedRlsTestCloudDevProjectRefs } from "./rls-test-targets";

const cloudDevProjectRef = "abcdefghijklmnopqrst";
const currentPublishableKey = "sb_publishable_arbitrary-current-key";

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
  projectRef = cloudDevProjectRef,
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return createEnvironment({
    RLS_TEST_REMOTE_CONFIRMATION: `cloud-dev:${projectRef}`,
    RLS_TEST_SUPABASE_URL: `https://${projectRef}.supabase.co`,
    RLS_TEST_TARGET: "cloud-dev",
    ...overrides,
  });
}

function approveCloudDevProjectRef(projectRef: string): void {
  // The production type is readonly; a test may model the reviewed file edit.
  (approvedRlsTestCloudDevProjectRefs as string[]).push(projectRef);
}

afterEach(() => {
  (approvedRlsTestCloudDevProjectRefs as string[]).splice(0);
});

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

  it("rejects a Cloud target until its ref is in the checked-in allowlist", () => {
    expect(() =>
      getRlsTestConfig(createCloudDevEnvironment()),
    ).toThrow("RLS_TEST_SUPABASE_URL project ref is not an approved Cloud dev target");
  });

  it("accepts only the exact confirmed URL of an approved Cloud dev project", () => {
    approveCloudDevProjectRef(cloudDevProjectRef);

    expect(getRlsTestConfig(createCloudDevEnvironment())).toMatchObject({
      target: "cloud-dev",
      url: `https://${cloudDevProjectRef}.supabase.co`,
    });
  });

  it("rejects a Cloud URL that is not its exact project endpoint", () => {
    approveCloudDevProjectRef(cloudDevProjectRef);

    expect(() =>
      getRlsTestConfig(
        createCloudDevEnvironment(cloudDevProjectRef, {
          RLS_TEST_SUPABASE_URL: `https://${cloudDevProjectRef}.supabase.co/not-allowed`,
        }),
      ),
    ).toThrow(
      `RLS_TEST_SUPABASE_URL must exactly equal https://${cloudDevProjectRef}.supabase.co`,
    );
  });

  it("rejects an unapproved production ref without relying on its name", () => {
    const unapprovedProductionRef = "qwertyuiopasdfghjklz";

    expect(() =>
      getRlsTestConfig(createCloudDevEnvironment(unapprovedProductionRef)),
    ).toThrow("RLS_TEST_SUPABASE_URL project ref is not an approved Cloud dev target");
  });

  it("binds the remote confirmation to the approved Cloud dev project ref", () => {
    approveCloudDevProjectRef(cloudDevProjectRef);

    expect(() =>
      getRlsTestConfig(
        createCloudDevEnvironment(cloudDevProjectRef, {
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
    ["an empty publishable key", "sb_publishable_"],
    ["a whitespace publishable key", "sb_publishable_contains a space"],
  ])("rejects %s as an RLS test key", (_label, key) => {
    expect(() =>
      getRlsTestConfig(
        createEnvironment({ RLS_TEST_SUPABASE_PUBLISHABLE_KEY: key }),
      ),
    ).toThrow(
      "RLS_TEST_SUPABASE_PUBLISHABLE_KEY must be a non-empty sb_publishable_ key",
    );
  });
});
