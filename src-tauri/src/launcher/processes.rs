//! Process-level helpers: running-check by executable, child-PID enumeration,
//! graceful/forced closing and window minimization for tracked PIDs.

use std::time::{Duration, Instant};

use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW,
    PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

/// Case-insensitive path comparison that treats `/` and `\` alike.
fn same_path(a: &str, b: &str) -> bool {
    a.replace('/', "\\").to_lowercase() == b.replace('/', "\\").to_lowercase()
}

/// Full image path of a running process. `None` when the process is gone or
/// the path can't be read (elevated processes deny this to a normal user).
fn image_path_of(pid: u32) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .is_ok();
        let _ = CloseHandle(handle);
        if !ok || len == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// Lookup of a running process via a ToolHelp snapshot. The executable name is
/// the cheap filter; when `exe_path` is a full path, the candidate's own image
/// path has to match it too — otherwise an unrelated `chrome.exe` from another
/// install would make us skip the item and reposition a stranger's window.
/// A candidate whose path can't be read (no rights) is accepted as a last
/// resort, which is the old name-only behavior.
pub(super) fn pid_of(exe_name: &str, exe_path: Option<&str>) -> Option<u32> {
    let target = exe_name.to_lowercase();
    let full_path = exe_path.filter(|p| std::path::Path::new(p).is_absolute());
    let mut unverified: Option<u32> = None;

    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return None;
        };
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let name = crate::util::wide_to_string(&entry.szExeFile).to_lowercase();
                if name == target {
                    let pid = entry.th32ProcessID;
                    let matches = match full_path {
                        None => true,
                        Some(wanted) => match image_path_of(pid) {
                            Some(actual) => same_path(&actual, wanted),
                            None => {
                                unverified.get_or_insert(pid);
                                false
                            }
                        },
                    };
                    if matches {
                        let _ = CloseHandle(snapshot);
                        return Some(pid);
                    }
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    unverified
}

/// Collect direct child process PIDs of a given parent PID
pub(super) fn collect_child_pids(parent_pid: u32) -> Vec<u32> {
    let mut children = Vec::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return children;
        };
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                if entry.th32ParentProcessID == parent_pid {
                    children.push(entry.th32ProcessID);
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    children
}

/// Asks every visible top-level window of `pid` to close, the same way the
/// window's X button does — the app gets to run its "save your work?" prompt.
fn request_close(pid: u32) -> bool {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_CLOSE,
    };

    struct Request {
        pid: u32,
        asked: bool,
    }

    unsafe extern "system" fn enum_request_close(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let request = &mut *(lparam.0 as *mut Request);
        let mut window_pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut window_pid));
        if window_pid == request.pid && IsWindowVisible(hwnd).as_bool() {
            let _ = PostMessageW(hwnd, WM_CLOSE, WPARAM(0), LPARAM(0));
            request.asked = true;
        }
        BOOL(1)
    }

    let mut request = Request { pid, asked: false };
    unsafe {
        let _ = EnumWindows(
            Some(enum_request_close),
            LPARAM(&mut request as *mut Request as isize),
        );
    }
    request.asked
}

/// Waits up to `timeout` for a process to exit. A PID that can no longer be
/// opened is treated as gone — that is the normal outcome after WM_CLOSE.
fn wait_for_exit(pid: u32, timeout: Duration) -> bool {
    use windows::Win32::Foundation::WAIT_OBJECT_0;
    use windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_ACCESS_RIGHTS};

    /// The windows crate exposes SYNCHRONIZE only as a file right; for a
    /// process handle it is the same standard bit.
    const SYNCHRONIZE: PROCESS_ACCESS_RIGHTS = PROCESS_ACCESS_RIGHTS(0x0010_0000);

    unsafe {
        let Ok(handle) = OpenProcess(SYNCHRONIZE, false, pid) else {
            return true;
        };
        let result = WaitForSingleObject(handle, timeout.as_millis() as u32);
        let _ = CloseHandle(handle);
        result == WAIT_OBJECT_0
    }
}

/// Closes processes as gently as Windows allows: every window is asked to
/// close first, and only what is still alive after the shared `grace` window
/// is terminated. A hard `TerminateProcess` on an editor loses unsaved work,
/// so it is the fallback, not the first move.
///
/// Returns how many of the PIDs are gone afterwards.
pub(super) fn close_processes(pids: &[u32], grace: Duration) -> u32 {
    for &pid in pids {
        request_close(pid);
    }

    let deadline = Instant::now() + grace;
    let mut gone = 0u32;
    let mut survivors = Vec::new();
    for &pid in pids {
        let left = deadline.saturating_duration_since(Instant::now());
        if wait_for_exit(pid, left) {
            gone += 1;
        } else {
            survivors.push(pid);
        }
    }

    for pid in survivors {
        crate::applog!("[close] PID {pid} did not close in time — terminating");
        if terminate_process(pid) {
            gone += 1;
        }
    }
    gone
}

