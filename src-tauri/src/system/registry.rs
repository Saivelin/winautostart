//! Windows autostart registration via the per-user
//! `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` key — no admin rights
//! needed. The stored command is the quoted path of the current executable.

use winreg::enums::*;
use winreg::RegKey;

const VALUE_NAME: &str = "WinAutoStart";
const RUN_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";

fn install_value(value_name: &str) -> Result<String, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("Cannot get exe path: {e}"))?;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(RUN_KEY)
        .map_err(|e| format!("Cannot open registry key: {e}"))?;

    let value = format!("\"{}\"", exe.display());
    key.set_value(value_name, &value)
        .map_err(|e| format!("Cannot set value: {e}"))?;

    Ok(value)
}

fn uninstall_value(value_name: &str) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
        .map_err(|e| format!("Cannot open registry key: {e}"))?;

    key.delete_value(value_name)
        .map_err(|e| format!("Cannot delete value: {e}"))?;

    Ok(())
}

fn is_value_installed(value_name: &str) -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey(RUN_KEY)
        .map_err(|e| format!("Cannot open registry key: {e}"))?;

    Ok(key.get_value::<String, _>(value_name).is_ok())
}

#[tauri::command]
pub fn install_autostart() -> Result<String, String> {
    install_value(VALUE_NAME)
}

#[tauri::command]
pub fn uninstall_autostart() -> Result<(), String> {
    uninstall_value(VALUE_NAME)
}

#[tauri::command]
pub fn is_autostart_installed() -> Result<bool, String> {
    is_value_installed(VALUE_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The test name is unique per process and removed at the end;
    /// the real "WinAutoStart" value is never touched.
    /// Tests write to the real HKCU\...\Run: the Drop guard cleans up even on panic,
    /// but a hard kill of the process may leave the WinAutoStartTest{pid} value behind;
    /// it is harmless and can be removed manually from the registry.
    fn test_value_name() -> String {
        format!("WinAutoStartTest{}", std::process::id())
    }

    struct Cleanup(String);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = uninstall_value(&self.0);
        }
    }

    #[test]
    #[ignore = "integration: writes to the real HKCU Run key"]
    fn install_check_uninstall_cycle() {
        let name = test_value_name();
        let _guard = Cleanup(name.clone());

        assert_eq!(is_value_installed(&name), Ok(false));

        let value = install_value(&name).unwrap();
        // Exe path is quoted
        assert!(value.starts_with('"') && value.ends_with('"'));
        assert!(value.to_lowercase().contains(".exe"));

        assert_eq!(is_value_installed(&name), Ok(true));

        uninstall_value(&name).unwrap();
        assert_eq!(is_value_installed(&name), Ok(false));
    }

    #[test]
    #[ignore = "integration: writes to the real HKCU Run key"]
    fn install_is_idempotent() {
        let name = test_value_name() + "-idem";
        let _guard = Cleanup(name.clone());

        let v1 = install_value(&name).unwrap();
        let v2 = install_value(&name).unwrap();
        assert_eq!(v1, v2);
        assert_eq!(is_value_installed(&name), Ok(true));
    }

    #[test]
    #[ignore = "integration: reads the real HKCU Run key"]
    fn uninstall_missing_value_errors() {
        let err = uninstall_value("WinAutoStartNeverExisted12345").unwrap_err();
        assert!(err.starts_with("Cannot delete value:"));
    }
}
