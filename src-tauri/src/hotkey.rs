//! Global show/focus hotkey: parses the textual combo stored in the config
//! (`"Ctrl+Alt+W"`) and (re)registers it with the OS.
//!
//! The combo is user-configurable and can be turned off entirely, because a
//! global registration takes the combination system-wide — the previous
//! hard-coded `Ctrl+Shift+W` swallowed "close window" in every major browser
//! with no way to opt out from the browser side.

use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Shipped default. `Ctrl+Alt` is deliberate: `Ctrl+Shift+<letter>` collides
/// with browser shortcuts, plain `Shift+<letter>` would eat normal typing.
pub const DEFAULT_HOTKEY: &str = "Ctrl+Alt+W";

const LETTER_CODES: [Code; 26] = [
    Code::KeyA, Code::KeyB, Code::KeyC, Code::KeyD, Code::KeyE, Code::KeyF, Code::KeyG,
    Code::KeyH, Code::KeyI, Code::KeyJ, Code::KeyK, Code::KeyL, Code::KeyM, Code::KeyN,
    Code::KeyO, Code::KeyP, Code::KeyQ, Code::KeyR, Code::KeyS, Code::KeyT, Code::KeyU,
    Code::KeyV, Code::KeyW, Code::KeyX, Code::KeyY, Code::KeyZ,
];

const DIGIT_CODES: [Code; 10] = [
    Code::Digit0, Code::Digit1, Code::Digit2, Code::Digit3, Code::Digit4,
    Code::Digit5, Code::Digit6, Code::Digit7, Code::Digit8, Code::Digit9,
];

const FUNCTION_CODES: [Code; 12] = [
    Code::F1, Code::F2, Code::F3, Code::F4, Code::F5, Code::F6,
    Code::F7, Code::F8, Code::F9, Code::F10, Code::F11, Code::F12,
];

/// Non-alphanumeric keys the picker accepts, keyed by their uppercased
/// `KeyboardEvent.code` — the same spelling the frontend stores.
const NAMED_CODES: &[(&str, Code)] = &[
    ("SPACE", Code::Space),
    ("ENTER", Code::Enter),
    ("INSERT", Code::Insert),
    ("DELETE", Code::Delete),
    ("HOME", Code::Home),
    ("END", Code::End),
    ("PAGEUP", Code::PageUp),
    ("PAGEDOWN", Code::PageDown),
    ("ARROWUP", Code::ArrowUp),
    ("ARROWDOWN", Code::ArrowDown),
    ("ARROWLEFT", Code::ArrowLeft),
    ("ARROWRIGHT", Code::ArrowRight),
];

/// Key token → key code. Accepts both the short spelling the config uses
/// (`W`, `5`) and the raw `KeyboardEvent.code` (`KeyW`, `Digit5`), so a
/// hand-edited config keeps working either way.
fn parse_code(token: &str) -> Option<Code> {
    let upper = token.to_ascii_uppercase();
    let bare = upper
        .strip_prefix("KEY")
        .or_else(|| upper.strip_prefix("DIGIT"))
        .unwrap_or(upper.as_str());

    if bare.len() == 1 {
        let ch = bare.as_bytes()[0];
        if ch.is_ascii_uppercase() {
            return Some(LETTER_CODES[(ch - b'A') as usize]);
        }
        if ch.is_ascii_digit() {
            return Some(DIGIT_CODES[(ch - b'0') as usize]);
        }
    }

    if let Some(number) = bare.strip_prefix('F') {
        if let Ok(n) = number.parse::<usize>() {
            if (1..=FUNCTION_CODES.len()).contains(&n) {
                return Some(FUNCTION_CODES[n - 1]);
            }
        }
    }

    NAMED_CODES
        .iter()
        .find(|(name, _)| *name == bare)
        .map(|(_, code)| *code)
}

