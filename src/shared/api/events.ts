import { listen } from "@tauri-apps/api/event";
import type { LaunchProgress } from "./types";

/**
 * Typed wrappers over the Tauri event bus. Each returns the unlisten promise
 * from `listen`, so callers keep the same `.then((off) => off())` cleanup they
 * would use with the raw API — only the event name and payload type are fixed
 * here, and the payload is unwrapped for the handler.
 */

export const onLaunchProgress = (handler: (progress: LaunchProgress) => void) =>
  listen<LaunchProgress>("launch-progress", (event) => handler(event.payload));
