# Changelog

## Unreleased

- Pin the cargo package name on every inferred target. Previously the cargo
  executor fell back to the Nx project name, so when another plugin (e.g.
  `@nx/js` for napi-rs bindings) renamed the project from the cargo crate
  name to a scoped JS package name, cargo received `-p @scope/name` and
  rejected the invocation with `unexpected prerelease field`.
- Filter executor options against a per-subcommand allowlist before
  forwarding to cargo. Nx merges unrelated CLI args (e.g. `--run`,
  `--coverage` from `nx run-many -t test` in mixed JS+Rust workspaces) into
  the test executor's options; without filtering, those landed on cargo's
  argv as `cargo test --run --coverage [object Object]`.

## 0.1.0 — 2026-05-08

Initial release.

- Executors: `build`, `check`, `clippy` (alias `lint`), `fmt`, `run`, `test`, `release-publish`.
- Generators: `init`, `crate` (with `--bin` flag), `binary`, `library`, `release-version`.
- Project-graph plugin that parses `cargo metadata` into Nx nodes and dependency edges.
- Apache-2.0 licensed.