/// Parses a `"Ctrl+Alt+W"`-style combo. Ctrl or Alt is mandatory: without one
/// of them the registration would swallow plain typing for the whole system.
pub fn parse_shortcut(spec: &str) -> Result<Shortcut, String> {
    let mut modifiers = Modifiers::empty();
    let mut code: Option<Code> = None;

    for token in spec.split('+') {
        let token = token.trim();
        if token.is_empty() {
            return Err(format!("Invalid hotkey \"{spec}\": empty part"));
        }
        match token.to_ascii_uppercase().as_str() {
            "CTRL" | "CONTROL" => modifiers |= Modifiers::CONTROL,
            "ALT" => modifiers |= Modifiers::ALT,
            "SHIFT" => modifiers |= Modifiers::SHIFT,
            _ => {
                if code.is_some() {
                    return Err(format!("Invalid hotkey \"{spec}\": more than one key"));
                }
                code = Some(parse_code(token).ok_or_else(|| {
                    format!("Invalid hotkey \"{spec}\": unsupported key \"{token}\"")
                })?);
            }
        }
    }

    let code = code.ok_or_else(|| format!("Invalid hotkey \"{spec}\": no key"))?;
    if !modifiers.intersects(Modifiers::CONTROL | Modifiers::ALT) {
        return Err(format!("Invalid hotkey \"{spec}\": needs Ctrl or Alt"));
    }
    Ok(Shortcut::new(Some(modifiers), code))
}

/// Drops whatever was registered before and registers `spec` unless the user
/// switched the hotkey off. Called on startup and again whenever the config is
/// saved, so a changed combo takes effect without a restart.
pub fn apply(app: &tauri::AppHandle, spec: &str, enabled: bool) -> Result<(), String> {
    let manager = app.global_shortcut();
    manager
        .unregister_all()
        .map_err(|e| format!("Failed to release the previous hotkey: {e}"))?;
    if !enabled {
        return Ok(());
    }

    let shortcut = parse_shortcut(spec)?;
    let handle = app.clone();
    manager
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                crate::show_main_window(&handle);
            }
        })
        .map_err(|e| format!("Failed to register hotkey \"{spec}\": {e} — it may be taken by another app"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_hotkey() {
        let parsed = parse_shortcut(DEFAULT_HOTKEY).unwrap();
        let expected = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyW);
        assert_eq!(parsed.mods, expected.mods);
        assert_eq!(parsed.key, expected.key);
    }

    #[test]
    fn accepts_raw_event_codes_and_is_case_insensitive() {
        let short = parse_shortcut("Ctrl+Alt+W").unwrap();
        let raw = parse_shortcut("control+ALT+KeyW").unwrap();
        assert_eq!(short.mods, raw.mods);
        assert_eq!(short.key, raw.key);
    }

    #[test]
    fn parses_digits_function_and_named_keys() {
        assert_eq!(parse_shortcut("Ctrl+5").unwrap().key, Code::Digit5);
        assert_eq!(parse_shortcut("Ctrl+Digit5").unwrap().key, Code::Digit5);
        assert_eq!(parse_shortcut("Alt+F12").unwrap().key, Code::F12);
        assert_eq!(parse_shortcut("Ctrl+Shift+ArrowUp").unwrap().key, Code::ArrowUp);
        assert_eq!(parse_shortcut("Ctrl+Space").unwrap().key, Code::Space);
    }

    #[test]
    fn modifiers_accumulate_regardless_of_order() {
        let a = parse_shortcut("Ctrl+Alt+Shift+K").unwrap();
        let b = parse_shortcut("Shift+Alt+Ctrl+K").unwrap();
        assert_eq!(a.mods, b.mods);
        assert!(a.mods.contains(Modifiers::CONTROL));
        assert!(a.mods.contains(Modifiers::ALT));
        assert!(a.mods.contains(Modifiers::SHIFT));
    }

    #[test]
    fn rejects_combos_without_ctrl_or_alt() {
        // A global Shift+W would swallow normal typing of a capital W
        assert!(parse_shortcut("Shift+W").unwrap_err().contains("needs Ctrl or Alt"));
        assert!(parse_shortcut("W").unwrap_err().contains("needs Ctrl or Alt"));
    }

    #[test]
    fn rejects_malformed_specs() {
        assert!(parse_shortcut("Ctrl+Alt").unwrap_err().contains("no key"));
        assert!(parse_shortcut("Ctrl+A+B").unwrap_err().contains("more than one key"));
        assert!(parse_shortcut("Ctrl++W").unwrap_err().contains("empty part"));
        assert!(parse_shortcut("Ctrl+Backspace").unwrap_err().contains("unsupported key"));
        assert!(parse_shortcut("Ctrl+F13").unwrap_err().contains("unsupported key"));
        assert!(parse_shortcut("").unwrap_err().contains("empty part"));
    }

    #[test]
    fn win_key_is_not_a_modifier() {
        // "Win" is not a modifier for us: it must fail as an unknown key
        // instead of silently registering something else
        assert!(parse_shortcut("Win+Alt+W").unwrap_err().contains("unsupported key"));
    }
}
