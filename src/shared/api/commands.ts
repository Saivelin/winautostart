import { invoke } from "@tauri-apps/api/core";
import type { BrowserInfo, InstalledApp, MonitorInfo } from "./types";

/**
 * Typed wrappers over the Tauri `invoke` bridge for the system-level commands
 * (autostart registry, tray, and the environment probes). Preset-domain
 * commands live with the preset entity — see entities/preset/api. Generics
 * mirror the Rust command return types (a `Result<T, String>` on the Rust side
 * resolves to `T` and rejects with the error string).
 */

export const rebuildTray = () => invoke<void>("rebuild_tray");

/** Re-registers the global hotkey from the saved config; rejects with the
 * reason when the combo is invalid or already taken by another app. */
export const refreshHotkey = () => invoke<void>("refresh_hotkey");

/** Opens %APPDATA%\\WinAutoStart\\log.txt in the system text editor. */
export const openLog = () => invoke<void>("open_log");

export const installAutostart = () => invoke<string>("install_autostart");

export const uninstallAutostart = () => invoke<void>("uninstall_autostart");

export const isAutostartInstalled = () => invoke<boolean>("is_autostart_installed");

export const detectBrowsers = () => invoke<BrowserInfo[]>("detect_browsers");

export const getMonitors = () => invoke<MonitorInfo[]>("get_monitors");

export const getStartMenuApps = () => invoke<InstalledApp[]>("get_start_menu_apps");

export const getAppIcon = (path: string) => invoke<string | null>("get_app_icon", { path });
