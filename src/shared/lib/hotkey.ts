/**
 * Global-hotkey combo format shared by the picker UI and the backend parser
 * (see src-tauri/src/hotkey.rs). A combo is stored as `"Ctrl+Alt+W"`:
 * modifiers first in a fixed order, then one key token.
 */

export const DEFAULT_HOTKEY = "Ctrl+Alt+W";

/** Non-alphanumeric keys the picker accepts, by `KeyboardEvent.code`. */
const NAMED_KEYS = [
  "Space",
  "Enter",
  "Insert",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
];

/** Just a modifier held down — the capture keeps waiting for the real key. */
function isModifierCode(code: string): boolean {
  return /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(code);
}

/** `KeyboardEvent.code` → key token, or null when the key can't be bound. */
export function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return NAMED_KEYS.includes(code) ? code : null;
}

/** Combo as typed by a human: `"Ctrl+Alt+W"` → `"Ctrl + Alt + W"`. */
export function formatHotkey(hotkey: string): string {
  return hotkey.split("+").join(" + ");
}

/** Modifier flags and key code of a keydown — the part capture cares about. */
export type HotkeyEvent = Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

/** Captured combo, a reason it was rejected, or null while modifiers are held. */
export type HotkeyCapture = { hotkey: string } | { error: string } | null;

/**
 * Turns a keydown into a storable combo. Ctrl or Alt is required — a bare or
 * Shift-only combination would swallow normal typing system-wide — and the Win
 * key is out because Windows reserves most of its combinations.
 */
export function captureHotkey(event: HotkeyEvent): HotkeyCapture {
  if (isModifierCode(event.code)) return null;

  const key = keyFromCode(event.code);
  if (!key) return { error: "That key can't be used in a global hotkey" };
  if (event.metaKey) return { error: "Combos with the Win key aren't supported" };
  if (!event.ctrlKey && !event.altKey) return { error: "A global hotkey needs Ctrl or Alt" };

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return { hotkey: parts.join("+") };
}
