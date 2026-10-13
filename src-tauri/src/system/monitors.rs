//! Monitor enumeration for the window-positioning editor. Coordinates are
//! virtual-screen: the primary monitor starts at (0,0), others can be
//! negative. Item placement is stored relative to a monitor's origin.

use serde::Serialize;
use windows::Win32::Foundation::{BOOL, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFOEXW};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub index: u32,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

/// Finds the placement target for a launch item: by stored device name first
/// (survives index reshuffles after monitors are plugged/unplugged), falling
/// back to the stored index.
pub fn resolve_monitor<'a>(
    mons: &'a [MonitorInfo],
    name: Option<&str>,
    index: u32,
) -> Option<&'a MonitorInfo> {
    name.and_then(|n| mons.iter().find(|m| m.name == n))
        .or_else(|| mons.get(index as usize))
}

#[tauri::command]
pub fn get_monitors() -> Vec<MonitorInfo> {
    let mut monitors: Vec<MonitorInfo> = Vec::new();

    unsafe extern "system" fn callback(
        hmonitor: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        lparam: LPARAM,
    ) -> BOOL {
        let monitors = &mut *(lparam.0 as *mut Vec<MonitorInfo>);
        let mut info: MONITORINFOEXW = std::mem::zeroed();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;

        if GetMonitorInfoW(hmonitor, &mut info as *mut _ as *mut _).as_bool() {
            let rc = info.monitorInfo.rcMonitor;
            let name = crate::util::wide_to_string(&info.szDevice);
            let is_primary = (info.monitorInfo.dwFlags & 1) != 0;

            monitors.push(MonitorInfo {
                index: monitors.len() as u32,
                name,
                x: rc.left,
                y: rc.top,
                width: (rc.right - rc.left) as u32,
                height: (rc.bottom - rc.top) as u32,
                is_primary,
            });
        }

        BOOL(1)
    }

    unsafe {
        let ptr = &mut monitors as *mut Vec<MonitorInfo> as isize;
        let _ = EnumDisplayMonitors(HDC::default(), None, Some(callback), LPARAM(ptr));
    }

    monitors
}

#[cfg(test)]
mod tests {
    use super::*;

    // Integration smoke test on a live system (needs a real display; don't run in headless CI)
    #[test]
    #[ignore = "integration: needs a real display"]
    fn monitors_enumerated_with_sane_data() {
        let mons = get_monitors();
        assert!(!mons.is_empty(), "no monitors found");

        // Indices are sequential from zero
        for (i, mon) in mons.iter().enumerate() {
            assert_eq!(mon.index, i as u32);
            assert!(mon.width > 0, "zero width: {}", mon.name);
            assert!(mon.height > 0, "zero height: {}", mon.name);
            assert!(!mon.name.is_empty());
        }

        // Exactly one primary
        let primaries = mons.iter().filter(|m| m.is_primary).count();
        assert_eq!(primaries, 1, "expected exactly one primary monitor");

        // Primary starts at (0,0), that's how the Windows virtual screen works
        let primary = mons.iter().find(|m| m.is_primary).unwrap();
        assert_eq!((primary.x, primary.y), (0, 0));
    }

    fn fake_monitors() -> Vec<MonitorInfo> {
        let mk = |index: u32, name: &str, is_primary: bool| MonitorInfo {
            index,
            name: name.into(),
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            is_primary,
        };
        vec![mk(0, r"\\.\DISPLAY1", true), mk(1, r"\\.\DISPLAY2", false)]
    }

    #[test]
    fn resolve_monitor_prefers_device_name() {
        let mons = fake_monitors();
        // Name points to DISPLAY2, index to DISPLAY1: the name wins
        let m = resolve_monitor(&mons, Some(r"\\.\DISPLAY2"), 0).unwrap();
        assert_eq!(m.index, 1);
    }

    #[test]
    fn resolve_monitor_falls_back_to_index() {
        let mons = fake_monitors();
        // Name not found (monitor was replugged), fall back to the index
        let m = resolve_monitor(&mons, Some(r"\\.\DISPLAY9"), 1).unwrap();
        assert_eq!(m.index, 1);
        // No name at all (old config), also by index
        let m = resolve_monitor(&mons, None, 0).unwrap();
        assert_eq!(m.index, 0);
    }

    #[test]
    fn resolve_monitor_none_when_both_miss() {
        let mons = fake_monitors();
        assert!(resolve_monitor(&mons, Some("nope"), 5).is_none());
    }

    #[test]
    fn monitor_info_serializes_camel_case() {
        let info = MonitorInfo {
            index: 0,
            name: r"\\.\DISPLAY1".into(),
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            is_primary: true,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"isPrimary\":true"));
        assert!(json.contains("\"width\":1920"));
    }
}
