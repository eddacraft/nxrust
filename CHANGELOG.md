# Changelog

## 0.1.2 — Unreleased

- `test` target now declares `outputs: []` instead of caching the
  workspace `target/` directory. `cargo test` reuses the `target/`
  populated by `build`, so per-crate test targets do not own that
  output; snapshotting the full dir into `.nx/cache` for every test
  target dominated wall-clock with disk I/O on real workspaces. Test
  results remain cacheable by exit code. Fix ported from
  eddacraft/anvil.

## 0.1.0 — Unreleased

Initial release.

- Executors: `build`, `check`, `clippy` (alias `lint`), `fmt`, `run`, `test`, `release-publish`.
- Generators: `init`, `crate` (with `--bin` flag), `binary`, `library`, `release-version`.
- Project-graph plugin that parses `cargo metadata` into Nx nodes and dependency edges.
- Apache-2.0 licensed.
