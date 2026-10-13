import { describe, it, expect } from "vitest";
import { captureHotkey, formatHotkey, keyFromCode, DEFAULT_HOTKEY } from "./hotkey";
import type { HotkeyEvent } from "./hotkey";

function keydown(code: string, mods: Partial<HotkeyEvent> = {}): HotkeyEvent {
  return { code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods };
}

describe("keyFromCode", () => {
  it("shortens letter and digit codes", () => {
    expect(keyFromCode("KeyW")).toBe("W");
    expect(keyFromCode("Digit5")).toBe("5");
  });

  it("keeps function and named keys as-is", () => {
    expect(keyFromCode("F12")).toBe("F12");
    expect(keyFromCode("ArrowUp")).toBe("ArrowUp");
    expect(keyFromCode("Space")).toBe("Space");
  });

  it("rejects keys the backend can't bind", () => {
    expect(keyFromCode("F13")).toBeNull();
    expect(keyFromCode("Backspace")).toBeNull();
    expect(keyFromCode("Backquote")).toBeNull();
  });
});

describe("captureHotkey", () => {
  it("builds the stored combo with modifiers in a fixed order", () => {
    expect(captureHotkey(keydown("KeyW", { ctrlKey: true, altKey: true }))).toEqual({
      hotkey: DEFAULT_HOTKEY,
    });
    expect(
      captureHotkey(keydown("KeyK", { shiftKey: true, altKey: true, ctrlKey: true }))
    ).toEqual({ hotkey: "Ctrl+Alt+Shift+K" });
  });

  it("waits while only modifiers are held", () => {
    expect(captureHotkey(keydown("ControlLeft", { ctrlKey: true }))).toBeNull();
    expect(captureHotkey(keydown("AltRight", { altKey: true }))).toBeNull();
    expect(captureHotkey(keydown("ShiftLeft", { shiftKey: true }))).toBeNull();
  });

  it("requires Ctrl or Alt so plain typing stays usable", () => {
    expect(captureHotkey(keydown("KeyW"))).toEqual({
      error: "A global hotkey needs Ctrl or Alt",
    });
    expect(captureHotkey(keydown("KeyW", { shiftKey: true }))).toEqual({
      error: "A global hotkey needs Ctrl or Alt",
    });
  });

  it("rejects the Win key and unsupported keys with a reason", () => {
    expect(captureHotkey(keydown("KeyW", { ctrlKey: true, metaKey: true }))).toEqual({
      error: "Combos with the Win key aren't supported",
    });
    expect(captureHotkey(keydown("Backspace", { ctrlKey: true }))).toEqual({
      error: "That key can't be used in a global hotkey",
    });
  });
});

describe("formatHotkey", () => {
  it("spaces out the combo for display", () => {
    expect(formatHotkey("Ctrl+Alt+W")).toBe("Ctrl + Alt + W");
    expect(formatHotkey("Ctrl+ArrowUp")).toBe("Ctrl + ArrowUp");
  });
});