/// Terminates a process by PID. Returns whether termination succeeded;
/// already-dead or inaccessible PIDs return `false`.
pub(super) fn terminate_process(pid: u32) -> bool {
    use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_TERMINATE, false, pid) else {
            return false;
        };
        let ok = TerminateProcess(handle, 0).is_ok();
        let _ = CloseHandle(handle);
        ok
    }
}

/// Minimizes every visible top-level window belonging to `pid`.
pub(super) fn minimize_windows_of_pid(pid: u32) {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible, ShowWindow, SW_MINIMIZE,
    };

    unsafe extern "system" fn enum_minimize(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let pid = lparam.0 as u32;
        let mut window_pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut window_pid));
        if window_pid == pid && IsWindowVisible(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_MINIMIZE);
        }
        BOOL(1)
    }

    unsafe {
        let _ = EnumWindows(Some(enum_minimize), LPARAM(pid as isize));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Integration: live Windows session; don't run in headless CI

    #[test]
    fn same_path_ignores_case_and_separator_style() {
        assert!(same_path(r"C:\Apps\Tool.exe", r"c:/apps/tool.exe"));
        assert!(!same_path(r"C:\Apps\Tool.exe", r"C:\Other\Tool.exe"));
    }

    #[test]
    fn current_process_has_pid() {
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_str().unwrap();
        // Don't compare the exact PID: a same-named binary may be running concurrently
        assert!(pid_of(name, None).is_some());
    }

    #[test]
    fn bogus_process_has_no_pid() {
        assert_eq!(pid_of("winautostart-no-such-process-xyz.exe", None), None);
    }

    #[test]
    fn matching_full_path_still_finds_the_process() {
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_str().unwrap();
        assert!(pid_of(name, Some(exe.to_str().unwrap())).is_some());
    }

    #[test]
    fn same_name_from_another_location_is_not_matched() {
        // The exact bug the path check was added for: a same-named exe
        // from another install no longer counts as "already running"
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_str().unwrap();
        let elsewhere = format!(r"C:\winautostart-no-such-dir\{name}");
        assert_eq!(pid_of(name, Some(&elsewhere)), None);
    }

    #[test]
    fn relative_path_falls_back_to_name_matching() {
        // A non-absolute path has nothing to match against; behaves as before
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_str().unwrap();
        assert!(pid_of(name, Some(name)).is_some());
    }

    #[test]
    fn closing_nothing_closes_nothing() {
        assert_eq!(close_processes(&[], Duration::from_millis(10)), 0);
    }

    #[test]
    fn dead_pid_counts_as_closed() {
        assert_eq!(close_processes(&[u32::MAX - 1], Duration::from_millis(10)), 1);
    }

    /// Test subject process: killed on Drop so a failed test doesn't
    /// leave it running until it exits on its own
    struct Victim(u32);

    impl Drop for Victim {
        fn drop(&mut self) {
            terminate_process(self.0);
        }
    }

    /// Windowless process that lives a few seconds (loopback ping is the
    /// cheapest sleep available on any Windows)
    // Killed by PID through `Victim`'s Drop, the way the app kills tracked
    // processes, so the `Child` handle is intentionally not waited on
    #[allow(clippy::zombie_processes)]
    fn spawn_windowless_victim() -> Victim {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        let child = std::process::Command::new("cmd.exe")
            .args(["/c", "ping", "-n", "5", "127.0.0.1"])
            .creation_flags(DETACHED_PROCESS)
            .spawn()
            .expect("spawn cmd.exe");
        Victim(child.id())
    }

    #[test]
    fn windowless_process_is_terminated_after_the_grace_period() {
        // A windowless process has nowhere to send WM_CLOSE; tests the fallback
        let victim = spawn_windowless_victim();

        assert_eq!(close_processes(&[victim.0], Duration::from_millis(200)), 1);
        assert!(wait_for_exit(victim.0, Duration::from_millis(500)));
    }

    #[test]
    fn collect_child_pids_does_not_crash() {
        // Smoke: the current process may have no children; it just must not fail
        let _ = collect_child_pids(std::process::id());
    }

    #[test]
    fn terminate_nonexistent_pid_returns_false() {
        assert!(!terminate_process(u32::MAX - 1));
    }
}
