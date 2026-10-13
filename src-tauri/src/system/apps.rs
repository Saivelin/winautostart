//! Data source for the "select from installed apps" picker: scans Start Menu
//! shortcuts (per-user and system-wide) and extracts small icons as
//! base64 BMP data-URLs, hand-rolled to avoid image crates for a 16x16 icon.

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::util::{to_wide_null, wide_to_string, ComApartment};

use windows::core::PCWSTR;
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER, STGM};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

/// Recursively scans both Start Menu `Programs` folders (`%APPDATA%` and
/// `%ProgramData%`) for `.lnk` shortcuts pointing at `.exe` files. Deduped by
/// target path (user entries win — they're scanned first), sorted by name.
#[tauri::command]
pub fn get_start_menu_apps() -> Vec<InstalledApp> {
    let _com = ComApartment::enter();
    let mut apps = Vec::new();
    let mut seen = HashSet::new();

    // User entries first so they win the dedup against system-wide ones
    for base_var in ["APPDATA", "ProgramData"] {
        if let Ok(base) = std::env::var(base_var) {
            let start_menu =
                PathBuf::from(base).join(r"Microsoft\Windows\Start Menu\Programs");
            scan_shortcuts(&start_menu, &mut apps, &mut seen);
        }
    }

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

fn scan_shortcuts(dir: &Path, apps: &mut Vec<InstalledApp>, seen: &mut HashSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_shortcuts(&path, apps, seen);
        } else if path.extension().and_then(|e| e.to_str()) == Some("lnk") {
            if let Some(app) = read_lnk_target(&path) {
                let key = app.path.to_lowercase();
                if seen.insert(key) {
                    apps.push(app);
                }
            }
        }
    }
}

/// Resolves a shortcut's target via COM `IShellLinkW` (the canonical parser —
/// unlike the byte-level one in `launcher/lnk.rs`, which avoids COM on a hot
/// path). Non-exe targets are filtered out; the display name is the `.lnk`
/// filename without its extension.
///
/// Expects the calling thread to already be in a COM apartment — see
/// `ComApartment`, entered once per scan by `get_start_menu_apps`.
fn read_lnk_target(lnk_path: &Path) -> Option<InstalledApp> {
    unsafe {
        let shell_link: IShellLinkW =
            CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;

        let persist_file: windows::Win32::System::Com::IPersistFile =
            windows::core::Interface::cast(&shell_link).ok()?;

        let wide_path = to_wide_null(lnk_path.to_str()?);
        persist_file
            .Load(PCWSTR(wide_path.as_ptr()), STGM(0))
            .ok()?;

        let mut target_buf = [0u16; 260];
        let mut fd: windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW = std::mem::zeroed();
        shell_link
            .GetPath(
                &mut target_buf,
                &mut fd as *mut _,
                0,
            )
            .ok()?;

        let target = wide_to_string(&target_buf);

        if target.is_empty() {
            return None;
        }

        // Only include executables
        let lower = target.to_lowercase();
        if !lower.ends_with(".exe") {
            return None;
        }

        let name = lnk_path.file_stem()?.to_str()?.to_string();
        Some(InstalledApp {
            name,
            path: target,
            icon: None,
        })
    }
}

/// 16x16 icon of an executable as a `data:image/bmp;base64,...` URL, or
/// `None` when the shell has no icon for the path. Called lazily by the
/// frontend as picker rows scroll into view.
#[tauri::command]
pub fn get_app_icon(path: String) -> Option<String> {
    extract_icon_base64(&path)
}

fn extract_icon_base64(exe_path: &str) -> Option<String> {
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };
    use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_SMALLICON};
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

    unsafe {
        let wide_path = to_wide_null(exe_path);
        let mut info: SHFILEINFOW = std::mem::zeroed();
        let result = SHGetFileInfoW(
            PCWSTR(wide_path.as_ptr()),
            windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL,
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_SMALLICON,
        );
        if result == 0 || info.hIcon.is_invalid() {
            return None;
        }

        let mut icon_info: ICONINFO = std::mem::zeroed();
        if GetIconInfo(info.hIcon, &mut icon_info).is_err() {
            DestroyIcon(info.hIcon).ok();
            return None;
        }

        let size: i32 = 16;
        let hdc = CreateCompatibleDC(None);

        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = size;
        bmi.bmiHeader.biHeight = -size; // top-down
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB.0;

        let pixel_count = (size * size * 4) as usize;
        let mut pixels = vec![0u8; pixel_count];

        let lines = GetDIBits(
            hdc,
            icon_info.hbmColor,
            0,
            size as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        let _ = DeleteDC(hdc);
        let _ = DestroyIcon(info.hIcon);
        if !icon_info.hbmColor.is_invalid() { let _ = DeleteObject(icon_info.hbmColor); }
        if !icon_info.hbmMask.is_invalid() { let _ = DeleteObject(icon_info.hbmMask); }

        if lines == 0 {
            return None;
        }

        // Convert BGRA to BMP format (already BGRA, just need BMP headers)
        let bmp = create_bmp(&pixels, size as u32, size as u32);
        let b64 = base64_encode(&bmp);
        Some(format!("data:image/bmp;base64,{}", b64))
    }
}

