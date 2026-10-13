# Contributing

Thanks for taking the time to contribute! Bug reports, ideas and pull requests are all welcome.

## Getting started

Prerequisites: Windows 10/11, [Node.js](https://nodejs.org) 20.19+ / 22.13+ / 24+ (22 LTS recommended), [Rust](https://rust-lang.org) via rustup (the toolchain pinned in `src-tauri/rust-toolchain.toml` is installed automatically) and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites) (WebView2, MSVC build tools).

```bash
npm install
npm run tauri:dev
```

## Project structure

- `src/` — React frontend, organized by Feature-Sliced Design layers: `app` → `pages` → `widgets` → `features` → `entities` → `shared`. A layer imports only from layers below it, and only through a slice's `index.ts`.
- `src-tauri/src/` — Rust backend; see the *Project layout* section of the [README](README.md).

## Tests

Every change in behavior comes with tests — Rust (`#[cfg(test)]` modules next to the code) and/or frontend (vitest + Testing Library, Tauri APIs mocked).

```bash
npm test                                   # frontend
npm run build                              # typecheck + frontend build
cd src-tauri
cargo clippy --all-targets -- -D warnings
cargo test --lib                           # unit tests (what CI runs)
cargo test --lib -- --include-ignored      # + integration tests, see below
```

Tests that touch the live system are marked `#[ignore = "integration: ..."]`: they write a temporary value to `HKCU\...\Run` (cleaned up afterwards), scan the Start Menu, read installed browsers, enumerate monitors or move real windows. CI skips them; run them locally before submitting changes in those areas.

## Pull requests

- Keep a PR focused on one change; describe what and why.
- Code comments are in English and explain *why*, not *what*.
- CI must be green: typecheck, frontend tests, clippy with `-D warnings`, Rust unit tests.
- Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for user-visible changes.

## Releasing (maintainers)

`package.json` holds the version: `tauri.conf.json` reads it directly and `npm version` syncs `src-tauri/Cargo.toml` via `scripts/sync-version.mjs`.

1. Move the **Unreleased** entries in `CHANGELOG.md` under the new version, add its `[X.Y.Z]: …/compare/…` link at the bottom (and repoint `[Unreleased]`), and commit — `npm version` refuses to run on a dirty working tree.
2. `npm version <patch|minor|major>` — bumps the version, syncs Cargo.toml/Cargo.lock, commits and tags `vX.Y.Z`.
3. `git push --follow-tags` — the *Release* workflow builds the MSI and NSIS installers and attaches them, plus a `SHA256SUMS.txt`, to a draft GitHub release. The release body is that version's section of `CHANGELOG.md` (`scripts/changelog-section.mjs`) followed by the install notes — a tag without a changelog section fails the workflow before building. Review the draft and publish.

Versions are plain `X.Y.Z`: WiX (MSI) does not accept pre-release suffixes, and the release workflow only triggers on such tags. The very first release is already at `1.0.0`, so it is tagged by hand: `git tag v1.0.0 && git push --tags`.
