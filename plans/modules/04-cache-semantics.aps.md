<!-- APS Module: 04-cache-semantics -->
<!-- Status: Complete -->

# Cache Semantics

Cache-correctness for Rust tasks: named inputs, environment hashing, and
conservative output narrowing.

| ID    | Owner     | Status                                            |
| ----- | --------- | ------------------------------------------------- |
| CACHE | eddacraft | Complete (CACHE-001..003 shipped; CACHE-004 Done 2026-06-21, unreleased) |

## Purpose

Rust caching is notoriously easy to get wrong. v0.1 already narrowed the
`test` target's outputs after a real consumer regression (CHANGELOG 0.2.0
entry — `outputs: []` for `test`). Spec §6.4 lays out the broader contract:
named inputs reusable across targets, environment-variable hashing for
toolchain/build-affecting vars, target-triple and toolchain version
participation in the cache key, and conservative per-target output rules.

This module codifies the cache contract. It is the foundation for trusting
remote cache hits, and it must land before any further `target/`-aware
caching is added in later modules.

## In Scope

**Named inputs (spec §6.4):**

- `rustSources`:
  ```
  {projectRoot}/src/**/*.rs
  {projectRoot}/tests/**/*.rs
  {projectRoot}/benches/**/*.rs
  {projectRoot}/examples/**/*.rs
  {projectRoot}/build.rs
  {projectRoot}/Cargo.toml
  ```
- `rustWorkspace`:
  ```
  {workspaceRoot}/Cargo.toml
  {workspaceRoot}/Cargo.lock
  {workspaceRoot}/rust-toolchain.toml
  {workspaceRoot}/.cargo/config.toml
  ```
- Registered as `namedInputs` in `nx.json` by the plugin or by the
  [`init`](./07-generators.aps.md) generator.

**Environment-variable hashing:**

- Documented set of build-affecting env vars participates in the cache
  key: `RUSTFLAGS`, `RUSTDOCFLAGS`, `CARGO_TARGET_DIR`,
  `CARGO_BUILD_TARGET`, `CARGO_PROFILE_RELEASE_LTO`,
  `CARGO_PROFILE_RELEASE_CODEGEN_UNITS`, `CC`, `CXX`, `AR`,
  `PKG_CONFIG_PATH`, `OPENSSL_DIR`.
- Implemented via Nx's `inputs: [{ "env": "..." }]` entries in the
  inferred targets.
- Configurable allowlist via plugin option for non-default env vars
  consumer workspaces care about.

**Per-target output rules (spec §6.4 table):**

| Target            | Default `outputs`                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `check`           | `[]` (result-cached only)                                                                |
| `clippy` / `lint` | `[]` (or `clippy.json` if requested)                                                     |
| `fmt-check`       | `[]`                                                                                     |
| `test`            | `[]` (per v0.2.0 fix); test reports cached when configured                               |
| `build`           | `{workspaceRoot}/target/{profile}/<binary>` only when safe — narrow, not whole `target/` |
| `doc`             | `{workspaceRoot}/target/doc`                                                             |
| `run`             | not cached                                                                               |
| `release-publish` | not cached                                                                               |

**CI fixture matrix (spec §8.1):**

- A matrix in nxrust CI exercises the cache rules against representative
  workspace shapes (single-crate, multi-crate, dev-dep, build-dep,
  feature-gated, mixed TS+Rust).
- The matrix fails loudly on a cache-key regression — the second run of
  any cacheable target on unchanged inputs must hit the cache.

## Out of Scope

- Toolchain hashing details (`rustc -Vv`, `cargo -V`, `rust-toolchain.toml`
  content) — that's [06-toolchain-awareness](./06-toolchain-awareness.aps.md).
- Affected-set behaviour after input changes — that's
  [13-affected-refinement](./13-affected-refinement.aps.md).
- Cache for new executors (audit, deny, nextest, bench) — those modules
  follow this module's rules by reference.
- Re-implementing Cargo's incremental compilation cache. Cargo's `target/`
  is its own world.

## Interfaces

### Depends On

- Nx's `namedInputs`, `inputs`, `outputs`, `env` semantics in
  `@nx/devkit ^22.6.5`.
- [03-target-inference](./03-target-inference.aps.md) — inferred targets
  reference the named inputs here.
- [06-toolchain-awareness](./06-toolchain-awareness.aps.md) — toolchain
  version contributions to the cache key.

