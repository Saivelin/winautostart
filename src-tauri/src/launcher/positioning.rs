//! Post-launch window positioning: waits for the launched process (or its
//! children) to create a window, then applies the configured geometry.

use super::processes::collect_child_pids;

/// Fire-and-forget window positioning: a background thread polls for up to
/// ~7s while the app creates its window (checking the PID and its direct
/// children, since launchers often hand off to another process), then
/// re-applies the position a few times to survive apps that restore their own
/// geometry on startup.
pub(super) fn position_window_by_pid(pid: u32, x: i32, y: i32, width: u32, height: u32) {
    std::thread::spawn(move || {
        crate::applog!("[pos] Starting positioning for PID {pid} -> ({x},{y} {width}x{height})");
        // Wait a bit for the app to create its window
        std::thread::sleep(std::time::Duration::from_millis(800));

        let mut reapply_left: i32 = -1; // -1 = not yet positioned

        for attempt in 0..15 {
            let mut pids_to_check = vec![pid];
            pids_to_check.extend(collect_child_pids(pid));

            for &check_pid in &pids_to_check {
                if try_position_window(check_pid, x, y, width, height) {
                    if reapply_left < 0 {
                        crate::applog!("[pos] First positioned PID {check_pid} (attempt {attempt})");
                        reapply_left = 4; // re-apply 4 more times then stop
                    } else {
                        reapply_left -= 1;
                    }
                    break;
                }
            }

            if reapply_left == 0 {
                crate::applog!("[pos] Done positioning PID {pid}");
                return;
            }

            if reapply_left > 0 {
                std::thread::sleep(std::time::Duration::from_millis(500));
            } else {
                std::thread::sleep(std::time::Duration::from_millis(400));
            }
        }

        if reapply_left < 0 {
            crate::applog!("[pos] Failed to position PID {pid} after all attempts");
        }
    });
}

/// Finds a top-level window belonging to `pid` (visible preferred, any as
/// fallback), restores it out of min/maximized state and applies the given
/// geometry. Returns whether a window was found.
fn try_position_window(pid: u32, x: i32, y: i32, width: u32, height: u32) -> bool {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible,
        SetWindowPos, ShowWindow, SWP_NOZORDER, SWP_SHOWWINDOW, SW_RESTORE,
    };

    struct FindData {
        pid: u32,
        hwnd: Option<HWND>,
        // If no visible window found, store first non-visible one as fallback
        hwnd_fallback: Option<HWND>,
    }

    unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let data = &mut *(lparam.0 as *mut FindData);
        let mut window_pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut window_pid));
        if window_pid == data.pid {
            if IsWindowVisible(hwnd).as_bool() {
                data.hwnd = Some(hwnd);
                return BOOL(0); // stop enumeration
            } else if data.hwnd_fallback.is_none() {
                data.hwnd_fallback = Some(hwnd);
            }
        }
        BOOL(1)
    }

    let mut data = FindData { pid, hwnd: None, hwnd_fallback: None };
    unsafe {
        let ptr = &mut data as *mut FindData as isize;
        let _ = EnumWindows(Some(enum_callback), LPARAM(ptr));
    }

    let target = data.hwnd.or(data.hwnd_fallback);
    if let Some(hwnd) = target {
        unsafe {
            // Ensure window is in normal (restored) state before positioning
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetWindowPos(
                hwnd,
                HWND::default(),
                x,
                y,
                width as i32,
                height as i32,
                SWP_NOZORDER | SWP_SHOWWINDOW,
            );
        }
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, GetWindowRect, ShowWindow, SW_SHOW,
        WINDOW_EX_STYLE, WS_POPUP,
    };

    // Integration: live Windows session (creates a real window)

    /// Positioning tests find the window by process PID, which they all share,
    /// so two such tests in parallel would find each other's windows. Run them
    /// strictly one at a time: the window is destroyed before the lock is released.
    fn window_test_lock() -> &'static std::sync::Mutex<()> {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| std::sync::Mutex::new(()))
    }

    /// Real top-level window of the current process, destroyed on Drop
    struct TestWindow(HWND);

    impl Drop for TestWindow {
        fn drop(&mut self) {
            unsafe {
                let _ = DestroyWindow(self.0);
            }
        }
    }

    impl TestWindow {
        fn create(visible: bool) -> Self {
            let class = crate::util::to_wide_null("STATIC");
            let title = crate::util::to_wide_null("winautostart-positioning-test");
            let hwnd = unsafe {
                CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    PCWSTR(class.as_ptr()),
                    PCWSTR(title.as_ptr()),
                    WS_POPUP,
                    10,
                    10,
                    200,
                    150,
                    None,
                    None,
                    None,
                    None,
                )
            }
            .expect("CreateWindowExW");
            if visible {
                unsafe {
                    let _ = ShowWindow(hwnd, SW_SHOW);
                }
            }
            TestWindow(hwnd)
        }

        fn rect(&self) -> RECT {
            let mut rect = RECT::default();
            unsafe {
                GetWindowRect(self.0, &mut rect).expect("GetWindowRect");
            }
            rect
        }
    }

    #[test]
    #[ignore = "integration: needs an interactive desktop session"]
    fn positions_a_visible_window_of_the_pid() {
        let _serialized = window_test_lock().lock().unwrap_or_else(|e| e.into_inner());
        let window = TestWindow::create(true);

        assert!(try_position_window(std::process::id(), 320, 240, 640, 480));

        let rect = window.rect();
        assert_eq!((rect.left, rect.top), (320, 240));
        assert_eq!((rect.right - rect.left, rect.bottom - rect.top), (640, 480));
    }

    #[test]
    #[ignore = "integration: needs an interactive desktop session"]
    fn hidden_window_is_used_as_a_fallback() {
        // The app may not have shown the window yet; position it anyway
        let _serialized = window_test_lock().lock().unwrap_or_else(|e| e.into_inner());
        let window = TestWindow::create(false);

        assert!(try_position_window(std::process::id(), 100, 120, 300, 200));

        let rect = window.rect();
        assert_eq!((rect.left, rect.top), (100, 120));
    }

    #[test]
    fn reports_failure_when_the_pid_has_no_windows() {
        let _serialized = window_test_lock().lock().unwrap_or_else(|e| e.into_inner());
        assert!(!try_position_window(u32::MAX - 1, 0, 0, 100, 100));
    }
}
