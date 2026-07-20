/**
 * Cloud projects that are allowed to receive the mutating RLS integration
 * probes. Keep this list empty until the dedicated Cloud dev project exists.
 *
 * Add a project ref only through the T-08 procedure and a reviewed commit.
 * Environment variables deliberately cannot extend this allowlist.
 */
export const approvedRlsTestCloudDevProjectRefs: readonly string[] = [];
