//! Installed-browser detection via the registry and per-browser
//! private-mode flags.

use serde::Serialize;
use winreg::enums::*;
use winreg::RegKey;

#[derive(Debug, Clone, Serialize)]
pub struct BrowserInfo {
    pub id: String,
    pub name: String,
    pub path: String,
}

/// Enumerates browsers registered under `SOFTWARE\Clients\StartMenuInternet`
/// (HKLM, then HKCU). The id is the registry key name lowercased with spaces
/// replaced by dashes (e.g. `google-chrome`); entries whose executable no
/// longer exists are dropped.
#[tauri::command]
pub fn detect_browsers() -> Vec<BrowserInfo> {
    let mut browsers = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    let roots = [
        RegKey::predef(HKEY_LOCAL_MACHINE),
        RegKey::predef(HKEY_CURRENT_USER),
    ];

    for root in &roots {
        let Ok(clients) = root.open_subkey(r"SOFTWARE\Clients\StartMenuInternet") else {
            continue;
        };

        for name in clients.enum_keys().filter_map(|k| k.ok()) {
            let cmd_path = format!(r"{}\shell\open\command", name);
            let Ok(cmd_key) = clients.open_subkey(&cmd_path) else {
                continue;
            };
            let Ok(raw_path): Result<String, _> = cmd_key.get_value("") else {
                continue;
            };
            let exe_path = raw_path.trim_matches('"').to_string();
            if !std::path::Path::new(&exe_path).exists() {
                continue;
            }

            let display_name = clients
                .open_subkey(&name)
                .ok()
                .and_then(|k| k.get_value::<String, _>("").ok())
                .unwrap_or_else(|| name.clone());

            let id = name.to_lowercase().replace(' ', "-");
            if seen_ids.insert(id.clone()) {
                browsers.push(BrowserInfo {
                    id,
                    name: display_name,
                    path: exe_path,
                });
            }
        }
    }

    browsers
}

/// Private-mode CLI flag for a browser, guessed from its executable path.
/// Unknown browsers get no flag (the URL still opens, just not private).
pub(super) fn incognito_flag(exe_path: &str) -> &str {
    let lower = exe_path.to_lowercase();
    if lower.contains("chrome") {
        "--incognito"
    } else if lower.contains("firefox") {
        "--private-window"
    } else if lower.contains("msedge") || lower.contains("edge") {
        "--inprivate"
    } else {
        ""
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incognito_flags_per_browser() {
        assert_eq!(incognito_flag(r"C:\x\chrome.exe"), "--incognito");
        assert_eq!(incognito_flag(r"C:\x\firefox.exe"), "--private-window");
        assert_eq!(incognito_flag(r"C:\x\msedge.exe"), "--inprivate");
        assert_eq!(incognito_flag(r"C:\x\opera.exe"), "");
    }

    // Integration: live Windows registry
    #[test]
    #[ignore = "integration: reads installed browsers from the live registry"]
    fn detect_browsers_unique_ids_and_existing_paths() {
        let browsers = detect_browsers();
        let mut ids = std::collections::HashSet::new();
        for b in &browsers {
            assert!(ids.insert(b.id.clone()), "duplicate browser id: {}", b.id);
            assert!(std::path::Path::new(&b.path).exists(), "missing path: {}", b.path);
            assert!(!b.name.is_empty());
        }
    }
}
