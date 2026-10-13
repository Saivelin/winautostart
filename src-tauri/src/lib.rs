//! App wiring: single-instance guard, tray icon with per-preset launch menu,
//! the configurable global show/focus hotkey, close-to-tray behavior, and
//! registration of all Tauri commands exposed to the frontend.

mod config;
mod hotkey;
mod launcher;
mod logging;
mod system;
mod util;

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

/// Shows and focuses the main window — used by the tray menu, the tray icon
/// click, the global hotkey and a second launch of the app.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Hides the main window — used by the close-to-tray interception.
fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// Tray menu: one entry per preset (id-prefixed `preset:`), then Show/Exit.
/// Rebuilt via the `rebuild_tray` command whenever presets change.
fn build_tray_menu(app: &tauri::AppHandle) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let menu = Menu::new(app)?;

    let cfg = config::load_config_from_file().unwrap_or_default();
    for preset in &cfg.presets {
        // Icons are lucide names (or legacy emoji) — neither belongs in a
        // native menu label, so the tray shows plain preset names
        let item = MenuItem::with_id(
            app,
            format!("preset:{}", preset.id),
            &preset.name,
            true,
            None::<&str>,
        )?;
        menu.append(&item)?;
    }

    let separator = PredefinedMenuItem::separator(app)?;
    menu.append(&separator)?;

    let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    menu.append(&show_item)?;

    let quit_item = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
    menu.append(&quit_item)?;

    Ok(menu)
}

#[tauri::command]
fn rebuild_tray(app: tauri::AppHandle) -> Result<(), String> {
    let menu = build_tray_menu(&app).map_err(|e| format!("Tray menu error: {e}"))?;
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_menu(Some(menu))
            .map_err(|e| format!("Set menu error: {e}"))?;
    }
    Ok(())
}

/// Re-reads the saved config and re-registers (or drops) the global hotkey, so
/// a change in settings applies without restarting the app.
#[tauri::command]
fn refresh_hotkey(app: tauri::AppHandle) -> Result<(), String> {
    let cfg = config::load_config_from_file()?;
    hotkey::apply(&app, &cfg.hotkey, cfg.hotkey_enabled)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered before every other plugin. The app lives in the
        // autostart Run key, so "already started at boot, then opened by hand"
        // is the normal case: the second process hands off to the running one
        // (which may be hidden in the tray) and exits, instead of adding a
        // second tray icon and losing the global-hotkey registration.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(launcher::LaunchedPids(Mutex::new(Vec::new())))
        .setup(|app| {
            let menu =
                build_tray_menu(app.handle()).map_err(|e| format!("Tray menu error: {e}"))?;

            let handle = app.handle().clone();
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("WinAutoStart")
                .on_menu_event(move |app_handle, event| {
                    let id = event.id().as_ref();
                    if let Some(preset_id) = id.strip_prefix("preset:") {
                        let preset_id = preset_id.to_string();
                        let h = app_handle.clone();
                        // Launching sleeps through item delays and the close grace
                        // period — keep that off the async runtime's workers
                        tauri::async_runtime::spawn_blocking(move || {
                            let state = h.state::<launcher::LaunchedPids>();
                            let cfg = config::load_config_from_file().unwrap_or_default();
                            if cfg.close_previous_apps {
                                if let Err(e) = launcher::close_previous_apps_inner(&state) {
                                    applog!("[tray] closing previous apps failed: {e}");
                                }
                            }
                            if let Err(e) = launcher::launch_preset_inner(&preset_id, &state, &|p| {
                                let _ = h.emit("launch-progress", &p);
                            }) {
                                applog!("[tray] launching preset {preset_id} failed: {e}");
                            }
                        });
                    } else if id == "show" {
                        show_main_window(app_handle);
                    } else if id == "quit" {
                        app_handle.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Global show/focus hotkey, as configured by the user. A bad combo
            // (or one already taken by another app) must not stop the app from
            // starting — the tray icon and the window still work without it.
            let cfg = config::load_config_from_file().unwrap_or_default();
            if let Err(e) = hotkey::apply(&handle, &cfg.hotkey, cfg.hotkey_enabled) {
                applog!("[hotkey] {e}");
            }

            // Intercept window close → hide to tray
            let handle2 = handle.clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        hide_main_window(&handle2);
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config::load_config,
            config::save_config,
            launcher::launch_preset,
            launcher::browsers::detect_browsers,
            launcher::close_previous_apps,
            launcher::minimize_previous_apps,
            system::registry::install_autostart,
            system::registry::uninstall_autostart,
            system::registry::is_autostart_installed,
            config::export::export_presets,
            config::export::import_presets,
            system::apps::get_start_menu_apps,
            system::apps::get_app_icon,
            system::monitors::get_monitors,
            rebuild_tray,
            refresh_hotkey,
            logging::open_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
