//! Process spawning for apps and websites: direct `.exe` launches, shell
//! launches for everything else, elevated (UAC) launches, and browser
//! invocations with private-mode flags.

use std::os::windows::process::CommandExt;
use std::process::Command;

use super::browsers::{detect_browsers, incognito_flag};
use crate::util::{to_wide_null, ComApartment};

const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
const DETACHED_PROCESS: u32 = 0x00000008;

/// Parent directory of `path` as a null-terminated wide string (empty when
/// there is none) — the working-directory argument for the ShellExecute APIs.
fn parent_dir_wide(path: &str) -> Vec<u16> {
    let dir = std::path::Path::new(path)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("");
    to_wide_null(dir)
}

/// Splits an argument string on whitespace, honoring double quotes: a quoted
/// span (e.g. a path with spaces) stays one argument, quotes are stripped.
/// An unclosed quote swallows the rest of the string as one argument.
fn split_args(args: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for c in args.chars() {
        match c {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// Runs `ShellExecuteExW`. With `track_process` the process handle is
/// requested so the PID can be tracked when the shell provides one (elevated
/// launches and URL handlers usually don't).
fn shell_execute(
    verb: &str,
    file: &str,
    args: &str,
    dir: &[u16],
    track_process: bool,
) -> Result<Option<u32>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::GetProcessId;
    use windows::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS,
        SHELLEXECUTEINFOW,
    };
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb_wide = to_wide_null(verb);
    let file_wide = to_wide_null(file);
    let params_wide = to_wide_null(args);
    // Handlers registered for a verb/protocol can be COM-based
    let _com = ComApartment::enter();

    let mut sei: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    sei.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    // NOASYNC: this worker thread has no message loop to finish an async launch
    // (and the COM apartment ends right after). NO_UI: errors are reported in
    // the launch progress list, not as a message box from a background thread
    sei.fMask = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
    if track_process {
        sei.fMask |= SEE_MASK_NOCLOSEPROCESS;
    }
    sei.lpVerb = PCWSTR(verb_wide.as_ptr());
    sei.lpFile = PCWSTR(file_wide.as_ptr());
    sei.lpParameters = PCWSTR(params_wide.as_ptr());
    sei.lpDirectory = PCWSTR(dir.as_ptr());
    sei.nShow = SW_SHOWNORMAL.0;

    if let Err(e) = unsafe { ShellExecuteExW(&mut sei) } {
        return Err(shell_execute_error(verb, file, e.code().0, &e.message()));
    }

    if !track_process || sei.hProcess.is_invalid() {
        return Ok(None);
    }
    let pid = unsafe { GetProcessId(sei.hProcess) };
    unsafe {
        let _ = CloseHandle(sei.hProcess);
    }
    Ok((pid != 0).then_some(pid))
}

/// A cancelled or refused UAC prompt surfaces as ERROR_CANCELLED from the
/// `runas` verb — worth saying in plain words rather than as an HRESULT.
fn shell_execute_error(verb: &str, file: &str, hresult: i32, message: &str) -> String {
    const HRESULT_ERROR_CANCELLED: i32 = 0x8007_04C7_u32 as i32;
    if verb == "runas" && hresult == HRESULT_ERROR_CANCELLED {
        format!("Elevation was cancelled or denied for {file}")
    } else {
        format!("ShellExecuteEx failed for {file}: {message} (0x{:08X})", hresult as u32)
    }
}

/// Launches an app elevated via `ShellExecuteExW` with the `runas` verb (UAC
/// prompt). Always returns `Ok(None)`: elevated apps have no tracked PID.
pub(super) fn launch_app_elevated(path: &str, args: &str) -> Result<Option<u32>, String> {
    shell_execute("runas", path, args, &parent_dir_wide(path), false)?;
    Ok(None)
}

/// Website items must stay websites: the URL is handed to the shell or a
/// browser, so a `file://` URL or a local path from an edited/imported config
/// would otherwise open (or run) a local file. A URL without a scheme gets
/// `https://`, so `example.com` works as typed. Returns the URL as written
/// (plus the scheme), validated by the `url` crate.
fn normalize_web_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Website URL is empty".into());
    }
    if url.contains('\\') || has_drive_prefix(url) {
        return Err(format!("Not a website URL: {url}"));
    }
    // The URL is passed on as typed, so it must not carry anything the parser
    // below would silently drop or percent-encode — validated and launched
    // strings have to be the same. Spaces/quotes could otherwise leak into a
    // browser handler's command line.
    if url.chars().any(|c| c.is_control() || c.is_whitespace() || c == '"') {
        return Err(format!("URL contains spaces, quotes or control characters: {url}"));
    }

    let candidate = if has_explicit_scheme(url) {
        url.to_string()
    } else {
        format!("https://{url}")
    };
    let parsed = url::Url::parse(&candidate).map_err(|e| format!("Invalid URL {url}: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!(
            "Unsupported URL scheme '{}' in {url}: only http and https are allowed",
            parsed.scheme()
        ));
    }
    if parsed.host_str().is_none_or(str::is_empty) {
        return Err(format!("URL has no host: {url}"));
    }
    Ok(candidate)
}

