import { describe, expect, it } from "vitest";

import { appDescription, appName } from "./app-metadata";

describe("app metadata", () => {
  it("provides the startup page content", () => {
    expect(appName).toBe("drafta");
    expect(appDescription).toBeTruthy();
  });
});
