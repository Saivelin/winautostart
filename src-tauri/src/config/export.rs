//! Preset import/export as standalone JSON files, wrapped in a versioned
//! envelope (`{"version": 1, "presets": [...]}`) so the format can evolve.
//! Id collisions on import are resolved by the frontend, not here.

use crate::config::Preset;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportData {
    pub version: u32,
    pub presets: Vec<Preset>,
}

#[tauri::command]
pub fn export_presets(path: String, presets: Vec<Preset>) -> Result<(), String> {
    let data = ExportData { version: 1, presets };
    let json =
        serde_json::to_string_pretty(&data).map_err(|e| format!("Serialize error: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("Write error: {e}"))
}

#[tauri::command]
pub fn import_presets(path: String) -> Result<Vec<Preset>, String> {
    let data = fs::read_to_string(&path).map_err(|e| format!("Read error: {e}"))?;
    let export: ExportData =
        serde_json::from_str(&data).map_err(|e| format!("Parse error: {e}"))?;
    Ok(export.presets)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{LaunchItem, Preset};

    /// Temp file path, removed on Drop so it doesn't leak even if the test panics
    struct TempPath(String);

    impl Drop for TempPath {
        fn drop(&mut self) {
            std::fs::remove_file(&self.0).ok();
        }
    }

    fn temp_path(name: &str) -> TempPath {
        TempPath(
            std::env::temp_dir()
                .join(format!("winautostart-export-test-{}-{name}", std::process::id()))
                .to_string_lossy()
                .into_owned(),
        )
    }

    fn sample_preset() -> Preset {
        Preset {
            id: "p1".into(),
            name: "Работа".into(),
            description: "тест".into(),
            color: "#123456".into(),
            icon: "⚡".into(),
            apps: vec![LaunchItem {
                item_type: "website".into(),
                path: "".into(),
                args: "".into(),
                url: "https://example.com".into(),
                browser: "chrome".into(),
                incognito: true,
                delay_ms: 250,
                run_as_admin: false,
                skip_if_running: true,
                monitor: Some(0),
                monitor_name: None,
                pos_x: Some(10),
                pos_y: Some(20),
                pos_width: Some(640),
                pos_height: Some(480),
            }],
        }
    }

    #[test]
    fn export_import_roundtrip() {
        let path = temp_path("roundtrip.json");
        export_presets(path.0.clone(), vec![sample_preset()]).unwrap();

        let imported = import_presets(path.0.clone()).unwrap();
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].name, "Работа");
        assert_eq!(imported[0].apps[0].url, "https://example.com");
        assert_eq!(imported[0].apps[0].delay_ms, 250);
        assert_eq!(imported[0].apps[0].pos_width, Some(640));
    }

    #[test]
    fn export_writes_version() {
        let path = temp_path("version.json");
        export_presets(path.0.clone(), vec![]).unwrap();
        let raw = std::fs::read_to_string(&path.0).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["version"], 1);
        assert!(parsed["presets"].is_array());
    }

    #[test]
    fn import_missing_file_errors() {
        let path = temp_path("no-such-file.json");
        let err = import_presets(path.0.clone()).unwrap_err();
        assert!(err.starts_with("Read error:"));
    }

    #[test]
    fn import_invalid_json_errors() {
        let path = temp_path("garbage.json");
        std::fs::write(&path.0, "{ this is not json").unwrap();
        let err = import_presets(path.0.clone()).unwrap_err();
        assert!(err.starts_with("Parse error:"));
    }

    #[test]
    fn import_plain_preset_array_rejected() {
        // Contract: import expects a {version, presets} wrapper, a bare array is an error
        let path = temp_path("plain-array.json");
        std::fs::write(&path.0, "[]").unwrap();
        assert!(import_presets(path.0.clone()).is_err());
    }

    #[test]
    fn export_to_invalid_path_errors() {
        let err = export_presets(r"Z:\no\such\dir\out.json".into(), vec![]).unwrap_err();
        assert!(err.starts_with("Write error:"));
    }
}