/// `<scheme>://` at the start, with a scheme per RFC 3986 — so a `://` deeper
/// in the string (`example.com/?to=https://x.com`) is not mistaken for one.
fn has_explicit_scheme(url: &str) -> bool {
    url.split_once("://").is_some_and(|(scheme, _)| {
        let mut chars = scheme.chars();
        chars.next().is_some_and(|c| c.is_ascii_alphabetic())
            && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    })
}

/// `C:/...` or `C:\...` — a local path, even when written with forward slashes.
fn has_drive_prefix(url: &str) -> bool {
    let bytes = url.as_bytes();
    bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && matches!(bytes[2], b'/' | b'\\')
}

/// Launches an app item. `.exe` paths are spawned directly (detached, with
/// the exe's directory as cwd); anything else (`.lnk`, `.bat`, documents) goes
/// through `ShellExecuteExW`, retrying with an appended `.lnk` extension when
/// the bare path doesn't exist. Returns the PID when the API provides one.
pub(super) fn launch_app(path: &str, args: &str) -> Result<Option<u32>, String> {
    let path_obj = std::path::Path::new(path);
    let is_exe = path_obj
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("exe"))
        .unwrap_or(false);

    if is_exe {
        let mut cmd = Command::new(path);
        if let Some(dir) = path_obj.parent() {
            cmd.current_dir(dir);
        }
        if !args.is_empty() {
            cmd.args(split_args(args));
        }
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to launch {path}: {e}"))?;
        Ok(Some(child.id()))
    } else {
        launch_via_shell(path, args)
    }
}

/// Shell path for non-exe items (`.lnk`, `.bat`, documents), retrying with an
/// appended `.lnk` when the bare path doesn't exist. `args` go to the shell
/// as-is (used by `.bat`/`.cmd` and shortcuts' targets).
fn launch_via_shell(path: &str, args: &str) -> Result<Option<u32>, String> {
    let resolved = if !std::path::Path::new(path).exists() {
        let with_lnk = format!("{}.lnk", path);
        if std::path::Path::new(&with_lnk).exists() {
            with_lnk
        } else {
            path.to_string()
        }
    } else {
        path.to_string()
    };
    shell_execute("open", &resolved, args, &parent_dir_wide(&resolved), true)
}

