//! Byte-level `.lnk` (ShellLink) target resolution — no COM, so it's cheap
//! enough for the already-running check on every launch. The canonical COM
//! parser lives in `crate::system::apps` for the Start Menu scan.

/// Minimal `.lnk` parser: extracts the LocalBasePath from the LinkInfo block,
/// preferring the Unicode variant. Returns `None` for anything malformed or
/// network-only links without a local path.
pub(super) fn resolve_lnk_target(lnk_path: &str) -> Option<String> {
    let data = std::fs::read(lnk_path).ok()?;
    if data.len() < 76 || data[0..4] != [0x4C, 0x00, 0x00, 0x00] {
        return None; // Not a valid .lnk
    }

    let flags = u32::from_le_bytes([data[20], data[21], data[22], data[23]]);
    let has_id_list = flags & 0x01 != 0;
    let has_link_info = flags & 0x02 != 0;

    let mut offset = 76usize;

    // Skip LinkTargetIDList if present
    if has_id_list {
        if offset + 2 > data.len() { return None; }
        let id_list_size = u16::from_le_bytes([data[offset], data[offset + 1]]) as usize;
        offset += 2 + id_list_size;
    }

    // Read LinkInfo to get LocalBasePath
    if has_link_info {
        if offset + 12 > data.len() { return None; }
        let link_info_size = u32::from_le_bytes([data[offset], data[offset+1], data[offset+2], data[offset+3]]) as usize;
        if link_info_size < 12 || offset + link_info_size > data.len() { return None; }

        let link_info_flags = u32::from_le_bytes([data[offset+8], data[offset+9], data[offset+10], data[offset+11]]);
        let has_local_base = link_info_flags & 0x01 != 0;

        if has_local_base {
            let header_size = u32::from_le_bytes([data[offset+4], data[offset+5], data[offset+6], data[offset+7]]) as usize;

            // LocalBasePathOffset is at offset+16 (ANSI) for headers < 0x24
            // LocalBasePathOffsetUnicode is at offset+28 for headers >= 0x24
            if header_size >= 0x24 && offset + 32 <= data.len() {
                // Unicode path
                let unicode_offset = u32::from_le_bytes([data[offset+28], data[offset+29], data[offset+30], data[offset+31]]) as usize;
                let abs = offset + unicode_offset;
                if abs < data.len() {
                    let mut chars = Vec::new();
                    let mut i = abs;
                    while i + 1 < data.len() {
                        let c = u16::from_le_bytes([data[i], data[i+1]]);
                        if c == 0 { break; }
                        chars.push(c);
                        i += 2;
                    }
                    let path = String::from_utf16_lossy(&chars);
                    if !path.is_empty() { return Some(path); }
                }
            }

            // ANSI path fallback
            if offset + 20 <= data.len() {
                let local_offset = u32::from_le_bytes([data[offset+16], data[offset+17], data[offset+18], data[offset+19]]) as usize;
                let abs = offset + local_offset;
                if abs < data.len() {
                    let end = data[abs..].iter().position(|&b| b == 0).unwrap_or(data.len() - abs);
                    let path = String::from_utf8_lossy(&data[abs..abs+end]).to_string();
                    if !path.is_empty() { return Some(path); }
                }
            }
        }
    }

    None
}

/// Path of the executable an item actually points at: `.lnk` files resolve to
/// their target, everything else is the path as given. `None` when a shortcut
/// can't be resolved — there is no real path to compare against then.
pub(super) fn exe_target_path(path: &str) -> Option<String> {
    let is_lnk = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("lnk"))
        .unwrap_or(false);
    if is_lnk {
        return resolve_lnk_target(path);
    }
    (!path.is_empty()).then(|| path.to_string())
}

