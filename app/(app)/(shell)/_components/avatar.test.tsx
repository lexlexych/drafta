// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar } from "./avatar";

describe("Avatar", () => {
  it("renders only the authenticated local proxy and reveals initials on error", () => {
    const { container } = render(
      <Avatar
        avatar={{
          initials: "AK",
          hue: 120,
          imageUrl: "/api/avatars/identity_1?v=abc",
        }}
      />,
    );
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/api/avatars/identity_1?v=abc");

    fireEvent.error(image!);
    expect(image?.style.display).toBe("none");
    expect(container.textContent).toContain("AK");
  });

  it("never renders a provider URL directly", () => {
    const { container } = render(
      <Avatar
        avatar={{
          initials: "AK",
          hue: 120,
          imageUrl: "https://scontent.cdninstagram.com/private.jpg",
        }}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
  });
});