/// Opens a URL. `"default"`/empty browser delegates to the shell (no PID);
/// otherwise the browser id must match one from `detect_browsers`, which is
/// spawned directly so the PID can be tracked.
pub(super) fn launch_website(url: &str, browser: &str, incognito: bool) -> Result<Option<u32>, String> {
    let url = normalize_web_url(url)?;
    if browser == "default" || browser.is_empty() {
        return shell_execute("open", &url, "", &to_wide_null(""), false);
    }

    let browsers = detect_browsers();
    let info = browsers
        .iter()
        .find(|b| b.id == browser)
        .ok_or_else(|| format!("Browser '{browser}' not found"))?;

    let mut cmd = Command::new(&info.path);
    if incognito {
        let flag = incognito_flag(&info.path);
        if !flag.is_empty() {
            cmd.arg(flag);
        }
    }
    cmd.arg(&url);
    cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to launch {}: {e}", info.path))?;
    Ok(Some(child.id()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_args_basic() {
        assert_eq!(split_args("--flag -x 1"), vec!["--flag", "-x", "1"]);
        assert!(split_args("").is_empty());
        assert!(split_args("   ").is_empty());
    }

    #[test]
    fn split_args_quoted_path_stays_whole() {
        assert_eq!(
            split_args(r#"--profile "C:\My Files" -x"#),
            vec!["--profile", r"C:\My Files", "-x"]
        );
    }

    #[test]
    fn split_args_quotes_inside_token() {
        // Attached quote: --data="a b" → a single argument without quotes
        assert_eq!(split_args(r#"--data="a b""#), vec!["--data=a b"]);
    }

    #[test]
    fn split_args_unclosed_quote_takes_rest() {
        assert_eq!(split_args(r#"--x "C:\My Files"#), vec!["--x", r"C:\My Files"]);
    }

    #[test]
    fn parent_dir_wide_extracts_directory() {
        assert_eq!(parent_dir_wide(r"C:\Apps\tool.exe"), to_wide_null(r"C:\Apps"));
    }

    #[test]
    fn parent_dir_wide_empty_when_no_parent() {
        assert_eq!(parent_dir_wide("tool.exe"), vec![0]);
    }

    #[test]
    fn web_url_keeps_http_and_https() {
        assert_eq!(normalize_web_url("https://example.com/a?b=1").unwrap(), "https://example.com/a?b=1");
        assert_eq!(normalize_web_url("HTTP://example.com").unwrap(), "HTTP://example.com");
        assert_eq!(normalize_web_url("  https://example.com  ").unwrap(), "https://example.com");
    }

    #[test]
    fn web_url_without_scheme_gets_https() {
        assert_eq!(normalize_web_url("example.com").unwrap(), "https://example.com");
        assert_eq!(normalize_web_url("mail.google.com/inbox").unwrap(), "https://mail.google.com/inbox");
        assert_eq!(normalize_web_url("localhost:8080").unwrap(), "https://localhost:8080");
    }

    #[test]
    fn web_url_scheme_deeper_in_the_string_is_not_the_scheme() {
        assert_eq!(
            normalize_web_url("example.com/go?to=https://x.com").unwrap(),
            "https://example.com/go?to=https://x.com"
        );
    }

    #[test]
    fn web_url_rejects_other_schemes_and_local_paths() {
        assert!(normalize_web_url("file:///C:/Windows/System32/calc.exe").is_err());
        assert!(normalize_web_url("ftp://example.com").is_err());
        assert!(normalize_web_url(r"C:\Windows\System32\calc.exe").is_err());
        assert!(normalize_web_url("C:/Windows/System32/calc.exe").is_err());
        assert!(normalize_web_url(r"\\server\share\run.bat").is_err());
    }

    #[test]
    fn web_url_rejects_script_urls() {
        // Prefixed with https:// it no longer parses (`alert(1)` is not a port)
        assert!(normalize_web_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn web_url_rejects_empty_and_hostless() {
        assert!(normalize_web_url("").is_err());
        assert!(normalize_web_url("   ").is_err());
        assert!(normalize_web_url("https://").is_err());
    }

    #[test]
    fn web_url_rejects_spaces_quotes_and_control_chars() {
        assert!(normalize_web_url(r#"https://x.com/"  --flag "a"#).is_err());
        assert!(normalize_web_url("https://x.com/a b").is_err());
        assert!(normalize_web_url("https://x.com/\tpath").is_err());
        assert!(normalize_web_url("https://x.com/\npath").is_err());
    }

    #[test]
    fn cancelled_elevation_gets_a_readable_error() {
        let cancelled = 0x8007_04C7_u32 as i32;
        assert_eq!(
            shell_execute_error("runas", "C:\\x.exe", cancelled, "cancelled"),
            "Elevation was cancelled or denied for C:\\x.exe"
        );
        assert_eq!(
            shell_execute_error("open", "x", cancelled, "cancelled"),
            "ShellExecuteEx failed for x: cancelled (0x800704C7)"
        );
        assert_eq!(
            shell_execute_error("runas", "x", 0x8007_0002_u32 as i32, "not found"),
            "ShellExecuteEx failed for x: not found (0x80070002)"
        );
    }
}
