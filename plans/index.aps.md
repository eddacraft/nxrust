<!-- APS Index -->
<!-- Status: In Progress -->

# nxrust — Nx 22 plugin for Rust

| Field | Value |
|-------|-------|
| Status | In Progress |
| Owner | @joshuaboys |
| Created | 2026-04-21 |
| Licence | Apache-2.0 |

## Problem

Teams that run Rust crates inside an Nx monorepo have two off-the-shelf
options and both are unacceptable for production use:

- **`@monodon/rust`** (`~/Projects/src/monodon`) — the only community Nx
  plugin of the right shape, but effectively unmaintained: the
  published package pins `@nx/devkit >= 19 < 21` (no Nx 22 support),
  recent releases ship with `0.0.0-…` version tags, and the
  open-issue backlog has not moved in over a year. Licence is MIT
  (declared in `package.json`; no separate `LICENSE` file) —
  Apache-2.0-compatible, so monodon code may be borrowed with
  attribution where it saves real time.
- **`cargo-make`** — a Rust-only task runner. Does not orchestrate the
  TypeScript side of a mixed monorepo, does not integrate with
  `@nx/azure-cache`, does not provide `nx affected`.

EddaCraft's `anvil-001` monorepo has 9 Rust crates that need Nx-native
execution so `nx affected` and the Azure remote cache apply to the Rust
side the same way they already do for TypeScript. The anvil plan
`rust-nx-migration.aps.md` (RUSTNX-004..008) depends on a working Nx
plugin; the anvil plan `nx-rust-plugin.aps.md` (NXRUST-001..008) began
that plugin inside the anvil repo under `tools/nx-rust/`.

`nxrust` is the extraction of that in-repo plugin into a standalone,
Apache-2.0-licensed, Nx 22 package published to npm. It replaces
`@monodon/rust` for EddaCraft and is offered under an OSI-approved
licence for anyone else caught in the same bind.

## Success Criteria

- [x] Plugin compiles against `@nx/devkit ^22.6.5` with TypeScript strict
- [x] Executors wrap cargo for `build`, `test`, `check`, `clippy`, `fmt`,
      `run`, `release-publish`
- [x] Generators: `init`, `library`, `binary`, `crate`, `release-version`
- [x] Project-graph plugin (`createNodesV2` + `createDependencies`) emits
      Rust crate nodes + cross-crate edges from `cargo metadata`
- [x] Unit test suite green via Vitest
- [x] Council + adversarial review findings addressed or documented
- [ ] End-to-end pilot against a real Rust crate (anvil-kernel-types)
      passes and caches
- [ ] Rollout to all 9 anvil crates completes green on `nx run-many`
- [ ] Smoke test job in nxrust's own CI + in anvil's `rust.yml`
- [ ] First `@eddacraft/nx-rust@0.1.0` (or chosen scope) published to npm
- [ ] Anvil's `rust-nx-migration.aps.md` RUSTNX-004/005 updated to
      consume the published package; anvil switches off the pnpm
      workspace-protocol link; NXRUST-005..008 in anvil closed out

## Constraints

- **Apache-2.0** across nxrust's own code. Monodon MIT code may be
  borrowed where useful, with per-file attribution and a
  `THIRD-PARTY-NOTICES.md` at repo root preserving the MIT terms.
- Nx **22.x** target. No back-support for Nx 19/20/21 in v0.1.
- Cargo stays the build engine. This plugin wraps invocation only —
  never re-implements compilation or dependency resolution.
- Must work locally without Azure (or any) remote cache credentials —
  cache miss, not failure.
- UK English in all plan and README text (matches anvil convention);
  user-facing CLI output is locale-neutral.
- Zero regressions for any crate that switches over: every
  `cargo check/test/clippy/fmt` invocation that passed before must still
  pass after the plugin wraps it.

## Modules

| Module | Purpose | Status | Dependencies |
|--------|---------|--------|--------------|
| [01-v0.1-shakedown](./modules/01-v0.1-shakedown.aps.md) | Prove the plugin end-to-end on anvil, ship first npm release, close out anvil's NXRUST work items | In Progress | — |

Deferred (not yet active modules):

- **02-monodon-parity** (proposed) — catch up on executors/generators
  present in `@monodon/rust` that nxrust does not yet cover: `napi`,
  `wasm-pack`, `add-napi`, `add-wasm`, `add-wasm-reference`,
  `create-napi-npm-dirs`, `preset`. Borrow monodon's implementations
  where they fit (MIT, attribution required). Only promote to active if
  a real consumer asks.
- **03-v0.2-polish** (proposed) — items surfaced in review but out of
  v0.1 scope: glob edge cases in workspace-member matching,
  `cargo-nextest` executor, `bench` executor for Criterion, dedicated
  library-only preset, project-key vs cargo-name divergence handling.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `target/` caching yields stale artefacts under Nx remote cache | high | Narrow `outputs` — cache test/clippy reports and binaries, not the whole `target/` tree; verify second-run cache hits on pilot crate before rollout |
| Nx 22 project-graph plugin API drifts on minor upgrades | medium | Small public surface (`createNodesV2` + `createDependencies` only); CI smoke test pins the contract; Nx upgrade runbook item checks the plugin still builds |
| `cargo metadata` performance on large workspaces | medium | Mtime-keyed `Cargo.lock` cache already in `graph.ts`; re-evaluate if anvil hits a slowdown |
| Package name collision on npm (`@eddacraft/nx-rust` vs unscoped `nxrust`) | low | Publish under `@eddacraft` scope first; reserve `nxrust` unscoped only if scope-free publish becomes desirable |
| Anvil switchover breaks pnpm workspace graph mid-flight | medium | Switch only after pilot + rollout + CI smoke are all green; keep a revert commit ready |

## Open Questions

- [ ] Publish under `@eddacraft/nx-rust` (scoped, matches anvil) or
      unscoped `nxrust` (matches repo name, no scope gate)? Default:
      scoped for v0.1, re-evaluate at v0.2.
- [ ] Keep the `release-publish` executor in v0.1, or defer until a
      crate actually publishes to crates.io? It's implemented and
      tested — keep it, but document it as "unvalidated against a real
      crates.io token" until a consumer exercises it.
- [ ] Should the project-graph plugin emit external nodes for workspace
      dev-dependencies, or only runtime deps? Current behaviour skips
      `kind === 'dev'`; revisit if `nx affected -t test` misses edges
      in the pilot.

## Decisions

- **D-001:** Fork vs rewrite vs borrow — primary implementation is
  written fresh against `@nx/devkit` and public cargo docs. Borrowing
  from `@monodon/rust` (MIT) is permitted where it saves real time;
  borrowed code gets a top-of-file attribution comment and a
  `THIRD-PARTY-NOTICES.md` entry preserving the MIT notice.
  *Revised 2026-04-21 — previously "clean-room only".*
- **D-002:** Licence — Apache-2.0 (not MIT). Matches EddaCraft
  preference for explicit patent grant. *Accepted.*
- **D-003:** Nx version floor — `@nx/devkit ^22.6.5`. No back-support
  for Nx 19/20/21. Consumers on older Nx stay on `@monodon/rust`.
  *Accepted.*
- **D-004:** Build target — CommonJS to `./dist`. Nx devkit plugins are
  consumed by Nx's Node runtime; ESM offers no win here.
  *Accepted.*
