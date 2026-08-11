<!-- APS Module: 12-workspace-synthetic-project -->
<!-- Status: In Progress -->

# Workspace Synthetic Project

A synthetic `rust-workspace` project exposes Cargo's workspace-level
commands as Nx targets — `cargo metadata`, workspace-wide `fmt-check`,
`audit`, `deny`, `doc`, `clean`, lockfile management.

| ID  | Owner     | Status   |
| --- | --------- | -------- |
| WS  | eddacraft | In Progress (LIST-001 Ready — ISS-004 #5) |

## Purpose

Some Cargo commands are inherently workspace-level: `cargo audit`,
`cargo deny`, `cargo fmt` across all crates, `cargo doc --workspace`,
`cargo metadata`, `cargo clean`, `cargo update`. Treating them as
per-crate creates awkward or incorrect behaviour — running
`cargo audit` 30 times for a 30-crate workspace is wasteful, and `cargo
clean -p` per crate doesn't match how Cargo actually treats `target/`.

Spec §6.12 calls for a synthetic Nx project — conventionally named
`rust-workspace` — that owns these targets. The project is virtual: it
has no source files of its own and lives at the workspace root.

## In Scope

**Synthetic project (spec §6.12):**

- Inferred by `createNodesV2` from the presence of a workspace
  `Cargo.toml` at the Nx root.
- Default name: `rust-workspace`. Configurable via plugin option
  (`workspaceProjectName`).
- Lives at `{workspaceRoot}` with `projectType: "library"` (or a synthetic
  marker if Nx allows; otherwise `library` is the least-surprising).
- Suppressible via plugin option (`emitWorkspaceProject: false`) for
  consumers who don't want it.

**Workspace-level targets (spec §6.12):**

| Target              | Command                              | Cache                                                 |
| ------------------- | ------------------------------------ | ----------------------------------------------------- |
| `cargo-metadata`    | `cargo metadata --format-version=1`  | yes (lockfile-keyed)                                  |
| `fmt`               | `cargo fmt` (mutating)               | no                                                    |
| `fmt-check`         | `cargo fmt --check`                  | yes                                                   |
| `audit`             | `cargo audit` (workspace-wide)       | yes-ish ([09-supply-chain](./09-supply-chain.aps.md)) |
| `deny`              | `cargo deny check` (workspace-wide)  | yes                                                   |
| `doc`               | `cargo doc --workspace --no-deps`    | yes                                                   |
| `clean`             | `cargo clean` (mutating)             | no                                                    |
| `update-lockfile`   | `cargo update` (mutating)            | no                                                    |
| `generate-lockfile` | `cargo generate-lockfile` (mutating) | no                                                    |

- Targets inherit cache rules from
  [04-cache-semantics](./04-cache-semantics.aps.md).
- Audit/deny per-crate variants stay in
  [09-supply-chain](./09-supply-chain.aps.md); workspace-wide here is the
  default.

**Affected behaviour:**

- The synthetic project's `fmt-check`, `audit`, `deny`, `doc` targets
  count as workspace-level for `nx affected`: a change to any Rust crate
  affects them.
- The mutating targets (`fmt`, `clean`, `update-lockfile`,
  `generate-lockfile`) are never in `affected` output; they're
  explicit-invocation only.

**Interaction with [13-affected-refinement](./13-affected-refinement.aps.md):**

- A change to `rust-toolchain.toml` or root `Cargo.toml` workspace section
  affects the synthetic project and every Rust crate (conservative
  baseline).

## Out of Scope

- Per-crate `audit` / `deny` / `doc` targets — those stay in their
  respective modules (`09-supply-chain`, `03-target-inference`).
- Workspace-level `build` / `test` — `cargo build --workspace` is
  redundant with `nx run-many -t build`; the latter is what Nx is for.
- Multi-workspace support (multiple Cargo workspaces in one Nx repo).
  Unusual; defer until a consumer asks.
- The mechanics of how the synthetic project participates in `nx graph`
  view; relies on Nx's existing handling of source-less projects.

## Interfaces

### Depends On

- `cargo metadata`, `cargo audit`, `cargo deny`, `cargo doc`,
  `cargo fmt`, `cargo clean`, `cargo update`,
  `cargo generate-lockfile`.
- [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md)
  — workspace detection drives the synthetic project's emission.
- [04-cache-semantics](./04-cache-semantics.aps.md) — workspace-target
  cache rules.
- [09-supply-chain](./09-supply-chain.aps.md) — audit/deny executors.
- [14-diagnostics](./14-diagnostics.aps.md) — diagnostic surface for
  workspace-target failures.

### Exposes

- Synthetic `rust-workspace` Nx project (configurable name).
- Workspace-level targets per the table above.
- Plugin options:
  - `workspaceProjectName` — override the default name.
  - `emitWorkspaceProject` — boolean toggle to suppress emission.
  - `workspaceTargets` — array of target names to emit (defaults to the
    full list).

## Constraints

- **Synthetic project is opt-out, not opt-in.** Default behaviour emits
  it. Consumers can disable via `emitWorkspaceProject: false`.
- **Mutating targets are not cacheable, ever.** `fmt`, `clean`,
  `update-lockfile`, `generate-lockfile` always re-run.
- **Project name is stable.** Renaming the default (`rust-workspace`) is
  a major bump.
- **No source ownership.** The synthetic project does not "own" any
  files in the workspace; it is purely a target host.
- **Affected output for mutating targets is empty.** They cannot be
  reached via `nx affected`; only explicit invocation.

## Ready Checklist

Promote individual Work Items to Ready when:

- [ ] A real consumer asks for workspace-level Cargo task orchestration
      (per D-007).
- [ ] The consumer's expected workspace target set is captured.
- [ ] A Work Item is drafted.

## Work Items

### LIST-001 — `nxrust list` / metadata target (ISS-004 #5)

- **Status:** Ready (promoted 2026-06-21 under D-012 — Anvil's #5 upstream ask;
  not yet built. Reconciled 2026-08-10.)
- **Dependencies:** AFFECTED-001 (D-012 queue order — one Ready slice at a time;
  AFFECTED-001 is the next unbuilt Anvil ask after CACHE-OBS-001.)
- **Intent:** First-class crate / package / target / workspace-membership
  reporting so consumers stop shelling `nx show projects --withTarget=check`.
- **Expected Outcome:** A read-only listing surface (human + `--json`) that
  enumerates inferred Rust crates, their nxrust targets, and workspace
  membership, reading straight off the project graph. Mirrors the read-only
  generator pattern used by `doctor` (DIAG-001) and `cache-report`
  (CACHE-OBS-001).
- **Validation:** `pnpm test` for the listing collector; manual
  `nx g @eddacraft/nxrust:list` (or chosen entry point) prints crates/targets
  for the fixture workspace; `--json` parses.

_Further items promote individually per D-007 / D-010._

## Risks & Mitigations

| Risk                                                                                  | Impact | Likelihood | Mitigation                                                                                          |
| ------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------- |
| Synthetic project name collides with an existing Nx project                           | high   | low        | Plugin option to rename; reject collisions with a diagnostic                                        |
| Consumer expects `cargo audit` per-crate, gets workspace-wide only                    | medium | medium     | Default workspace; per-crate via `09-supply-chain`'s `audit` target. Document the distinction       |
| Workspace-level `fmt-check` slow on huge workspaces                                   | medium | medium     | `cargo fmt --check` is fast even on large trees; if it isn't, parallelise per-crate via Nx affected |
| `update-lockfile` mutating in CI surprises the consumer                               | high   | low        | Mutating targets never in `affected` output; explicit invocation only; documented                   |
| The synthetic project breaks consumers who use `nx graph --focus` and don't expect it | low    | medium     | `emitWorkspaceProject: false` opt-out; documented in README                                         |

## Decisions

- **D-WS1:** Synthetic project is opt-out (default-emit). Renamed
  via plugin option, suppressed via `emitWorkspaceProject: false`.
  _Accepted (inherits spec §6.12)._
- **D-WS2:** Default name is `rust-workspace`. Renaming the default is a
  major bump. _Accepted._
- **D-WS3:** Mutating targets (`fmt`, `clean`, `update-lockfile`,
  `generate-lockfile`) are never cacheable and never in `affected`.
  _Accepted._

## Open Questions

- [ ] Should `audit` and `deny` be workspace-level **only**, or also
      per-crate? Spec open question 2. This module says workspace-level
      default; [09-supply-chain](./09-supply-chain.aps.md) keeps per-crate
      as opt-in.
- [ ] Should the synthetic project be visible in `nx show projects`
      default output, or hidden behind a flag? Visible — it's a real
      project users can invoke.
- [ ] Should `cargo doc --workspace` and per-crate `cargo doc -p`
      coexist, or pick one? Both useful; this module owns workspace,
      per-crate stays a [03-target-inference](./03-target-inference.aps.md)
      candidate.
- [ ] What's the project type? `library`, `application`, or a synthetic
      marker? `library` is the least-surprising; `application` implies
      a build artefact.
