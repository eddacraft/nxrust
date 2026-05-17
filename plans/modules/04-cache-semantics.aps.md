<!-- APS Module: 04-cache-semantics -->
<!-- Status: Proposed -->

# Cache Semantics

Cache-correctness for Rust tasks: named inputs, environment hashing, and
conservative output narrowing.

| ID | Owner | Status |
|----|-------|--------|
| CACHE | eddacraft | Proposed |

## Purpose

Rust caching is notoriously easy to get wrong. v0.1 already narrowed the
`test` target's outputs after a real consumer regression (CHANGELOG 0.1.2
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

| Target | Default `outputs` |
|---|---|
| `check` | `[]` (result-cached only) |
| `clippy` / `lint` | `[]` (or `clippy.json` if requested) |
| `fmt-check` | `[]` |
| `test` | `[]` (per v0.1.2 fix); test reports cached when configured |
| `build` | `{workspaceRoot}/target/{profile}/<binary>` only when safe — narrow, not whole `target/` |
| `doc` | `{workspaceRoot}/target/doc` |
| `run` | not cached |
| `release-publish` | not cached |

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

*No work items yet — module is Proposed. Items promote individually on
real-consumer asks per D-007.*

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Env-var allowlist misses a build-affecting variable | high | medium | Document the allowlist; provide a plugin option for additions; CI matrix exercises common toolchains |
| `build` target outputs cache binaries that embed absolute paths | high | medium | Document the safe-output narrowing rule; default outputs to per-binary paths, not whole `target/` |
| Named-input registration in `nx.json` collides with consumer's existing inputs | low | medium | `init` generator merges instead of overwriting; document the contract; warn on conflict |
| CI fixture matrix becomes slow | medium | medium | Parallelise; cache the CI-job-level pnpm install; matrix is small (≤ 6 shapes) by design |
| Cache-key gaps cause silent miscompiles in mixed-toolchain consumer | high | low | Toolchain hashing in [06-toolchain-awareness](./06-toolchain-awareness.aps.md) is a hard prereq for any `target/`-aware cache expansion |

## Decisions

- **D-C1:** Named inputs `rustSources` and `rustWorkspace` are the
  canonical input contract for Rust tasks. *Accepted (inherits spec
  §6.4).*
- **D-C2:** Env-var allowlist is the only env participating in cache
  keys; non-allowlisted env is ignored. Allowlist is extensible via
  plugin option. *Accepted.*
- **D-C3:** Conservative outputs by default. Per-target opt-in to wider
  `target/` caching, never opt-out from narrow. *Accepted.*
- **D-C4:** Cache-rule changes bump the minor version. Inherits D-008.
  *Accepted.*

## Open Questions

- [ ] Should `clippy` cache its JSON report by default, or only when the
      consumer asks via plugin option? Reports are small but introduce a
      filesystem artefact for what was previously a result-only target.
- [ ] Should `target/{profile}/<binary>` outputs be enabled by default
      for the `build` target, or stay opt-in? v0.1 caches `target/`
      for `build`; we may narrow this in the same pass.
- [ ] Should `RUSTFLAGS` env participation be on by default or behind a
      plugin option? It's the single most build-affecting var; defaulting
      on seems right.
- [ ] Should the fixture matrix live in this repo's `e2e/` or in a sibling
      `e2e/fixtures/` tree? Inherits the "checked-in vs generated" open
      question from module 01.