/// Lowercased executable file name for a path; `.lnk` files are resolved to
/// their target first so a shortcut and its exe compare equal. An unresolvable
/// shortcut falls back to its own file name, as before.
pub(super) fn exe_name_from_path(path: &str) -> Option<String> {
    let target = exe_target_path(path).unwrap_or_else(|| path.to_string());
    std::path::Path::new(&target)
        .file_name()
        .and_then(|f| f.to_str())
        .map(|s| s.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put_u32(buf: &mut [u8], at: usize, v: u32) {
        buf[at..at + 4].copy_from_slice(&v.to_le_bytes());
    }

    /// Builds a minimal valid .lnk with LinkInfo and an ANSI LocalBasePath
    fn make_lnk_ansi(target: &str, with_id_list: bool) -> Vec<u8> {
        let mut header = vec![0u8; 76];
        header[0] = 0x4C; // magic
        let mut flags = 0x02u32; // HasLinkInfo
        if with_id_list {
            flags |= 0x01; // HasLinkTargetIDList
        }
        put_u32(&mut header, 20, flags);

        let mut data = header;
        if with_id_list {
            // IDList: size=4, then 4 junk bytes
            data.extend_from_slice(&4u16.to_le_bytes());
            data.extend_from_slice(&[0xAA; 4]);
        }

        // LinkInfo: 28-byte header (< 0x24 → ANSI branch), path right after it
        let path_bytes = target.as_bytes();
        let link_info_size = 28 + path_bytes.len() + 1;
        let mut link_info = vec![0u8; 28];
        put_u32(&mut link_info, 0, link_info_size as u32);
        put_u32(&mut link_info, 4, 28); // LinkInfoHeaderSize
        put_u32(&mut link_info, 8, 0x01); // VolumeIDAndLocalBasePath
        put_u32(&mut link_info, 16, 28); // LocalBasePathOffset
        link_info.extend_from_slice(path_bytes);
        link_info.push(0);

        data.extend_from_slice(&link_info);
        data
    }

    /// .lnk with a Unicode LocalBasePath (header 0x24 → Unicode branch)
    fn make_lnk_unicode(target: &str) -> Vec<u8> {
        let mut header = vec![0u8; 76];
        header[0] = 0x4C;
        put_u32(&mut header, 20, 0x02);

        let path_utf16: Vec<u8> = target
            .encode_utf16()
            .chain(std::iter::once(0))
            .flat_map(|c| c.to_le_bytes())
            .collect();
        let link_info_size = 36 + path_utf16.len();
        let mut link_info = vec![0u8; 36];
        put_u32(&mut link_info, 0, link_info_size as u32);
        put_u32(&mut link_info, 4, 36); // header >= 0x24
        put_u32(&mut link_info, 8, 0x01);
        put_u32(&mut link_info, 28, 36); // LocalBasePathOffsetUnicode
        link_info.extend_from_slice(&path_utf16);

        let mut data = header;
        data.extend_from_slice(&link_info);
        data
    }

    /// Temporary file, removed on Drop so it doesn't leak even if the test panics
    struct TempFile(std::path::PathBuf);

    impl Drop for TempFile {
        fn drop(&mut self) {
            std::fs::remove_file(&self.0).ok();
        }
    }

    impl TempFile {
        fn path(&self) -> &str {
            self.0.to_str().unwrap()
        }
    }

    fn write_temp(name: &str, data: &[u8]) -> TempFile {
        let path = std::env::temp_dir().join(format!("winautostart-test-{}-{name}", std::process::id()));
        std::fs::write(&path, data).unwrap();
        TempFile(path)
    }

    #[test]
    fn resolve_lnk_ansi_path() {
        let lnk = write_temp("ansi.lnk", &make_lnk_ansi(r"C:\Apps\testapp.exe", false));
        assert_eq!(
            resolve_lnk_target(lnk.path()).as_deref(),
            Some(r"C:\Apps\testapp.exe")
        );
    }

    #[test]
    fn resolve_lnk_ansi_with_id_list() {
        let lnk = write_temp("idlist.lnk", &make_lnk_ansi(r"D:\tool.exe", true));
        assert_eq!(resolve_lnk_target(lnk.path()).as_deref(), Some(r"D:\tool.exe"));
    }

    #[test]
    fn resolve_lnk_unicode_path() {
        let lnk = write_temp("uni.lnk", &make_lnk_unicode(r"C:\Программы\апп.exe"));
        assert_eq!(
            resolve_lnk_target(lnk.path()).as_deref(),
            Some(r"C:\Программы\апп.exe")
        );
    }

    #[test]
    fn resolve_lnk_rejects_garbage() {
        let lnk = write_temp("bad.lnk", b"not a shortcut at all");
        assert_eq!(resolve_lnk_target(lnk.path()), None);
    }

    #[test]
    fn resolve_lnk_rejects_truncated() {
        let mut data = make_lnk_ansi(r"C:\x.exe", false);
        data.truncate(80); // truncated LinkInfo
        let lnk = write_temp("trunc.lnk", &data);
        assert_eq!(resolve_lnk_target(lnk.path()), None);
    }

    #[test]
    fn resolve_lnk_missing_file() {
        assert_eq!(resolve_lnk_target(r"C:\nonexistent\nope.lnk"), None);
    }

    #[test]
    fn resolve_lnk_without_link_info_flag() {
        // Valid header, but HasLinkInfo is not set, so there is nothing to extract
        let mut data = vec![0u8; 76];
        data[0] = 0x4C;
        let lnk = write_temp("noinfo.lnk", &data);
        assert_eq!(resolve_lnk_target(lnk.path()), None);
    }

    #[test]
    fn resolve_lnk_without_local_base_path() {
        // LinkInfo present, but VolumeIDAndLocalBasePath flag is cleared (e.g. a network-only link)
        let mut data = make_lnk_ansi(r"C:\x.exe", false);
        put_u32(&mut data[76..], 8, 0); // link_info_flags = 0
        let lnk = write_temp("nolocal.lnk", &data);
        assert_eq!(resolve_lnk_target(lnk.path()), None);
    }

    #[test]
    fn exe_name_plain_path_lowercased() {
        assert_eq!(
            exe_name_from_path(r"C:\Program Files\App\Foo.EXE").as_deref(),
            Some("foo.exe")
        );
    }

    #[test]
    fn exe_name_resolves_lnk_target() {
        let lnk = write_temp("resolve.lnk", &make_lnk_ansi(r"C:\Apps\TestApp.exe", false));
        assert_eq!(exe_name_from_path(lnk.path()).as_deref(), Some("testapp.exe"));
    }

    #[test]
    fn exe_name_falls_back_to_the_shortcut_name() {
        // Unresolvable .lnk: take the name from the file itself, as before
        let lnk = write_temp("broken.lnk", b"not a shortcut at all");
        let expected = std::path::Path::new(lnk.path())
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_lowercase();
        assert_eq!(exe_name_from_path(lnk.path()).as_deref(), Some(expected.as_str()));
    }

    #[test]
    fn exe_target_path_keeps_plain_paths() {
        assert_eq!(
            exe_target_path(r"C:\Program Files\App\Foo.EXE").as_deref(),
            Some(r"C:\Program Files\App\Foo.EXE")
        );
        assert_eq!(exe_target_path(""), None);
    }

    #[test]
    fn exe_target_path_resolves_shortcuts() {
        let lnk = write_temp("target.lnk", &make_lnk_ansi(r"C:\Apps\TestApp.exe", false));
        assert_eq!(exe_target_path(lnk.path()).as_deref(), Some(r"C:\Apps\TestApp.exe"));
        assert_eq!(exe_target_path(r"C:\nonexistent\nope.lnk"), None);
    }
}
