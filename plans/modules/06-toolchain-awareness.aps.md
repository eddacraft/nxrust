<!-- APS Module: 06-toolchain-awareness -->
<!-- Status: Proposed -->

# Toolchain Awareness

Read `rust-toolchain.toml`, respect `cargo +toolchain`, and hash the actual
Rust toolchain into the cache key.

| ID | Owner | Status |
|----|-------|--------|
| TOOLCHAIN | eddacraft | Proposed |

## Purpose

Rust toolchains are part of build determinism. Two crates built with
different `rustc` versions produce different artefacts; a remote cache that
ignores the toolchain will hand back stale binaries. Spec §6.6 makes
toolchain awareness explicit: the plugin reads `rust-toolchain.toml` so it
knows the consumer's pinned toolchain, supports `cargo +stable`-style
toolchain overrides per target, and hashes `rustc -Vv` + `cargo -V` into
the cache key so cache hits across toolchain bumps are impossible.

This module is the second half of cache correctness; it pairs with
[04-cache-semantics](./04-cache-semantics.aps.md) and is a hard prereq for
any wider `target/`-aware caching.

## In Scope

**`rust-toolchain.toml` reading:**

- Parse `rust-toolchain.toml` at the workspace root (canonical location).
- Honour `[toolchain] channel = "..."`, `components = [...]`,
  `targets = [...]`, `profile = "..."`.
- Use the declared channel as the default `cargo +<toolchain>` for
  inferred targets where the consumer hasn't overridden via plugin
  option, `project.json`, or `package.metadata.nxrust`.

**Toolchain override hierarchy:**

1. Per-invocation: `nx run x:test --toolchain=nightly`.
2. `project.json` target option.
3. `package.metadata.nxrust.targets.<name>.toolchain`.
4. `package.metadata.nxrust.toolchain` (per-crate default).
5. `rust-toolchain.toml` (workspace default).
6. Plain `cargo` (rustup's default toolchain).

**Cache-key participation:**

- `rustc -Vv` output hashed and included in the cache key for every
  cacheable target. Cached once per session, refreshed on
  `rust-toolchain.toml` change or explicit Nx cache clear.
- `cargo -V` hashed and included alongside.
- The selected toolchain channel (resolved per the hierarchy above)
  participates explicitly — so `cargo +stable test` and
  `cargo +nightly test` get different cache keys even before `rustc -Vv`
  is queried.
- Implementation lives where Nx wants it: as `inputs: [{ "runtime": "..." }]`
  entries or equivalent.

**Validation diagnostics (cross-link to
[14-diagnostics](./14-diagnostics.aps.md)):**

- Missing toolchain (`rustup` doesn't have the channel installed) ⇒
  actionable error with the exact `rustup install` command.
- Missing target (`rustup target add x86_64-pc-windows-gnu`) ⇒ actionable
  error.
- `cargo` not on PATH ⇒ actionable error pointing at the rustup install.

## Out of Scope

- Cache input file lists — that's
  [04-cache-semantics](./04-cache-semantics.aps.md).
- Toolchain-aware affected (a `rust-toolchain.toml` bump invalidating
  every Rust crate) — that's
  [13-affected-refinement](./13-affected-refinement.aps.md) (already
  conservative in spec §6.13).
- Installing toolchains for the user — `rustup` is the user's job;
  diagnostics point at `rustup`.
- Cross-compilation orchestration (matrix per `--target`) — v0.3+.

## Interfaces

### Depends On

- `cargo -V` and `rustc -Vv` on PATH (Cargo public contract).
- `@nx/devkit ^22.6.5` `runtime` input or equivalent hashing entry point.
- [04-cache-semantics](./04-cache-semantics.aps.md) — this module
  contributes inputs to the named-input set defined there.

### Exposes

- A `rust-toolchain.toml` parser.
- A documented toolchain override hierarchy.
- A `rustc -Vv` / `cargo -V` cache-key contribution that other cacheable
  targets inherit by default.
- A toolchain-resolution diagnostic surface used by
  [14-diagnostics](./14-diagnostics.aps.md).

## Constraints

- **Toolchain participates in every cacheable target's cache key.** No
  exceptions. A cache hit across toolchain change is a correctness bug.
- **`rustc -Vv` is queried at most once per Nx session.** Repeated process
  spawns on every target invocation are not acceptable performance-wise.
- **Hierarchy is explicit.** Surprise toolchain selection is a diagnostic.
  When invocation-level `--toolchain` overrides `rust-toolchain.toml`,
  `nx show project --json` should reflect the resolved toolchain.
- **Honour rustup's `RUSTUP_TOOLCHAIN` env var.** It already exists and
  consumers rely on it for ad-hoc overrides.

## Ready Checklist

Promote individual Work Items to Ready when:

- [ ] A real consumer hits a toolchain-related cache miss/hit incident,
      or a `rust-toolchain.toml` is silently ignored (per D-007).
- [ ] The toolchain config involved is captured
      (`rust-toolchain.toml` snippet + invocation).
- [ ] A Work Item is drafted.

## Work Items

*No work items yet — module is Proposed. Items promote individually on
real-consumer asks per D-007.*

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `rustc -Vv` spawn cost dominates on small targets | medium | medium | Cache the output for the Nx session; refresh only on `rust-toolchain.toml` change or explicit reset |
| Hierarchy ambiguity confuses consumers | medium | medium | `nx show project --json` reflects the resolved toolchain; document the hierarchy in README and in [14-diagnostics](./14-diagnostics.aps.md) output |
| `RUSTUP_TOOLCHAIN` set in CI but not locally causes drift | high | medium | The env var participates in the cache-key resolution path; diagnose the difference on first divergence |
| Toolchain components (`rustfmt`, `clippy`, `miri`) drift independently | medium | medium | Hash `rustc -Vv` only; component versions are derived from `rustc` for stable channels; document the limitation for nightly |

## Decisions

- **D-TC1:** `rust-toolchain.toml` at the workspace root is the
  workspace-default toolchain. *Accepted (inherits spec §6.6).*
- **D-TC2:** Toolchain override hierarchy is: invocation arg →
  `project.json` → `package.metadata.nxrust.targets.<name>` →
  `package.metadata.nxrust` → `rust-toolchain.toml` → rustup default.
  *Accepted.*
- **D-TC3:** `rustc -Vv` and `cargo -V` participate in every cacheable
  target's cache key. Hard requirement, no opt-out. *Accepted.*

## Open Questions

- [ ] Should the plugin proactively call `rustup show` to detect
      missing-toolchain situations at workspace-load time, or only at
      task-invocation time? Workspace-load gives earlier feedback; cost
      is one extra subprocess per `nx` invocation.
- [ ] How does the plugin handle `rust-toolchain` (no `.toml`, the legacy
      single-line format)? Read for backwards compat? `rustup` still
      reads it; mirror that behaviour.
- [ ] Should `RUSTUP_TOOLCHAIN` env var participate in the cache key
      directly, or only the resolved toolchain channel? Resolved channel
      is enough; env var is only a selector.
- [ ] Component versions for nightly (`rustfmt-preview`, `clippy-preview`)
      — should these hash separately, or trust `rustc -Vv` to cover the
      bump? Trust `rustc -Vv` for v0.2; revisit if a real miss surfaces.
