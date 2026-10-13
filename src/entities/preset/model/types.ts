/**
 * Preset domain model. Config, Preset and LaunchItem are the source of truth
 * for the persisted config.json shapes and live with the entity; the monitor
 * geometry (MonitorInfo) is a system DTO imported from shared/api.
 */
import type { MonitorInfo } from "@/shared/api";

/** One launchable entry of a preset: an app or a website. */
export interface LaunchItem {
  type: "app" | "website";
  // App fields
  path: string;
  args: string;
  // Website fields
  url: string;
  browser: string;
  incognito: boolean;
  // Common
  delayMs: number;
  runAsAdmin: boolean;
  /** When off, the item launches even if the same app is already running. */
  skipIfRunning: boolean;
  // Positioning
  monitor?: number | null;
  /** Device name of the target monitor — preferred over the index when
   * resolving, so placement survives monitor plug/unplug reshuffles. */
  monitorName?: string | null;
  posX?: number | null;
  posY?: number | null;
  posWidth?: number | null;
  posHeight?: number | null;
}

/** Named group of launch items with display accents (color, emoji/data:-URL icon). */
export interface Preset {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  apps: LaunchItem[];
}

/** Root of config.json; persisted via the save_config Tauri command. */
export interface Config {
  defaultPreset: string;
  timeoutSeconds: number;
  autoStartAsked: boolean;
  closePreviousApps: boolean;
  /** Global show/focus combo, e.g. `"Ctrl+Alt+W"` — see shared/lib/hotkey. */
  hotkey: string;
  hotkeyEnabled: boolean;
  presets: Preset[];
}

/** Muted accent palette — deliberately narrow, one row of business tones. */
export const PRESET_COLORS = [
  "#8b919c", "#4d7fd0", "#3d8f83",
  "#a8894a", "#a05656", "#7862a8",
];

/**
 * Curated default icon set shown in the picker before searching — lucide
 * kebab-case names. The picker's search covers the full lucide catalog, and any
 * lucide name saves/renders (see PresetIcon). Legacy configs may still hold an
 * emoji or a data:-URL — both keep working.
 */
export const PRESET_ICONS = [
  "monitor", "briefcase", "terminal", "code-xml",
  "globe", "mail", "message-square", "folder",
  "wrench", "zap", "rocket", "gamepad-2",
  "music", "camera", "film", "book-open",
  "chart-column", "lock", "coffee", "house",
];

/**
 * True when launching this item can't capture a PID — elevated apps and
 * default-browser URLs — so Switch & Close/Minimize and window positioning
 * won't affect it.
 */
export function isUntracked(item: LaunchItem): boolean {
  if (item.type === "website") return !item.browser || item.browser === "default";
  return item.runAsAdmin;
}

/**
 * Monitor index for an item's placement: by stored device name first
 * (survives index reshuffles), then by the stored index; null when the item
 * is unplaced or points at a monitor that no longer exists.
 */
export function resolveMonitorIndex(monitors: MonitorInfo[], item: LaunchItem): number | null {
  if (item.monitor == null) return null;
  if (item.monitorName) {
    const byName = monitors.findIndex((m) => m.name === item.monitorName);
    if (byName >= 0) return byName;
  }
  return item.monitor < monitors.length ? item.monitor : null;
}

/** Compact unique-enough id: base36 timestamp + 4 random base36 chars. */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function newLaunchItem(type: LaunchItem["type"]): LaunchItem {
  return {
    type, path: "", args: "", url: "", browser: "default",
    incognito: false, delayMs: 0, runAsAdmin: false, skipIfRunning: true,
  };
}

export function newAppItem(): LaunchItem {
  return newLaunchItem("app");
}

export function newWebsiteItem(): LaunchItem {
  return newLaunchItem("website");
}

/**
 * Insert or replace a preset by id: an existing id is overwritten in place,
 * a new id is appended. Returns a new array (no mutation).
 */
export function upsertPreset(presets: Preset[], preset: Preset): Preset[] {
  return presets.some((p) => p.id === preset.id)
    ? presets.map((p) => (p.id === preset.id ? preset : p))
    : [...presets, preset];
}

/** Remove the preset with the given id. Returns a new array (no mutation). */
export function removePreset(presets: Preset[], id: string): Preset[] {
  return presets.filter((p) => p.id !== id);
}
