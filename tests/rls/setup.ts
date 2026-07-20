import { getRlsTestConfig } from "../../lib/rls-test-config";

// Fail before a network request if an RLS suite is not explicitly configured.
getRlsTestConfig();
