//! Config model and persistence. The JSON file lives in
//! `%APPDATA%\WinAutoStart\config.json` (a legacy copy next to the exe is
//! migrated on first load) and uses camelCase keys — the same shape the
//! frontend works with.

pub mod export;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

fn default_item_type() -> String {
    "app".into()
}

fn default_hotkey() -> String {
    crate::hotkey::DEFAULT_HOTKEY.into()
}

fn default_true() -> bool {
    true
}

/// One launchable entry of a preset: an app (`path`/`args`/`runAsAdmin`) or a
/// website (`url`/`browser`/`incognito`), plus common `delayMs` and optional
/// window placement (all five placement fields must be set to take effect).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchItem {
    #[serde(rename = "type", default = "default_item_type")]
    pub item_type: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub args: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub browser: String,
    #[serde(default)]
    pub incognito: bool,
    pub delay_ms: u64,
    #[serde(default)]
    pub run_as_admin: bool,
    /// Whether an already-running copy of this app suppresses the launch.
    /// Off means "launch a second window even if it is already open".
    #[serde(default = "default_true")]
    pub skip_if_running: bool,
    #[serde(default)]
    pub monitor: Option<u32>,
    /// Device name of the target monitor (e.g. `\\.\DISPLAY2`). Preferred
    /// over `monitor` when resolving, so placement survives index reshuffles
    /// after monitors are plugged/unplugged.
    #[serde(default)]
    pub monitor_name: Option<String>,
    #[serde(default)]
    pub pos_x: Option<i32>,
    #[serde(default)]
    pub pos_y: Option<i32>,
    #[serde(default)]
    pub pos_width: Option<u32>,
    #[serde(default)]
    pub pos_height: Option<u32>,
}

/// Named group of launch items with display accents. `icon` is a lucide icon
/// name (e.g. `"monitor"`); legacy configs may hold an emoji or a `data:`-URL
/// image — the frontend renders all three.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub icon: String,
    pub apps: Vec<LaunchItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub default_preset: String,
    pub timeout_seconds: u32,
    pub auto_start_asked: bool,
    #[serde(default)]
    pub close_previous_apps: bool,
    /// Global show/focus combo, e.g. `"Ctrl+Alt+W"` — see hotkey::parse_shortcut.
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    #[serde(default = "default_true")]
    pub hotkey_enabled: bool,
    pub presets: Vec<Preset>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            default_preset: String::new(),
            timeout_seconds: 30,
            auto_start_asked: false,
            close_previous_apps: false,
            hotkey: default_hotkey(),
            hotkey_enabled: true,
            presets: vec![Preset {
                id: "default".into(),
                name: "Default".into(),
                description: "Edit this preset or create new ones".into(),
                color: "#4d7fd0".into(),
                icon: "monitor".into(),
                apps: vec![],
            }],
        }
    }
}

/// `%APPDATA%\WinAutoStart\config.json`, creating the directory on the way.
pub fn config_path() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    let dir = PathBuf::from(appdata).join("WinAutoStart");
    let _ = fs::create_dir_all(&dir);
    dir.join("config.json")
}

fn legacy_config_path() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    exe.parent()
        .unwrap_or(std::path::Path::new("."))
        .join("config.json")
}

/// Answer of the `load_config` command: the config plus whether it had to be
/// recovered from a corrupt file (the original is backed up next to it as
/// `config.json.corrupt`) so the frontend can tell the user.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedConfig {
    pub config: Config,
    pub recovered: bool,
}

/// Loads the config, migrating a legacy `config.json` from the exe directory
/// or writing defaults when nothing exists yet. A file that fails to parse is
/// backed up and replaced with defaults (`recovered: true`) — a corrupt
/// config must never brick the app.
pub fn load_config_recovering() -> Result<(Config, bool), String> {
    let path = config_path();
    if !path.exists() {
        // Migrate from legacy location (next to exe) if it exists
        let legacy = legacy_config_path();
        if legacy.exists() {
            let _ = fs::copy(&legacy, &path);
        } else {
            let cfg = Config::default();
            save_config_to_file(&cfg)?;
            return Ok((cfg, false));
        }
    }
    load_recovering_from(&path)
}

fn load_recovering_from(path: &Path) -> Result<(Config, bool), String> {
    let data = fs::read_to_string(path).map_err(|e| format!("Read error: {e}"))?;
    match serde_json::from_str(&data) {
        Ok(cfg) => Ok((cfg, false)),
        Err(e) => {
            crate::applog!("[config] Corrupt config ({e}) — backing up and resetting to defaults");
            if let Err(copy_err) = fs::copy(path, path.with_extension("json.corrupt")) {
                crate::applog!("[config] Failed to back up corrupt config: {copy_err}");
            }
            let cfg = Config::default();
            save_config_to(path, &cfg)?;
            Ok((cfg, true))
        }
    }
}

