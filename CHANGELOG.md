# Changelog

All notable changes to this project are documented here. The format is based on Keep a Changelog, and the project follows Semantic Versioning.

## [Unreleased]

## [1.0.0] - 2026-10-13

First public release.

### Added
- Presets of apps and websites with a name, color and icon; one of them can launch automatically after a countdown on startup.
- App launching with arguments, optional elevation (UAC) and skipping apps that are already running.
- Website launching in the default or a chosen browser, optionally in private mode.
- Window placement per item on a chosen monitor, edited visually on a monitor map.
- Per-item launch delays and a live per-item launch progress list with errors.
- "Switch & Close" (asks apps to close, force-closes after 3 s) and "Switch & Minimize" for the previous preset.
- System tray with per-preset launch, close-to-tray, single instance.
- Configurable global show/focus hotkey (default `Ctrl+Alt+W`), can be turned off.
- Windows autostart via `HKCU\...\Run` (no admin rights).
- Preset import/export to JSON.
- Diagnostics log in `%APPDATA%\WinAutoStart\log.txt`.
- Branded NSIS installer (English/Russian, per-user, no admin rights) that removes the autostart entry on uninstall and can optionally remove presets and the log; MSI package as an alternative.

### Security
- Website items only open `http`/`https` URLs (validated with the `url` crate); a URL without a scheme gets `https://`, local paths and other schemes are rejected.
- Strict Content Security Policy for the webview.

[Unreleased]: https://github.com/Saivelin/winautostart/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Saivelin/winautostart/releases/tag/v1.0.0
