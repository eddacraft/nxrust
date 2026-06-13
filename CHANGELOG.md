# Changelog

## 0.3.0 — 2026-06-14

- Per-crate target option defaults via `[package.metadata.nxrust.targets.<name>]`
  in `Cargo.toml` (e.g. `[package.metadata.nxrust.targets.test]
  all-features = true`), so per-crate tuning needs no `project.json`. A
  `toolchain` declared this way (or package-wide via
  `package.metadata.nxrust.toolchain`) feeds both the executor invocation
  (`cargo +<channel>`) and the target's cache-key runtime input
  (`rustup run <channel> rustc -Vv`), keeping toolchain updates
  cache-correct. Guard rails: the cargo `package` pin cannot be overridden,
  `fmt-check` cannot be flipped into a mutating cached target, `lint`
  follows the `clippy` table so the alias never diverges, and malformed or
  unknown entries warn and are ignored rather than breaking the graph.
  Consumer-explicit `project.json` targets still take precedence. **Minor**
  bump (D-008).

- Infer a `lint` target on every Rust crate as an exact alias of `clippy`
  (D-T4), so ecosystem-wide invocations like `nx run-many -t lint` and
  `nx affected -t lint` cover Rust crates alongside JS projects. `clippy`
  stays the canonical name; both targets share the same executor, cache
  inputs, and pinned package. Adding an inferred target name is a **minor**
  bump (D-008). This completes the inferred default target set for the
  canonical zero-`project.json` case: `build`, `check`, `clippy`, `lint`,
  `fmt`, `fmt-check`, `test`, `run` (binary crates), and
  `nx-release-publish` (publishable crates).

## 0.2.0 — 2026-06-10

- Infer Nx project `tags` from `[package.metadata.nxrust] tags = [...]` in a
  crate's `Cargo.toml`. A crate that declares the key acquires those tags on
  its inferred Nx project with no `project.json`; Nx then merges them with any
  `project.json` tags (its `mergeProjectConfigurations` unions and
  de-duplicates across sources). The table is read from the `package.metadata` that
  `cargo metadata` already emits — no separate manifest parse, so
  `cargo metadata` stays the single authoritative source. A malformed `tags`
  value (anything other than an array of strings) warns and is ignored rather
  than failing graph construction. This changes the inferred project's `tags`
  set for adopters already writing the key, hence the **minor** bump (D-008).

- Add `applyCrossLanguageTestSeam` / `severCrossLanguageTestEdge` helpers
  (exported from the package root). They sever the inherited `^build` from a
  JS project's `test` target so a JS test never triggers a transitive cargo
  build and serialises on the workspace `target/` lock — the D-WN4 contract.
  An opt-in (`consumesArtifactAtBuildTime`) retains `^build` for builds that
  genuinely import the Rust artefact at TS build time. Additive; no
  graph-shape change. Empirical anchor: eddacraft/anvil-001#1729 (46×).
- `test` target now declares `outputs: []` instead of caching the
  workspace `target/` directory. `cargo test` reuses the `target/`
  populated by `build`, so per-crate test targets do not own that
  output; snapshotting the full dir into `.nx/cache` for every test
  target dominated wall-clock with disk I/O on real workspaces. Test
  results remain cacheable by exit code. Fix ported from
  eddacraft/anvil.

## 0.1.1 — 2026-05-08

Bug fixes for two consumer-surfaced defects in 0.1.0.

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
