import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PresetIcon } from "./PresetIcon";

describe("PresetIcon", () => {
  it("renders a legacy emoji icon as text", () => {
    const { container } = render(<PresetIcon icon={"\u{1F3AE}"} />);
    expect(container.textContent).toBe("\u{1F3AE}");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders a known lucide name as an svg icon", () => {
    const { container } = render(<PresetIcon icon="briefcase" />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders any lucide name beyond the curated set (incl. digits)", () => {
    // "activity" is outside PRESET_ICONS; "gamepad-2" exercises the kebab→Pascal
    // digit handling (Gamepad2).
    for (const name of ["activity", "gamepad-2"]) {
      const { container } = render(<PresetIcon icon={name} />);
      expect(container.querySelector("svg")).not.toBeNull();
      expect(container.textContent).toBe("");
    }
  });

  it("renders a data: URL as an image", () => {
    const url = "data:image/png;base64,AAAA";
    const { container } = render(<PresetIcon icon={url} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", url);
  });

  it("falls back to the default lucide icon for an empty icon", () => {
    const { container } = render(<PresetIcon icon="" />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("applies the color style when given", () => {
    const { container } = render(<PresetIcon icon="X" color="#ff0000" />);
    const wrap = container.querySelector(".preset-icon-wrap") as HTMLElement;
    expect(wrap.style.color).toBe("rgb(255, 0, 0)");
  });
});