### Exposes

- A documented `rustSources` and `rustWorkspace` named-input contract.
- A documented env-var allowlist for cache participation.
- Per-target `outputs` defaults that the rest of the modules inherit.
- A CI fixture matrix that other modules' cache-touching changes hook
  into.

## Constraints

- **Conservative by default.** If a `target/` artefact embeds absolute
  paths, host info, or build-time env, it is not cached without an
  explicit per-target opt-in.
- **Toolchain participates in the cache key.** No cache hit is valid if
  the toolchain that produced it differs from the toolchain that would
  produce a fresh run. Enforced via
  [06-toolchain-awareness](./06-toolchain-awareness.aps.md).
- **Env-var participation is documented.** Anything in the allowlist is
  hashed; anything outside is ignored. The list is not a discovery
  exercise per consumer.
- **Cache-touching changes bump the minor version.** Output-rule changes
  invalidate prior caches and consumers should be able to pin patch
  versions safely. Inherits D-008.

## Ready Checklist

Promote individual Work Items to Ready when:

- [ ] A real consumer hits a false cache hit, false cache miss, or
      cache-correctness incident (per D-007).
- [ ] The failing inputs are captured (workspace shape, env vars set,
      target invoked).
- [ ] A Work Item is drafted scoped to that incident.
- [ ] A fixture for the failing case is added or planned for the CI
      matrix.

## Work Items

### CACHE-001 — Rust cache input wiring

