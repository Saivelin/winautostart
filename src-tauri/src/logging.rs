//! File logging. The release build is a `windows_subsystem = "windows"` app,
//! so `eprintln!` output goes nowhere and a user's bug report would come with
//! no artifact at all — every diagnostic line also lands in
//! `%APPDATA%\WinAutoStart\log.txt`, which the settings screen can open.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// Rotate once the file passes this size: the previous log is kept as
/// `log.txt.1` and a fresh file starts, so the log can't grow without bound.
const MAX_LOG_BYTES: u64 = 512 * 1024;

/// Serializes writes from the launch thread, the tray thread and the hotkey
/// callback — interleaved half-lines would be worse than no log.
fn write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// `%APPDATA%\WinAutoStart\log.txt`, next to the config file.
pub fn log_path() -> PathBuf {
    crate::config::config_path().with_file_name("log.txt")
}

/// `2026-08-23 14:05:09.123` in local time, straight from Win32 — no extra
/// date crate for one format string.
fn timestamp() -> String {
    use windows::Win32::System::SystemInformation::GetLocalTime;
    let t = unsafe { GetLocalTime() };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds
    )
}

fn rotate_if_needed(path: &Path) {
    let too_big = fs::metadata(path).map(|m| m.len() >= MAX_LOG_BYTES).unwrap_or(false);
    if too_big {
        let _ = fs::rename(path, path.with_extension("txt.1"));
    }
}

/// Appends one line, rotating first when the file got too big. Every failure
/// is swallowed: logging must never break a launch.
fn append_line(path: &Path, line: &str) {
    rotate_if_needed(path);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

/// Writes one diagnostic line to stderr (visible in `tauri dev`) and to the
/// log file. Use through the `applog!` macro.
pub fn log(message: &str) {
    eprintln!("{message}");
    let line = format!("{} {message}", timestamp());
    let _guard = write_lock().lock();
    append_line(&log_path(), &line);
}

/// `applog!("[launch] {thing} failed: {e}")` — same formatting as `println!`.
#[macro_export]
macro_rules! applog {
    ($($arg:tt)*) => {
        $crate::logging::log(&format!($($arg)*))
    };
}

/// Opens the log file in whatever the system associates with `.txt`. Creates
/// it first so "nothing has been logged yet" doesn't look like a broken button.
#[tauri::command]
pub fn open_log() -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let path = log_path();
    if !path.exists() {
        fs::write(&path, "").map_err(|e| format!("Failed to create log file: {e}"))?;
    }

    let file = crate::util::to_wide_null(&path.to_string_lossy());
    let verb = crate::util::to_wide_null("open");
    let code = unsafe {
        ShellExecuteW(
            HWND::default(),
            PCWSTR(verb.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if code.0 as isize <= 32 {
        return Err(format!("Failed to open {}", path.display()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Temporary log, removed on Drop together with its rotated copy
    struct TempLog(PathBuf);

    impl Drop for TempLog {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
            let _ = fs::remove_file(self.0.with_extension("txt.1"));
        }
    }

    fn temp_log(name: &str) -> TempLog {
        TempLog(
            std::env::temp_dir()
                .join(format!("winautostart-log-test-{}-{name}.txt", std::process::id())),
        )
    }

    #[test]
    fn log_path_sits_next_to_the_config() {
        let path = log_path();
        assert!(path.ends_with("log.txt"));
        assert_eq!(path.parent(), crate::config::config_path().parent());
    }

    #[test]
    fn timestamp_has_the_expected_shape() {
        let stamp = timestamp();
        assert_eq!(stamp.len(), 23, "{stamp}");
        assert_eq!(&stamp[4..5], "-");
        assert_eq!(&stamp[10..11], " ");
        assert_eq!(&stamp[13..14], ":");
        assert_eq!(&stamp[19..20], ".");
        assert!(stamp[0..4].parse::<u16>().unwrap() >= 2024);
    }

    #[test]
    fn appends_lines_in_order() {
        let t = temp_log("append");
        append_line(&t.0, "first");
        append_line(&t.0, "second");
        assert_eq!(fs::read_to_string(&t.0).unwrap(), "first\nsecond\n");
    }

    #[test]
    fn rotates_when_the_file_grows_past_the_cap() {
        let t = temp_log("rotate");
        fs::write(&t.0, vec![b'x'; MAX_LOG_BYTES as usize]).unwrap();
        append_line(&t.0, "after rotation");

        // Old content moved to .1, the new file starts empty
        let rotated = t.0.with_extension("txt.1");
        assert_eq!(fs::metadata(&rotated).unwrap().len(), MAX_LOG_BYTES);
        assert_eq!(fs::read_to_string(&t.0).unwrap(), "after rotation\n");
    }

    #[test]
    fn rotation_overwrites_the_previous_backup() {
        let t = temp_log("rotate-twice");
        let rotated = t.0.with_extension("txt.1");
        fs::write(&rotated, "older").unwrap();
        fs::write(&t.0, vec![b'x'; MAX_LOG_BYTES as usize]).unwrap();
        append_line(&t.0, "fresh");

        assert_eq!(fs::metadata(&rotated).unwrap().len(), MAX_LOG_BYTES);
        assert_eq!(fs::read_to_string(&t.0).unwrap(), "fresh\n");
    }

    #[test]
    fn small_file_is_not_rotated() {
        let t = temp_log("no-rotate");
        append_line(&t.0, "one");
        append_line(&t.0, "two");
        assert!(!t.0.with_extension("txt.1").exists());
    }
}
