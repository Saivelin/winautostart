import { describe, it, expect, vi, afterEach } from "vitest";
import type { MonitorInfo } from "@/shared/api";
import type { Preset } from "./types";
import {
  generateId,
  isUntracked,
  newAppItem,
  newWebsiteItem,
  resolveMonitorIndex,
  upsertPreset,
  removePreset,
} from "./types";

describe("generateId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns lowercase alphanumeric ids", () => {
    const id = generateId();
    expect(id).toMatch(/^[a-z0-9]+$/);
  });

  it("composes base36 timestamp + 4 random base36 chars", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);
    const expected =
      (1_700_000_000_000).toString(36) + (0.123456789).toString(36).slice(2, 6);
    expect(generateId()).toBe(expected);
  });

  it("differs when the random part differs", () => {
    // Uniqueness relies on 4 random chars, so test it deterministically
    // instead of an N-call lottery (which flakes due to the birthday paradox)
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.1111)
      .mockReturnValueOnce(0.9999);
    expect(generateId()).not.toBe(generateId());
  });
});

describe("newAppItem", () => {
  it("creates an app item with defaults", () => {
    expect(newAppItem()).toEqual({
      type: "app",
      path: "",
      args: "",
      url: "",
      browser: "default",
      incognito: false,
      delayMs: 0,
      runAsAdmin: false,
      skipIfRunning: true,
    });
  });
});

describe("newWebsiteItem", () => {
  it("creates a website item with defaults", () => {
    expect(newWebsiteItem()).toEqual({
      type: "website",
      path: "",
      args: "",
      url: "",
      browser: "default",
      incognito: false,
      delayMs: 0,
      runAsAdmin: false,
      skipIfRunning: true,
    });
  });
});

describe("isUntracked", () => {
  it("flags elevated apps and default-browser websites", () => {
    expect(isUntracked({ ...newAppItem(), runAsAdmin: true })).toBe(true);
    expect(isUntracked(newWebsiteItem())).toBe(true); // browser: "default"
    expect(isUntracked({ ...newWebsiteItem(), browser: "" })).toBe(true);
  });

  it("does not flag plain apps and specific-browser websites", () => {
    expect(isUntracked(newAppItem())).toBe(false);
    expect(isUntracked({ ...newWebsiteItem(), browser: "google-chrome" })).toBe(false);
  });
});

describe("resolveMonitorIndex", () => {
  const monitors: MonitorInfo[] = [
    { index: 0, name: "\\\\.\\DISPLAY1", x: 0, y: 0, width: 1920, height: 1080, isPrimary: true },
    { index: 1, name: "\\\\.\\DISPLAY2", x: 1920, y: 0, width: 2560, height: 1440, isPrimary: false },
  ];

  it("returns null for unplaced items", () => {
    expect(resolveMonitorIndex(monitors, newAppItem())).toBeNull();
  });

  it("prefers the device name over a stale index", () => {
    const item = { ...newAppItem(), monitor: 0, monitorName: "\\\\.\\DISPLAY2" };
    expect(resolveMonitorIndex(monitors, item)).toBe(1);
  });

  it("falls back to the index when the name is unknown or missing", () => {
    expect(resolveMonitorIndex(monitors, { ...newAppItem(), monitor: 1, monitorName: "\\\\.\\GONE" })).toBe(1);
    expect(resolveMonitorIndex(monitors, { ...newAppItem(), monitor: 0 })).toBe(0);
  });

  it("returns null when both name and index miss", () => {
    expect(resolveMonitorIndex(monitors, { ...newAppItem(), monitor: 7, monitorName: "\\\\.\\GONE" })).toBeNull();
  });
});

describe("upsertPreset", () => {
  function makePreset(id: string, name: string): Preset {
    return { id, name, description: "", color: "#fff", icon: "X", apps: [] };
  }

  it("appends a preset with a new id", () => {
    const presets = [makePreset("a", "A")];
    const result = upsertPreset(presets, makePreset("b", "B"));
    expect(result.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("replaces the preset in place when the id already exists", () => {
    const presets = [makePreset("a", "A"), makePreset("b", "B")];
    const result = upsertPreset(presets, makePreset("a", "Renamed"));
    expect(result.map((p) => p.name)).toEqual(["Renamed", "B"]);
    expect(result).toHaveLength(2);
  });

  it("does not mutate the input array", () => {
    const presets = [makePreset("a", "A")];
    upsertPreset(presets, makePreset("b", "B"));
    expect(presets.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("removePreset", () => {
  function makePreset(id: string): Preset {
    return { id, name: id, description: "", color: "#fff", icon: "X", apps: [] };
  }

  it("removes the preset with the given id", () => {
    const presets = [makePreset("a"), makePreset("b"), makePreset("c")];
    expect(removePreset(presets, "b").map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("returns an equal-length copy when the id is absent", () => {
    const presets = [makePreset("a")];
    const result = removePreset(presets, "zzz");
    expect(result.map((p) => p.id)).toEqual(["a"]);
    expect(result).not.toBe(presets);
  });

  it("does not mutate the input array", () => {
    const presets = [makePreset("a"), makePreset("b")];
    removePreset(presets, "a");
    expect(presets.map((p) => p.id)).toEqual(["a", "b"]);
  });
});