**Status: Done** (PR #15 merged 2026-05-29).

New `src/utils/cache-inputs.ts` (named-input refs + env allowlist +
per-target `rustup run <channel>` runtime entries via `resolveToolchain`)
applied through every emitted target in `target-configs.ts`; `init`
registers the named inputs in `nx.json` with a divergence diagnostic.

Review-round fixes (2026-05-29):

- `init` now merges via devkit `readNxJson`/`updateNxJson` (JSONC-safe;
  skips the write when nothing changed) instead of raw `JSON.parse`/
  `tree.write`.
- e2e smoke now runs the `init` generator before graph load — see D-C5.

### CACHE-002 — Narrow rust build outputs

**Status: Done** (rebased onto main; landing via the cache-completion PR).

`build` targets now declare narrow per-binary (`{workspaceRoot}/target/
{profile}/<bin>`) and per-rlib (`lib<crate>.rlib`) outputs instead of the
whole `{workspaceRoot}/target` tree, for both `debug` and `release`
profiles. `src/utils/cache-inputs.ts` gains `buildCacheOutputs`; `graph.ts`
derives the binary/library set per package from `cargo metadata` and threads
a `narrowBuildOutputs` plugin option through `createNodesV2`/
`createDependencies` (participating in the metadata cache key). A wide-output
escape hatch (`{options.target-dir}` + `{workspaceRoot}/target`) is retained
for the unsafe cases: `narrowBuildOutputs: false`, custom target-dir or
target triple, and crate types beyond `lib`/`rlib`/`bin` (e.g. `cdylib`,
`staticlib`, `proc-macro`). Resolves the build-output open question. See D-C6.

### CACHE-003 — Cache-correctness CI fixture matrix

**Status: Done** (landing via the cache-completion PR).

`tools/cache-matrix.mjs` + the `e2e/cache-matrix/` fixture exercise the
inferred cacheable targets (`check`, `fmt-check`, `clippy`, `test`, `build`)
across representative workspace shapes — single-crate (`solo`), multi-crate
with a cross-crate normal dep (`engine` + `app`), dev-dep (`with-dev-dep`),
build-dep (`with-build-dep`), feature-gated (`featured`), and mixed TS+Rust
(`ts-app`). The harness packs the plugin, runs `init`, then asserts every
cacheable target **misses on first run and hits on the second run** with
unchanged inputs, failing loudly with the offending `project:target` pairs on
any regression. Wired into CI as a parallel `cache-matrix` job and the
`pnpm cache-matrix` script. All path-dependencies keep the matrix hermetic
(no registry/network access). Satisfies spec §8.1 "add CI fixture matrix".

### CACHE-004 — Relocation-aware build output caching (`CARGO_TARGET_DIR`)

**Status: Done** (2026-06-21, unreleased — Anvil's #1 upstream ask; tracks
Anvil DEVENV-003. First build slice under D-011.)

`buildCacheOutputs` (`src/utils/cache-inputs.ts`) now roots narrow per-binary /
per-rlib outputs at a `targetDirRoot` token (default `{workspaceRoot}/target`).
`buildTargetConfig` (`src/utils/target-configs.ts`) roots them at
`{options.target-dir}` when a `--target-dir` option is set, and `graph.ts`
resolves a `CARGO_TARGET_DIR` env relocation at inference time
(`resolveEnvTargetDirRoot`) — workspace-relative when inside the workspace,
absolute otherwise. A custom target triple or custom profile still reshapes the
path and falls back to the wide escape hatch. `CARGO_TARGET_DIR` was already in
the env cache-key allowlist and now also keys the in-process graph cache. Proven
end-to-end by a new relocation shape in `tools/cache-matrix.mjs` that asserts
artefact **restoration** at the relocated path (a plain miss-then-hit would pass
even on the old behaviour) plus a no-false-hit check across two target-dirs.
New decision D-C7.

**Known boundary.** The env relocation is read at **graph-computation time**,
because it feeds inferred outputs and Nx does not track env vars as project-graph
inputs. A stable per-worktree relocation (e.g. via direnv, present before the
graph is first built — the Anvil case) is fully cache-correct; a relocation that
*changes* mid-session needs an `nx reset` to recompute the graph. The
`--target-dir` *option* path has no such caveat (it is interpolated from static
target options). Documented for consumers; a follow-up could fold
`CARGO_TARGET_DIR` into a graph-invalidation signal if a consumer needs
mid-session switching.

**Problem.** `buildCacheOutputs` (`src/utils/cache-inputs.ts`) emits narrow
per-binary / per-rlib paths only under the default `{workspaceRoot}/target`.
When the effective target directory is relocated — via the `--target-dir`
option, the `CARGO_TARGET_DIR` env var, or `.cargo/config.toml`
`build.target-dir` — `target-configs.ts` forces `narrowBuildOutputs: false`,
so `buildCacheOutputs` returns the wide escape hatch
`["{options.target-dir}", "{workspaceRoot}/target"]`. For **env-var**
relocation nxrust never learns the path, so outputs point at an empty
`{workspaceRoot}/target` and the cache captures nothing → safe miss, no
reuse. Anvil's relocated worktrees therefore get correctness without cache
reuse — the failure DEVENV-003 tracks.

**In scope.**

- Resolve the effective target directory once, with cargo's precedence:
  `--target-dir` option > `CARGO_TARGET_DIR` env > `.cargo/config.toml`
  `build.target-dir` > default `{workspaceRoot}/target`. (Config/toolchain
  resolution overlaps [06-toolchain-awareness](./06-toolchain-awareness.aps.md);
  keep a minimal resolver here and converge later.)
- When the resolved dir differs from the default, still emit **narrow**
  per-binary / per-rlib outputs rooted at the resolved dir (relative to
  `{workspaceRoot}` where the dir is inside it, else an absolute /
  `{options.target-dir}` token Nx can capture), instead of the wide escape
  hatch.
- Keep the wide escape hatch only for the genuinely unsafe cases CACHE-002 /
  D-C6 carve out (custom target triple, crate types beyond `lib`/`rlib`/`bin`,
  explicit `narrowBuildOutputs: false`). **Relocation alone is no longer
  "unsafe".**
- `CARGO_TARGET_DIR` already participates in the cache key (env allowlist);
  confirm the target triple / resolved target-dir likewise differentiate so a
  relocated narrow output can never alias a default-dir hit.
- Extend `tools/cache-matrix.mjs` with a relocated-target-dir shape (both
  `CARGO_TARGET_DIR` env and `.cargo/config.toml`) asserting miss-then-hit on
  the second run, mirroring CACHE-003.

**Acceptance.**

- A crate built with a relocated target-dir misses on first run and **hits**
  on the second with unchanged inputs (today it misses both).
- No false hit across two different target-dirs for otherwise-identical inputs.
- Default-dir behaviour is byte-for-byte unchanged (regression-safe vs
  CACHE-002).

_Further items promote individually on real-consumer asks per D-007 / D-010._

## Risks & Mitigations

| Risk                                                                           | Impact | Likelihood | Mitigation                                                                                                                              |
| ------------------------------------------------------------------------------ | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Env-var allowlist misses a build-affecting variable                            | high   | medium     | Document the allowlist; provide a plugin option for additions; CI matrix exercises common toolchains                                    |
| `build` target outputs cache binaries that embed absolute paths                | high   | medium     | Document the safe-output narrowing rule; default outputs to per-binary paths, not whole `target/`                                       |
| Named-input registration in `nx.json` collides with consumer's existing inputs | low    | medium     | `init` generator merges instead of overwriting; document the contract; warn on conflict                                                 |
| CI fixture matrix becomes slow                                                 | medium | medium     | Parallelise; cache the CI-job-level pnpm install; matrix is small (≤ 6 shapes) by design                                                |
| Cache-key gaps cause silent miscompiles in mixed-toolchain consumer            | high   | low        | Toolchain hashing in [06-toolchain-awareness](./06-toolchain-awareness.aps.md) is a hard prereq for any `target/`-aware cache expansion |

## Decisions

- **D-C1:** Named inputs `rustSources` and `rustWorkspace` are the
  canonical input contract for Rust tasks. _Accepted (inherits spec
  §6.4)._
- **D-C2:** Env-var allowlist is the only env participating in cache
  keys; non-allowlisted env is ignored. Allowlist is extensible via
  plugin option. _Accepted._
- **D-C3:** Conservative outputs by default. Per-target opt-in to wider
  `target/` caching, never opt-out from narrow. _Accepted._
- **D-C4:** Cache-rule changes bump the minor version. Inherits D-008.
  _Accepted._
- **D-C5:** `init` registering the `rustSources`/`rustWorkspace` named
  inputs in `nx.json` is a hard prerequisite for the inferred graph:
  targets reference those names, so a workspace that adds the plugin
  without running `init` fails graph load with `"rustSources" is an
invalid fileset`. The e2e smoke fixture therefore runs `init` before
  the graph is computed, mirroring `nx add`. _Accepted (discovered via
  PR #15 smoke failure)._ Open follow-up: consider making inference
  self-sufficient (project-level `namedInputs`) so the plugin degrades
  gracefully pre-`init` — deferred, not in CACHE-001 scope.
- **D-C6:** `build` outputs are narrowed to per-binary/per-rlib paths by
  default (`narrowBuildOutputs: true`), not the whole `{workspaceRoot}/
target` tree — answering the build-output open question in favour of the
  conservative default (consistent with D-C3). The wide-output escape hatch
  is auto-selected for cases narrow paths cannot safely express (custom
  target-dir, custom target triple, crate types beyond `lib`/`rlib`/`bin`)
  and is also reachable via `narrowBuildOutputs: false`. _Accepted
  (CACHE-002)._
- **D-C7:** Relocation is cache-safe, not an escape-hatch trigger. A
  relocated effective target directory (`--target-dir` / `CARGO_TARGET_DIR` /
  `.cargo/config.toml` `build.target-dir`) gets the same narrow per-binary /
  per-rlib outputs as the default `target/`, rooted at the resolved dir.
  The wide-output escape hatch is reserved for cases narrow paths cannot
  express (custom target triple, non-`lib`/`rlib`/`bin` crate types, explicit
  `narrowBuildOutputs: false`). Supersedes the part of D-C6 that auto-selected
  the wide hatch on a custom target-dir. Cache-rule change → **minor** bump
  (D-008). _Accepted 2026-06-21 (CACHE-004, Anvil-driven)._

## Open Questions

- [ ] Should `clippy` cache its JSON report by default, or only when the
      consumer asks via plugin option? Reports are small but introduce a
      filesystem artefact for what was previously a result-only target.
      _Deferred — promote on a real consumer ask per D-007; not blocking
      module completion._
- [x] Should `target/{profile}/<binary>` outputs be enabled by default
      for the `build` target, or stay opt-in? **Resolved (CACHE-002, D-C6):
      narrow by default, with an auto/opt-in wide-output escape hatch.**
- [ ] Should `RUSTFLAGS` env participation be on by default or behind a
      plugin option? It's the single most build-affecting var; defaulting
      on seems right.
- [x] Should the fixture matrix live in this repo's `e2e/` or in a sibling
      `e2e/fixtures/` tree? **Resolved (CACHE-003): a checked-in
      `e2e/cache-matrix/` workspace alongside the existing `e2e/fixture/`
      smoke workspace, driven by `tools/cache-matrix.mjs`.**
