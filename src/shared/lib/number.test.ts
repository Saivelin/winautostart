import { describe, it, expect } from "vitest";
import { parseBoundedInt } from "./number";

describe("parseBoundedInt", () => {
  it("keeps values inside the range", () => {
    expect(parseBoundedInt("45", 0, 300)).toBe(45);
    expect(parseBoundedInt("0", 0, 300)).toBe(0);
    expect(parseBoundedInt("300", 0, 300)).toBe(300);
  });

  it("clamps a typed negative value instead of passing it to the backend", () => {
    // Exactly the case that made save_config reject on u32
    expect(parseBoundedInt("-1", 0, 300)).toBe(0);
    expect(parseBoundedInt("-9999", 0, 600_000)).toBe(0);
  });

  it("clamps values above the maximum", () => {
    expect(parseBoundedInt("5000", 0, 300)).toBe(300);
  });

  it("falls back to the minimum for junk and empty input", () => {
    expect(parseBoundedInt("", 0, 300)).toBe(0);
    expect(parseBoundedInt("abc", 0, 300)).toBe(0);
    expect(parseBoundedInt("1e999", 0, 300)).toBe(300);
  });

  it("truncates fractions", () => {
    expect(parseBoundedInt("12.7", 0, 300)).toBe(12);
  });
});
