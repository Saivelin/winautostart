//! Shared Win32 helpers: UTF-16 string conversions and a COM apartment guard.

use windows::Win32::System::Com::{
    CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
};

/// Null-terminated UTF-16 copy of `s` for passing to W-suffixed Win32 APIs.
pub(crate) fn to_wide_null(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// String from a fixed-size UTF-16 buffer, dropping the trailing NULs Win32
/// APIs leave in place.
pub(crate) fn wide_to_string(buf: &[u16]) -> String {
    String::from_utf16_lossy(buf).trim_end_matches('\0').to_string()
}

/// COM apartment for the current thread while the guard lives. Needed by the
/// Start Menu scan (`IShellLinkW`) and by `ShellExecute*`, which may hand off to
/// COM-based handlers; commands run on async-runtime worker threads that never
/// entered an apartment. `CoInitializeEx` bumps a per-thread counter that
/// `CoUninitialize` has to bring back down, so every successful enter is
/// balanced on drop.
pub(crate) struct ComApartment {
    initialized: bool,
}

impl ComApartment {
    pub(crate) fn enter() -> Self {
        // S_FALSE means the thread already had an apartment — the counter is
        // still incremented, so it needs the matching CoUninitialize too.
        // Only a hard failure (e.g. RPC_E_CHANGED_MODE) must not be balanced.
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
        ComApartment { initialized: hr.is_ok() }
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.initialized {
            unsafe { CoUninitialize() };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_wide_null_appends_terminator() {
        assert_eq!(to_wide_null("ab"), vec![97, 98, 0]);
        assert_eq!(to_wide_null(""), vec![0]);
    }

    #[test]
    fn wide_to_string_trims_trailing_nuls() {
        let buf: Vec<u16> = "abc\0\0\0".encode_utf16().collect();
        assert_eq!(wide_to_string(&buf), "abc");
    }

    #[test]
    fn wide_to_string_empty_buffer() {
        assert_eq!(wide_to_string(&[]), "");
        assert_eq!(wide_to_string(&[0, 0]), "");
    }

    #[test]
    fn wide_to_string_keeps_unicode() {
        let buf: Vec<u16> = "Программы\0".encode_utf16().collect();
        assert_eq!(wide_to_string(&buf), "Программы");
    }
}
