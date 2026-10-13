/**
 * System-level backend DTOs: the wire shapes for the environment-facing Tauri
 * commands and events (browsers, monitors, installed apps, launch progress).
 * The preset domain shapes (Config, Preset, LaunchItem) live with the preset
 * entity — see entities/preset/model/types.ts. Field names are the camelCase
 * JSON format used on the wire.
 */

/** Installed browser as reported by the detect_browsers Tauri command. */
export interface BrowserInfo {
  id: string;
  name: string;
  path: string;
}

/**
 * Monitor geometry as reported by the get_monitors Tauri command.
 * Virtual-screen coordinates: primary starts at (0,0), others can be negative.
 */
export interface MonitorInfo {
  index: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isPrimary: boolean;
}

/** Per-item launch status streamed by the backend as `launch-progress` events. */
export interface LaunchProgress {
  index: number;
  total: number;
  label: string;
  status: "launching" | "ok" | "failed" | "skipped";
  error?: string;
}

/** Installed application as reported by the get_start_menu_apps Tauri command. */
export interface InstalledApp {
  name: string;
  path: string;
  icon?: string;
}
