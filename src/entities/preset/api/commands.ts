import { invoke } from "@tauri-apps/api/core";
import type { Config, Preset } from "../model/types";

/**
 * Preset-domain Tauri commands: loading and persisting the config, importing
 * and exporting presets, launching a preset and the switch pre-actions that
 * close/minimize the previously launched apps. Generics mirror the Rust return
 * types (a `Result<T, String>` resolves to `T` and rejects with the message).
 */

export const loadConfig = () =>
  invoke<{ config: Config; recovered: boolean }>("load_config");

export const saveConfig = (config: Config) => invoke<void>("save_config", { config });

export const exportPresets = (path: string, presets: Preset[]) =>
  invoke<void>("export_presets", { path, presets });

export const importPresets = (path: string) => invoke<Preset[]>("import_presets", { path });

export const launchPreset = (id: string) => invoke<string[]>("launch_preset", { id });

export const closePreviousApps = () => invoke<number>("close_previous_apps");

export const minimizePreviousApps = () => invoke<number>("minimize_previous_apps");
