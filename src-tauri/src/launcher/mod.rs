//! Orchestration of preset launches: iterates preset items, delegates the
//! actual work to the submodules (spawning, browser detection, .lnk
//! resolution, window positioning) and tracks launched PIDs for the
//! "Switch & Close" / "Switch & Minimize" features.

pub mod browsers;
mod lnk;
mod positioning;
mod processes;
mod spawn;

use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

use crate::config::load_config_from_file;
use crate::system::monitors;

/// How long apps get to close themselves before "Switch & Close" resorts to
/// killing them. Long enough for a "save your work?" dialog to appear — it
/// stops the countdown, because a process showing a modal is still alive.
const CLOSE_GRACE: Duration = Duration::from_secs(3);

/// PIDs captured during the most recent preset launch. Consumed by
/// "Switch & Close" / "Switch & Minimize". Cleared on every launch, so only
/// the last preset's processes are tracked; items launched without a PID
/// (elevated apps, default-browser URLs, skipped items) are not in here.
pub struct LaunchedPids(pub Mutex<Vec<u32>>);

/// Runs `f` with the tracked PID list locked. The lock is taken per operation,
/// never held across a launch: `launch_preset` sleeps between items, and
/// holding it there would block the tray and the close/minimize commands for
/// the whole launch.
fn with_pids<R>(state: &LaunchedPids, f: impl FnOnce(&mut Vec<u32>) -> R) -> Result<R, String> {
    let mut pids = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    Ok(f(&mut pids))
}

/// Serializes whole launches. Launch commands now run off the main thread, so
/// the window and the tray menu can start one while another is still stepping
/// through its delays — and the second one clearing the PID list would leave
/// the first preset's apps untracked by "Switch & Close".
fn launch_lock() -> &'static Mutex<()> {
    static LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Live status of one launch item, streamed to the frontend as
/// `launch-progress` events while `launch_preset` runs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchProgress {
    pub index: usize,
    pub total: usize,
    pub label: String,
    /// "launching" | "ok" | "failed" | "skipped"
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Launches every item of the preset `id`, in order. Per item: honors
/// `delayMs` (except for the first item), skips apps whose executable is
/// already running (but still positions their existing window), tracks PIDs
/// for later close/minimize, schedules window positioning when all placement
/// fields are set, and reports each step through `progress`.
///
/// Returns one label per item: the path/URL on success (or skip), or a
/// `"FAILED: ..."` string — a single bad item never aborts the rest.
pub fn launch_preset_inner(
    id: &str,
    state: &LaunchedPids,
    progress: &dyn Fn(LaunchProgress),
) -> Result<Vec<String>, String> {
    let _launching = launch_lock()
        .lock()
        .map_err(|e| format!("Launch lock error: {e}"))?;

    let cfg = load_config_from_file()?;
    let preset = cfg
        .presets
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Preset '{id}' not found"))?;

    with_pids(state, |pids| pids.clear())?;
    let mut launched = Vec::new();
    let total = preset.apps.len();

    for (i, item) in preset.apps.iter().enumerate() {
        let label = if item.item_type == "website" {
            item.url.clone()
        } else {
            item.path.clone()
        };
        let report = |status: &'static str, error: Option<String>| {
            progress(LaunchProgress { index: i, total, label: label.clone(), status, error });
        };

        if item.delay_ms > 0 && i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(item.delay_ms));
        }
        report("launching", None);

        // Skip if this exact app is already running — but still apply the
        // configured placement to the existing process's window. Matching is
        // by full image path when there is one, so a same-named exe from
        // another install doesn't suppress the launch.
        if item.item_type != "website" && item.skip_if_running {
            if let Some(exe) = lnk::exe_name_from_path(&item.path) {
                let exe_path = lnk::exe_target_path(&item.path);
                if let Some(existing_pid) = processes::pid_of(&exe, exe_path.as_deref()) {
                    crate::applog!("[launch] Skipping {exe} — already running (PID {existing_pid})");
                    schedule_positioning(existing_pid, item);
                    launched.push(item.path.clone());
                    report("skipped", None);
                    continue;
                }
            }
        }

        let result = if item.item_type == "website" {
            spawn::launch_website(&item.url, &item.browser, item.incognito)
        } else if item.run_as_admin {
            spawn::launch_app_elevated(&item.path, &item.args)
        } else {
            spawn::launch_app(&item.path, &item.args)
        };

        match result {
            Ok(pid_opt) => {
                if let Some(pid) = pid_opt {
                    with_pids(state, |pids| pids.push(pid))?;
                    schedule_positioning(pid, item);
                }
                launched.push(label.clone());
                report("ok", None);
            }
            Err(e) => {
                crate::applog!("[launch] {label}: {e}");
                launched.push(format!("FAILED: {e}"));
                report("failed", Some(e));
            }
        }
    }

    Ok(launched)
}