pub fn load_config_from_file() -> Result<Config, String> {
    load_config_recovering().map(|(cfg, _)| cfg)
}

/// Atomic save: writes to a temp file, then renames over the target
/// (`MoveFileEx` semantics), so a crash mid-write can't corrupt the config.
fn save_config_to(path: &Path, cfg: &Config) -> Result<(), String> {
    let data = serde_json::to_string_pretty(cfg).map_err(|e| format!("Serialize error: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data).map_err(|e| format!("Write error: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp); // don't leave an orphaned .tmp
        format!("Rename error: {e}")
    })
}

pub fn save_config_to_file(cfg: &Config) -> Result<(), String> {
    save_config_to(&config_path(), cfg)
}

#[tauri::command]
pub fn load_config() -> Result<LoadedConfig, String> {
    load_config_recovering().map(|(config, recovered)| LoadedConfig { config, recovered })
}

#[tauri::command]
pub fn save_config(config: Config) -> Result<(), String> {
    save_config_to_file(&config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_one_preset() {
        let cfg = Config::default();
        assert_eq!(cfg.presets.len(), 1);
        assert_eq!(cfg.presets[0].id, "default");
        assert_eq!(cfg.timeout_seconds, 30);
        assert!(!cfg.auto_start_asked);
        assert!(!cfg.close_previous_apps);
        assert_eq!(cfg.default_preset, "");
        assert_eq!(cfg.hotkey, crate::hotkey::DEFAULT_HOTKEY);
        assert!(cfg.hotkey_enabled);
    }

    #[test]
    fn hotkey_defaults_when_missing_from_file() {
        // Configs written before the hotkey became configurable must
        // fall back to the default instead of failing to parse
        let json = r#"{
            "defaultPreset": "",
            "timeoutSeconds": 30,
            "autoStartAsked": true,
            "presets": []
        }"#;
        let cfg: Config = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.hotkey, crate::hotkey::DEFAULT_HOTKEY);
        assert!(cfg.hotkey_enabled);
    }

    #[test]
    fn hotkey_can_be_disabled_and_overridden() {
        let json = r#"{
            "defaultPreset": "",
            "timeoutSeconds": 30,
            "autoStartAsked": true,
            "hotkey": "Ctrl+Shift+F9",
            "hotkeyEnabled": false,
            "presets": []
        }"#;
        let cfg: Config = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.hotkey, "Ctrl+Shift+F9");
        assert!(!cfg.hotkey_enabled);
        // The config default must be valid for the registrar
        assert!(crate::hotkey::parse_shortcut(&cfg.hotkey).is_ok());
    }

    #[test]
    fn deserializes_camel_case() {
        let json = r#"{
            "defaultPreset": "work",
            "timeoutSeconds": 15,
            "autoStartAsked": true,
            "closePreviousApps": true,
            "presets": [{
                "id": "work",
                "name": "Work",
                "description": "",
                "apps": [{
                    "type": "website",
                    "url": "https://example.com",
                    "browser": "chrome",
                    "incognito": true,
                    "delayMs": 500,
                    "runAsAdmin": false
                }]
            }]
        }"#;
        let cfg: Config = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.default_preset, "work");
        assert_eq!(cfg.timeout_seconds, 15);
        assert!(cfg.close_previous_apps);
        let item = &cfg.presets[0].apps[0];
        assert_eq!(item.item_type, "website");
        assert_eq!(item.url, "https://example.com");
        assert_eq!(item.delay_ms, 500);
        assert!(item.incognito);
    }

    #[test]
    fn item_defaults_applied() {
        // type defaults to "app", all optional fields use defaults
        let json = r#"{"delayMs": 0}"#;
        let item: LaunchItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.item_type, "app");
        assert_eq!(item.path, "");
        assert_eq!(item.args, "");
        assert!(!item.run_as_admin);
        assert!(item.skip_if_running, "old configs keep the previous behavior");
        assert!(item.monitor.is_none());
        assert!(item.monitor_name.is_none());
        assert!(item.pos_x.is_none());
    }

    #[test]
    fn delay_ms_is_required() {
        // Contract: delayMs is required, an item without it fails to parse
        let json = r#"{"type": "app", "path": "C:\\a.exe"}"#;
        assert!(serde_json::from_str::<LaunchItem>(json).is_err());
    }

    #[test]
    fn preset_color_and_icon_optional() {
        let json = r#"{"id": "x", "name": "X", "description": "", "apps": []}"#;
        let preset: Preset = serde_json::from_str(json).unwrap();
        assert_eq!(preset.color, "");
        assert_eq!(preset.icon, "");
    }

    #[test]
    fn roundtrip_preserves_data() {
        let cfg = Config {
            default_preset: "p1".into(),
            timeout_seconds: 42,
            auto_start_asked: true,
            close_previous_apps: true,
            hotkey: "Ctrl+Alt+K".into(),
            hotkey_enabled: false,
            presets: vec![Preset {
                id: "p1".into(),
                name: "Тест".into(),
                description: "desc".into(),
                color: "#ff0000".into(),
                icon: "🚀".into(),
                apps: vec![LaunchItem {
                    item_type: "app".into(),
                    path: r"C:\Program Files\app.exe".into(),
                    args: "--flag".into(),
                    url: "".into(),
                    browser: "".into(),
                    incognito: false,
                    delay_ms: 1000,
                    run_as_admin: true,
                    skip_if_running: false,
                    monitor: Some(1),
                    monitor_name: Some(r"\\.\DISPLAY2".into()),
                    pos_x: Some(-100),
                    pos_y: Some(50),
                    pos_width: Some(800),
                    pos_height: Some(600),
                }],
            }],
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let back: Config = serde_json::from_str(&json).unwrap();
        assert_eq!(back.default_preset, cfg.default_preset);
        assert_eq!(back.hotkey, cfg.hotkey);
        assert_eq!(back.hotkey_enabled, cfg.hotkey_enabled);
        let (a, b) = (&back.presets[0].apps[0], &cfg.presets[0].apps[0]);
        assert_eq!(a.path, b.path);
        assert_eq!(a.monitor, b.monitor);
        assert_eq!(a.monitor_name, b.monitor_name);
        assert_eq!(a.pos_x, b.pos_x);
        assert_eq!(a.pos_height, b.pos_height);
        assert_eq!(a.run_as_admin, b.run_as_admin);
        assert_eq!(a.skip_if_running, b.skip_if_running);
    }

    #[test]
    fn serializes_camel_case_keys() {
        let cfg = Config::default();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"defaultPreset\""));
        assert!(json.contains("\"timeoutSeconds\""));
        assert!(json.contains("\"autoStartAsked\""));
        assert!(json.contains("\"closePreviousApps\""));
        assert!(json.contains("\"hotkey\""));
        assert!(json.contains("\"hotkeyEnabled\""));
    }

    #[test]
    fn config_path_points_to_appdata() {
        let path = config_path();
        assert!(path.ends_with("config.json"));
        assert!(path.to_string_lossy().contains("WinAutoStart"));
    }

    /// Temporary file, removed on Drop together with derived files (.tmp/.corrupt)
    struct TempCfg(PathBuf);

    impl Drop for TempCfg {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
            let _ = fs::remove_file(self.0.with_extension("json.tmp"));
            let _ = fs::remove_file(self.0.with_extension("json.corrupt"));
        }
    }

    fn temp_cfg(name: &str) -> TempCfg {
        TempCfg(
            std::env::temp_dir()
                .join(format!("winautostart-cfg-test-{}-{name}.json", std::process::id())),
        )
    }

    #[test]
    fn save_is_atomic_and_roundtrips() {
        let t = temp_cfg("atomic");
        let cfg = Config::default();
        save_config_to(&t.0, &cfg).unwrap();

        // Temp file is gone after rename, and the target parses
        assert!(!t.0.with_extension("json.tmp").exists());
        let (loaded, recovered) = load_recovering_from(&t.0).unwrap();
        assert!(!recovered);
        assert_eq!(loaded.presets.len(), cfg.presets.len());
    }

    #[test]
    fn corrupt_config_recovers_to_defaults_with_backup() {
        let t = temp_cfg("corrupt");
        fs::write(&t.0, "{ not json at all").unwrap();

        let (loaded, recovered) = load_recovering_from(&t.0).unwrap();
        assert!(recovered);
        assert_eq!(loaded.presets[0].id, "default"); // defaults

        // Original is kept alongside, the target is rewritten with valid JSON
        let backup = t.0.with_extension("json.corrupt");
        assert_eq!(fs::read_to_string(&backup).unwrap(), "{ not json at all");
        let (again, recovered_again) = load_recovering_from(&t.0).unwrap();
        assert!(!recovered_again);
        assert_eq!(again.presets[0].id, "default");
    }

    #[test]
    fn missing_file_is_read_error_not_recovery() {
        let t = temp_cfg("missing");
        let err = load_recovering_from(&t.0).unwrap_err();
        assert!(err.starts_with("Read error:"));
    }
}
