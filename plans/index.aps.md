<!-- APS Index -->
<!-- Status: Complete -->

# nxrust — Nx 22 plugin for Rust

| Field | Value |
|-------|-------|
| Status | Complete |
| Owner | eddacraft |
| Created | 2026-04-21 |
| Licence | Apache-2.0 |

## Problem

Teams that run Rust crates inside an Nx monorepo have two off-the-shelf
options and both are unacceptable for production use:

- **`@monodon/rust`** — the only community Nx plugin of the right
  shape, but effectively unmaintained: the published package pins
  `@nx/devkit >= 19 < 21` (no Nx 22 support), recent releases ship
  with `0.0.0-…` version tags, and the open-issue backlog has not
  moved in over a year. Licence is MIT — Apache-2.0-compatible, so
  monodon code may be borrowed with attribution where it saves real
  time.
- **`cargo-make`** — a Rust-only task runner. Does not orchestrate the
  TypeScript side of a mixed monorepo, does not integrate with remote
  caches such as `@nx/azure-cache`, does not provide `nx affected`.

`nxrust` is an Apache-2.0-licensed, Nx 22 native plugin published to
npm — a maintained alternative to `@monodon/rust` for mixed
TypeScript + Rust monorepos.

## Success Criteria

- [x] Plugin compiles against `@nx/devkit ^22.6.5` with TypeScript strict
- [x] Executors wrap cargo for `build`, `test`, `check`, `clippy`, `fmt`,
      `run`, `release-publish`
- [x] Generators: `init`, `library`, `binary`, `crate`, `release-version`
- [x] Project-graph plugin (`createNodesV2` + `createDependencies`) emits
      Rust crate nodes + cross-crate edges from `cargo metadata`
- [x] Unit test suite green via Vitest
- [x] Review findings addressed or documented
- [x] End-to-end validation against a real Rust crate in a real Nx 22
      workspace passes and caches
- [x] Rollout to every crate in the validation workspace completes green on
      `nx run-many`
- [x] CI smoke test job in nxrust + dependent-repo smoke in the validation
      workspace
- [x] First `@eddacraft/nxrust@0.1.0` published to npm

## Constraints

- **Apache-2.0** across nxrust's own code. Monodon MIT code may be
  borrowed where useful, with per-file attribution and a
  `THIRD-PARTY-NOTICES.md` at repo root preserving the MIT terms.
- Nx **22.x** target. No back-support for Nx 19/20/21 in v0.1.
- Cargo stays the build engine. This plugin wraps invocation only —
  it never re-implements compilation or dependency resolution.
- Must work locally without remote-cache credentials — cache miss,
  not failure.
- UK English in plan and README text; user-facing CLI output stays
  locale-neutral.
- Zero regressions on the validation consumer: every
  `cargo check/test/clippy/fmt` invocation that passed before must
  still pass after the plugin wraps it.

## Modules

| Module | Purpose | Status | Dependencies |
|--------|---------|--------|--------------|
| [01-v0.1-shakedown](./modules/01-v0.1-shakedown.aps.md) | Prove the plugin end-to-end on a consumer workspace, ship first npm release | Complete | — |

Deferred (not yet active modules):

- **02-monodon-parity** (proposed) — catch up on executors/generators
  present in `@monodon/rust` that nxrust does not yet cover: `napi`,
  `wasm-pack`, `add-napi`, `add-wasm`, `add-wasm-reference`,
  `create-napi-npm-dirs`, `preset`. Borrow monodon's implementations
  where they fit (MIT, attribution required). Promote to active only
  if a real consumer asks.
- **03-v0.2-polish** (proposed) — items surfaced in review but out of
  v0.1 scope: glob edge cases in workspace-member matching,
  `cargo-nextest` executor, `bench` executor for Criterion, dedicated
  library-only preset, project-key vs cargo-name divergence handling.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `target/` caching yields stale artefacts under remote cache | high | Narrow `outputs` — cache test/clippy reports and binaries, not the whole `target/` tree; verify second-run cache hits before rollout. **Resolved 2026-05-12** for `test` (now `outputs: []`); `build` retains `target/` outputs deliberately. |
| Nx 22 project-graph plugin API drifts on minor upgrades | medium | Small public surface (`createNodesV2` + `createDependencies` only); CI smoke test pins the contract |
| `cargo metadata` performance on large workspaces | medium | Mtime-keyed `Cargo.lock` cache already in `graph.ts`; re-evaluate if validation hits a slowdown |
| Consumer switchover breaks the consumer's pnpm graph mid-flight | medium | Switch only after validation + rollout + CI smoke are all green; keep a revert commit ready |

## Open Questions

- [x] Final npm scope for v0.1 publish — use scoped
      `@eddacraft/nxrust`. The package is published under the eddacraft
      npm organisation.
- [ ] Keep the `release-publish` executor in v0.1, or defer until a
      crate actually publishes to crates.io? Implemented and tested —
      keep it, but document as "unvalidated against a real crates.io
      token" until a consumer exercises it.
- [ ] Should the project-graph plugin emit external nodes for workspace
      dev-dependencies, or only runtime deps? Current behaviour skips
      `kind === 'dev'`; revisit if `nx affected -t test` misses edges
      in validation.

## Decisions

- **D-001:** Fork vs rewrite vs borrow — primary implementation is
  written fresh against `@nx/devkit` and public cargo docs. Borrowing
  from `@monodon/rust` (MIT) is permitted where it saves real time;
  borrowed code gets a top-of-file attribution comment and a
  `THIRD-PARTY-NOTICES.md` entry preserving the MIT notice.
  *Revised 2026-04-21 — previously "clean-room only".*
- **D-002:** Licence — Apache-2.0 (not MIT). Explicit patent grant.
  *Accepted.*
- **D-003:** Nx version floor — `@nx/devkit ^22.6.5`. No back-support
  for Nx 19/20/21. Consumers on older Nx stay on `@monodon/rust`.
  *Accepted.*
- **D-004:** Build target — CommonJS to `./dist`. Nx devkit plugins are
  consumed by Nx's Node runtime; ESM offers no win here.
  *Accepted.*
- **D-005:** Distribution channel — publish `@eddacraft/nxrust` to npm,
  not crates.io.
  Nx plugins are JavaScript packages discovered through npm metadata
  (`executors.json`, `generators.json`, and JS entrypoints). Cargo/crates.io
  remains relevant for Rust consumers, not for this Nx plugin.
  *Accepted 2026-05-07.*