/// Wraps raw BGRA pixels in BMP file + DIB headers (32bpp, top-down).
fn create_bmp(pixels: &[u8], width: u32, height: u32) -> Vec<u8> {
    let row_size = width * 4;
    let pixel_data_size = row_size * height;
    let file_size = 54 + pixel_data_size;

    let mut bmp = Vec::with_capacity(file_size as usize);

    // BMP file header (14 bytes)
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&file_size.to_le_bytes());
    bmp.extend_from_slice(&[0u8; 4]); // reserved
    bmp.extend_from_slice(&54u32.to_le_bytes()); // pixel data offset

    // DIB header (40 bytes)
    bmp.extend_from_slice(&40u32.to_le_bytes()); // header size
    bmp.extend_from_slice(&(width as i32).to_le_bytes());
    bmp.extend_from_slice(&(-(height as i32)).to_le_bytes()); // top-down
    bmp.extend_from_slice(&1u16.to_le_bytes()); // planes
    bmp.extend_from_slice(&32u16.to_le_bytes()); // bits per pixel
    bmp.extend_from_slice(&[0u8; 24]); // rest of DIB header (compression=0, etc.)

    // Pixel data (already BGRA from GetDIBits)
    bmp.extend_from_slice(&pixels[..pixel_data_size as usize]);

    bmp
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- base64_encode: canonical RFC 4648 vectors ---

    #[test]
    fn base64_rfc_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn base64_binary_data() {
        assert_eq!(base64_encode(&[0x00, 0xFF, 0x80]), "AP+A");
    }

    // --- create_bmp: header layout ---

    #[test]
    fn bmp_header_layout() {
        let pixels = vec![0u8; 16 * 16 * 4];
        let bmp = create_bmp(&pixels, 16, 16);

        assert_eq!(&bmp[0..2], b"BM");
        let file_size = u32::from_le_bytes(bmp[2..6].try_into().unwrap());
        assert_eq!(file_size as usize, bmp.len());
        assert_eq!(bmp.len(), 54 + pixels.len());

        let data_offset = u32::from_le_bytes(bmp[10..14].try_into().unwrap());
        assert_eq!(data_offset, 54);

        let dib_size = u32::from_le_bytes(bmp[14..18].try_into().unwrap());
        assert_eq!(dib_size, 40);

        let width = i32::from_le_bytes(bmp[18..22].try_into().unwrap());
        let height = i32::from_le_bytes(bmp[22..26].try_into().unwrap());
        assert_eq!(width, 16);
        assert_eq!(height, -16); // top-down

        let bpp = u16::from_le_bytes(bmp[28..30].try_into().unwrap());
        assert_eq!(bpp, 32);
    }

    #[test]
    fn bmp_pixel_data_copied() {
        let mut pixels = vec![0u8; 2 * 2 * 4];
        pixels[0] = 0xDE;
        pixels[15] = 0xAD;
        let bmp = create_bmp(&pixels, 2, 2);
        assert_eq!(&bmp[54..], &pixels[..]);
    }

    // --- integration: live Start Menu (don't run in headless CI) ---

    #[test]
    #[ignore = "integration: scans the live Start Menu"]
    fn start_menu_apps_sorted_unique_exe_only() {
        let apps = get_start_menu_apps();
        // Real Windows always has something installed
        assert!(!apps.is_empty());

        let mut seen = std::collections::HashSet::new();
        for pair in apps.windows(2) {
            assert!(
                pair[0].name.to_lowercase() <= pair[1].name.to_lowercase(),
                "not sorted: {} > {}", pair[0].name, pair[1].name
            );
        }
        for app in &apps {
            assert!(app.path.to_lowercase().ends_with(".exe"), "not exe: {}", app.path);
            assert!(seen.insert(app.path.to_lowercase()), "duplicate: {}", app.path);
            assert!(!app.name.is_empty());
        }
    }

    #[test]
    #[ignore = "integration: scans the live Start Menu"]
    fn repeated_scans_keep_working() {
        // Checks CoInitializeEx/CoUninitialize balance: if it went negative,
        // the second scan would have no apartment and return an empty list
        let first = get_start_menu_apps();
        let second = get_start_menu_apps();
        assert!(!second.is_empty());
        assert_eq!(first.len(), second.len());
    }

    #[test]
    fn get_app_icon_missing_file_does_not_panic() {
        // Smoke: the result doesn't matter (None or a generic icon), it just must not fail
        let _ = get_app_icon(r"C:\definitely\not\here.exe".into());
    }
}
