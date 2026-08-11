<!-- APS Module: 13-affected-refinement -->
<!-- Status: In Progress -->

# Affected Refinement

Make `nx affected` correct and precise for Rust file, manifest, lockfile,
and toolchain changes.

| ID       | Owner     | Status   |
| -------- | --------- | -------- |
| AFFECTED | eddacraft | In Progress (AFFECTED-001 + WN-003 Ready — ISS-004 #4/#6) |

## Purpose

The main value of Nx in a mixed monorepo is affected-only execution.
v0.1's behaviour is correct but conservative: source-file changes pick
out the owning crate and dependants; lockfile and root-manifest changes
trigger every Rust crate. Spec §6.13 defines the target behaviour: a
file → affected-projects mapping that handles source, manifest,
lockfile, toolchain, build-script, and (eventually) feature changes
correctly.

This module is where the conservative baseline gets refined. It depends
on the graph from
[02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md)
and the cache semantics from
[04-cache-semantics](./04-cache-semantics.aps.md) — affected and cache
must agree on what counts as a relevant change.

## In Scope

**File → affected mapping (spec §6.13):**

| Change                                                             | Affected result                              |
| ------------------------------------------------------------------ | -------------------------------------------- |
| `crates/foo/src/lib.rs` (any `.rs` under crate)                    | `foo` and dependants                         |
| `crates/foo/Cargo.toml`                                            | `foo` and dependants                         |
| `crates/foo/build.rs`                                              | `foo` and dependants                         |
| `crates/foo/tests/*.rs`                                            | `foo` only (tests don't propagate)           |
| `crates/foo/benches/*.rs`                                          | `foo` only                                   |
| `crates/foo/examples/*.rs`                                         | `foo` only                                   |
| root `Cargo.lock`                                                  | All Rust crates initially; refined when safe |
| root `Cargo.toml` (workspace section)                              | All Rust crates                              |
| root `Cargo.toml` (`workspace.dependencies` only)                  | Affected subset where possible               |
| `rust-toolchain.toml`                                              | All Rust crates + synthetic `rust-workspace` |
| `.cargo/config.toml`                                               | All Rust crates + synthetic `rust-workspace` |
| feature flag change (consumer-invoked with different `--features`) | Feature-dependent subset where possible      |

**Lockfile refinement (spec §6.13):**

- Start conservative: any `Cargo.lock` change ⇒ all Rust crates affected.
- Future refinement: parse the diff between two `Cargo.lock` states,
  identify which external crates' versions changed, walk the graph to
  find dependent internal crates. Only those are affected. Promotion to
  this finer-grained behaviour is gated on a consumer ask.

**Workspace-dependency refinement:**

- Root `Cargo.toml` `[workspace.dependencies]` change: identify the
  changed dep, walk the graph for crates that inherit
  `dep.workspace = true`. Only those are affected.

**Build-script awareness:**

- `build.rs` changes propagate to the owning crate and dependants
  (build-time codegen can change emitted code).

**Feature-aware affected (spec §6.13, far end):**

- When a consumer invokes `nx affected -t test --features foo`, only
  crates whose `foo`-gated dependencies / cfg blocks transitively touch
  changed code are affected. Requires the feature metadata preserved by
  [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md).
- Far end of the module; gated on
  [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md)
  promoting feature-metadata-on-edges.

## Out of Scope

- Cache-key changes (i.e. inputs that participate in hashing) — that's
  [04-cache-semantics](./04-cache-semantics.aps.md). Affected and cache
  are different questions: affected says "should this run", cache says
  "is this cached".
- Build-graph reordering or topological scheduling beyond what Nx
  already does.
- Affected for cross-language edges (e.g. a TS project depends on a
  napi-rs crate via a sibling `package.json`) — that's a v0.4 concern,
  if a consumer asks.

## Interfaces

### Depends On

- [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md)
  — graph edges + dep-kind + feature metadata.
- [04-cache-semantics](./04-cache-semantics.aps.md) — named inputs anchor
  what counts as "a relevant change".
- [06-toolchain-awareness](./06-toolchain-awareness.aps.md) —
  `rust-toolchain.toml` change semantics.
- [12-workspace-synthetic-project](./12-workspace-synthetic-project.aps.md)
  — workspace-level changes also touch the synthetic project.
- Nx's `nx affected` engine in `@nx/devkit ^22.6.5`.

### Exposes

- A file-pattern → projects mapping consumed by `nx affected`.
- A `Cargo.lock` diff parser (future refinement).
- A `[workspace.dependencies]` diff parser (future refinement).
- Documentation of the conservative-vs-refined behaviour ladder so
  consumers know which level they're getting.

## Constraints

- **Conservative by default.** A baseline that over-triggers is correct;
  one that under-triggers is a correctness bug. New refinements (lockfile
  parsing, feature-aware) promote individually and must come with a CI
  fixture proving they don't under-trigger.
- **Refinement is opt-in initially.** New refinements ship behind a
  plugin option (e.g. `affectedLockfileMode: "conservative" | "refined"`),
  then default-on once a consumer has used them in CI for at least one
  release cycle.
- **Affected must agree with cache.** If a change invalidates cache, it
  must also count as affected (and vice versa for relevant inputs).
  Mismatch is a correctness bug.
- **Graph-shape changes (D-008) include affected behaviour changes.**
  Bump minor on any refinement that changes which projects appear in
  `nx affected` output for a given change.

## Ready Checklist

Promote individual Work Items to Ready when:

- [ ] A real consumer hits an affected over-trigger (CI runs everything
      when only a few crates needed to run) or an under-trigger
      (CI misses a failure) (per D-007).
- [ ] The triggering change is captured (diff hunk + expected affected
      set + observed affected set).
- [ ] A Work Item is drafted.

## Work Items

### AFFECTED-001 — `nxrust explain affected <crate>` (ISS-004 #4)

- **Status:** Ready (promoted 2026-06-21 under D-012 — Anvil's #4 upstream ask;
  not yet built. **Next Ready slice** after CACHE-OBS-001. Reconciled 2026-08-10.)
- **Dependencies:** none
- **Intent:** Explain Nx's affected verdict for a Rust crate — cargo path /
  workspace dependency edges and the lockfile/manifest inputs that mark it
  affected — so consumers stop reverse-engineering `nx affected` by hand.
- **Expected Outcome:** A read-only generator that, for a given crate, reports
  those edges and inputs, reading straight off the project graph rather than
  recomputing inference. Mirrors the read-only generator pattern of `doctor`
  (DIAG-001) and `cache-report` (CACHE-OBS-001).
- **Validation:** `pnpm test` for the explain collector; fixture run shows
  path-dep and lockfile inputs for a known crate; no graph mutations.

### WN-003 — First-class "Rust crate backing a JS package" + NAPI test defect (ISS-004 #6)

- **Status:** Ready (promoted 2026-06-21 under D-012 — Anvil's #6 upstream ask;
  not yet built. Spans modules 10/13; investigate alongside the WN-002 seam work.
  Reconciled 2026-08-10.)
- **Dependencies:** LIST-001 (D-012 queue order after AFFECTED-001 and LIST-001)
- **Intent:** Model a Rust crate that backs a JS package as a first-class
  relationship, and fix the inference **defect** Anvil's audit found: a NAPI
  package's Nx `test` target invoking `@eddacraft/nxrust:test` instead of the
  package's own scripts.
- **Expected Outcome:** NAPI/JS-backed crates get correct `test` target wiring
  (package scripts, not the cargo test executor), and the backing relationship
  is represented so later seam/affected work can reason about it.
- **Validation:** `pnpm test` + a fixture NAPI-shaped package whose `test` no
  longer resolves to `@eddacraft/nxrust:test` unless explicitly intended.

_Further items promote individually per D-007 / D-010._

## Risks & Mitigations

| Risk                                                                                                                                             | Impact | Likelihood | Mitigation                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Refined lockfile parser misses a relevant version bump                                                                                           | high   | medium     | Comprehensive fixture matrix: tag-pinned, branch-pinned, registry, git, patched deps; conservative-mode fallback always available              |
| Feature-aware affected hides a feature-conditional regression                                                                                    | high   | medium     | Feature awareness is opt-in; default stays conservative until a consumer validates a release with the refined behaviour                        |
| Workspace-dep diff parser misreads TOML                                                                                                          | medium | low        | Use `@ltd/j-toml` (v0.1 contract); fixtures with comments, nested tables, edge cases                                                           |
| Affected and cache diverge on what counts as a relevant change                                                                                   | high   | low        | Shared "relevant input" definition between [04-cache-semantics](./04-cache-semantics.aps.md) and this module; lint test verifies the agreement |
| `[workspace.dependencies]` refactor (changing `version = "0.x"` to `version.workspace = true`) appears as a workspace-dep diff and over-triggers | medium | medium     | Detect the structural change; treat as a no-op for affected if version resolution doesn't change                                               |

## Decisions

- **D-A1:** Conservative baseline first; refinements are per-item,
  consumer-driven (D-007). _Accepted (inherits spec §6.13)._
- **D-A2:** Refinements ship opt-in via plugin option, default-on later.
  _Accepted._
- **D-A3:** Affected and cache agree on what counts as a relevant
  change. Tested by a shared definition. _Accepted._
- **D-A4:** Affected behaviour changes are graph-shape changes per
  D-008: bump minor + CHANGELOG. _Accepted._

## Open Questions

- [ ] How aggressive should lockfile affected refinement become?
      Conservative (any change → all crates) is correct but wastes CI;
      fully refined (only affected internal crates) is the target. Spec
      open question 4. Defer to first promotion.
- [ ] Should `[workspace.dependencies]` diffs that only re-shape the
      manifest (e.g. moving a dep from per-crate to workspace) count as
      affecting nothing? Probably yes if the resolved versions are
      identical; verified via `cargo metadata` diff.
- [ ] Feature-aware affected — is the consumer expected to pass
      `--features` to `nx affected`? Nx's API doesn't natively pass
      runtime args into affected resolution. May require a plugin-level
      env or config.
- [ ] Cross-language affected: a TS project depending on a Rust napi-rs
      sibling. The dep edge exists in JS-land via `package.json`;
      mirroring it into the Nx graph is up to nxrust or
      [10-wasm-napi](./10-wasm-napi.aps.md). Defer until a consumer
      surfaces it.