/// Kicks off background window positioning when the item has a full set of
/// placement fields; positions are stored relative to the chosen monitor.
fn schedule_positioning(pid: u32, item: &crate::config::LaunchItem) {
    crate::applog!(
        "[launch] PID={pid} monitor={:?} pos=({:?},{:?}) size=({:?},{:?})",
        item.monitor, item.pos_x, item.pos_y, item.pos_width, item.pos_height
    );
    let (Some(monitor_idx), Some(px), Some(py), Some(pw), Some(ph)) = (
        item.monitor,
        item.pos_x,
        item.pos_y,
        item.pos_width,
        item.pos_height,
    ) else {
        crate::applog!("[launch] No position data for this item");
        return;
    };

    let mons = monitors::get_monitors();
    crate::applog!(
        "[launch] Found {} monitors, resolving name={:?} index={}",
        mons.len(), item.monitor_name, monitor_idx
    );
    if let Some(mon) = monitors::resolve_monitor(&mons, item.monitor_name.as_deref(), monitor_idx) {
        let abs_x = mon.x + px;
        let abs_y = mon.y + py;
        crate::applog!("[launch] Positioning at abs ({abs_x},{abs_y}) {pw}x{ph}");
        positioning::position_window_by_pid(pid, abs_x, abs_y, pw, ph);
    }
}

/// Closes every tracked process and empties the list: each one is asked to
/// close first (so unsaved work can be saved), and only what is still running
/// after `CLOSE_GRACE` is terminated. Returns how many of them are gone.
pub fn close_previous_apps_inner(state: &LaunchedPids) -> Result<u32, String> {
    let pids = with_pids(state, std::mem::take)?;
    Ok(processes::close_processes(&pids, CLOSE_GRACE))
}

/// Minimizes all visible windows of the tracked PIDs, keeping the list intact
/// (the apps stay alive). Returns the number of PIDs processed — not the
/// number of windows actually minimized.
pub fn minimize_previous_apps_inner(state: &LaunchedPids) -> Result<u32, String> {
    let pids = with_pids(state, |pids| pids.clone())?;
    for &pid in &pids {
        processes::minimize_windows_of_pid(pid);
    }
    Ok(pids.len() as u32)
}

/// Runs `f` on the blocking thread pool. Launching sleeps between items and
/// closing waits out the grace period; on the main thread that would freeze
/// the window (and the progress list these events feed), and on the async
/// runtime's workers it would stall every other command.
async fn run_blocking<R: Send + 'static>(
    app: tauri::AppHandle,
    f: impl FnOnce(&tauri::AppHandle, &LaunchedPids) -> Result<R, String> + Send + 'static,
) -> Result<R, String> {
    tauri::async_runtime::spawn_blocking(move || f(&app, &app.state::<LaunchedPids>()))
        .await
        .map_err(|e| format!("Launcher task failed: {e}"))?
}

#[tauri::command]
pub async fn launch_preset(id: String, app: tauri::AppHandle) -> Result<Vec<String>, String> {
    run_blocking(app, move |app, state| {
        launch_preset_inner(&id, state, &|p| {
            let _ = app.emit("launch-progress", &p);
        })
    })
    .await
}

#[tauri::command]
pub async fn close_previous_apps(app: tauri::AppHandle) -> Result<u32, String> {
    run_blocking(app, |_, state| close_previous_apps_inner(state)).await
}

#[tauri::command]
pub async fn minimize_previous_apps(app: tauri::AppHandle) -> Result<u32, String> {
    run_blocking(app, |_, state| minimize_previous_apps_inner(state)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_previous_apps_empty_state() {
        let state = LaunchedPids(Mutex::new(Vec::new()));
        assert_eq!(close_previous_apps_inner(&state), Ok(0));
    }

    #[test]
    fn minimize_previous_apps_counts_pids() {
        // Nonexistent PID: no windows found, but the counter still increments; pins the contract
        let state = LaunchedPids(Mutex::new(vec![u32::MAX - 1]));
        assert_eq!(minimize_previous_apps_inner(&state), Ok(1));
    }
}
