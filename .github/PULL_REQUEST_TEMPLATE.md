## What & why

<!-- What does this change and what problem does it solve? Link the issue if there is one. -->

## Checklist

- [ ] `npm run build` and `npm test` pass
- [ ] `cargo clippy --all-targets -- -D warnings` and `cargo test --lib` pass (in `src-tauri`)
- [ ] New or changed logic is covered by tests (Rust and/or frontend)
- [ ] If the change touches the registry, Start Menu, monitors or window placement: `cargo test --lib -- --include-ignored` passes locally
- [ ] `CHANGELOG.md` updated under **Unreleased** for user-visible changes
