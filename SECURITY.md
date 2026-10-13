# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue. Report it privately via [GitHub Security Advisories](https://github.com/Saivelin/winautostart/security/advisories/new) with a description, steps to reproduce and the affected version. This is a spare-time project: I aim to respond within a week, but can't guarantee it.

## Scope notes

WinAutoStart launches whatever its config tells it to, with the current user's rights. The config (`%APPDATA%\WinAutoStart\config.json`) and imported preset files are trusted input — only import presets from sources you trust, the same as running a program they point to. The software is provided as is under the MIT license — see [LICENSE](LICENSE).
