<!-- APS Module: 02-workspace-inference-and-graph -->
<!-- Status: Proposed -->

# Workspace Inference and Project Graph

Make `cargo metadata` the authoritative source for Nx projects and edges,
beyond the canonical-layout cases v0.1 already handles.

| ID    | Owner     | Status                              |
| ----- | --------- | ----------------------------------- |
| GRAPH | eddacraft | Proposed (GRAPH-001 released 0.2.0) |

## Purpose

v0.1's graph plugin handles the canonical case: a Cargo workspace at the Nx
root with `workspace.members = ["crates/*"]`, package names that map
directly to Nx project keys, and registry/git dependencies emitted as
`cargo:<name>` external nodes. Spec §6.1 and §6.2 describe the broader
surface: nested globs, explicit + glob mixes, `workspace.exclude` pruning,
single-crate-at-root, name normalisation rules, project-key vs cargo-name
divergence, dependency-kind metadata (normal/dev/build), feature-resolution
metadata, and lockfile / manifest invalidation correctness under cache.

This module hardens the graph for realistic workspace shapes and adds the
metadata necessary for the affected-refinement and cache-semantics work to
land downstream.

## In Scope

**Workspace inference (spec §6.1):**

- Nested-glob support in `workspace.members` (`crates/**`, `apps/*/crate`).
- Explicit + glob mixes — explicit members alongside `crates/*` patterns
  resolve consistently.
- `workspace.exclude` honoured even when a glob would otherwise include the
  excluded path.
- Single-crate-at-root repositories where the root `Cargo.toml` is a
  `[package]`, not a `[workspace]`.
- Optional name normalisation: scoped prefixes (`@scope/`), kebab-case
  enforcement, configurable via plugin options.
- Project-key vs cargo-name divergence: explicit mapping (plugin option or
  `package.metadata.nxrust.project = "..."`) supported, ambiguity rejected
  with a clear error.
- `package.metadata.nxrust` table parsing — tags, test-runner, target
  overrides — feeds both inference here and target configuration in
  [03-target-inference](./03-target-inference.aps.md) /
  [05-cargo-features](./05-cargo-features.aps.md).
- **Tag convention** (planned for this module; not in v0.1).
  `package.metadata.nxrust.tags = ["..."]` in `Cargo.toml` is the
  **preferred** way to tag a Rust crate once this module's parser ships:
  the planned `package.metadata.nxrust` parser lifts the values into
  the Nx project's `tags` array, so pure Cargo crates acquire tags with
  no `project.json`. Today, until the parser lands, tagging happens via
  `project.json` (`"tags": [...]`) or the `crate` / `library` / `binary`
  generators' `--tags` option. The two paths coexist post-parser; the
  zero-`project.json` outcome is the goal. Convention ratified by
  Anvil 2026-05-20 as the inaugural shape for downstream consumers.

**Project graph (spec §6.2):**

- Dependency-kind metadata on edges (normal / dev / build) preserved from
  `cargo metadata`.
- Feature metadata on edges preserved for downstream affected refinement
  ([13-affected-refinement](./13-affected-refinement.aps.md)).
- `Cargo.lock` content-hash keyed cache invalidation (current behaviour is
  mtime-keyed — content-hash is more robust under fresh checkouts).
- `Cargo.toml` set-of-relevant-keys invalidation: only the keys that affect
  graph shape (`[dependencies]`, `[workspace]`, etc.) bust the cache, not
  cosmetic edits.
- Optional toggle for external `cargo:<crate>` node visibility in
  `nx graph` (plugin option).

## Out of Scope

- Affected-set refinement after lockfile / manifest changes — that's
  [13-affected-refinement](./13-affected-refinement.aps.md).
- Cache key hashing for executor runs — that's
  [04-cache-semantics](./04-cache-semantics.aps.md).
- New executors / generators — separate modules.
- Re-implementing `cargo metadata` (still the source of truth; this module
  only consumes it more thoroughly).

## Interfaces

### Depends On

- `cargo metadata --format-version=1` (Cargo public contract).
- `@nx/devkit ^22.6.5`'s `createNodesV2` + `createDependencies` API.
- v0.1's `src/graph.ts` baseline.

### Exposes

- A widened `createNodesV2` matcher set covering nested globs and
  excludes.
- A `createDependencies` output that carries dep-kind and feature
  metadata.
- Plugin options for name normalisation and external-node visibility.
- A `package.metadata.nxrust` parser usable by sibling modules.

## Constraints

- **Graph-shape changes bump the minor version (D-008).** Anything in this
  module that changes the set of projects, edges, or external nodes for an
  existing consumer is a minor bump with a CHANGELOG entry calling out the
  change.
- **`cargo metadata` stays authoritative.** Direct TOML parsing is
  permitted for lightweight discovery (e.g. `package.metadata.nxrust`) but
  must not become a parallel dependency source.
- **Cache invalidation must not over-trigger.** Content-hash on `Cargo.lock`
  and key-based invalidation on `Cargo.toml` should narrow, not widen, the
  invalidation surface compared with v0.1's mtime behaviour.
- **No `project.json` requirement.** Inference must keep working for crates
  with no `project.json`; the divergence-mapping option is opt-in.

## Ready Checklist

Promote individual Work Items to Ready when:

- [ ] A real consumer workspace surfaces the specific edge case (issue,
      Slack, direct ask). Inherits D-007.
- [ ] The failing input is reproducible — a `Cargo.toml` snippet, a member
      glob, or a `cargo metadata` JSON output.
- [ ] The desired graph shape is captured in writing.
- [ ] A Work Item is drafted scoped to that one edge case.
- [ ] Other items in this module stay Proposed.

## Work Items

### GRAPH-001: `package.metadata.nxrust` parser + tag lifting

**Status: Released** (PR #22, squash-merged 2026-06-08; released in
**`@eddacraft/nxrust@0.2.0`** on 2026-06-10 — release commit `b8d7f4b`,
tag `v0.2.0`).

- **Intent:** Parse the `[package.metadata.nxrust]` table from each member
  `Cargo.toml` during `createNodesV2` and lift `metadata.nxrust.tags` into
  the inferred Nx project's `tags`, so a pure-Cargo crate acquires tags with
  no `project.json`. Trigger: Anvil ratified the convention 2026-05-20 (D-G4)
  and the `crate` / `library` / `binary` generators already emit it, but the
  tags stay inert until this parser ships — promotes per D-007. Sibling
  modules [03-target-inference](./03-target-inference.aps.md) and
  [05-cargo-features](./05-cargo-features.aps.md) consume the same parser.
- **Expected Outcome:** A member crate carrying
  `[package.metadata.nxrust] tags = ["cargo", "scope:anvil"]` and **no**
  `project.json` (today the inferred node has `tags: []`) yields an inferred
  Nx project whose `tags` array is `["cargo", "scope:anvil"]`. Where a
  `project.json` also carries tags, Nx's own `mergeProjectConfigurations`
  unions and de-duplicates across sources (that cross-source merge is Nx's
  behaviour, not this plugin's, and is verified by the e2e rather than the
  unit tests). Scope
  is the table-parser foundation and the `tags` key only; `test-runner` and
  target-override keys are parsed-but-ignored here and stay Proposed for
  modules 03 / 05. **Implementation note:** the table is read from the
  `package.metadata` field that `cargo metadata` already surfaces in its JSON
  output — _not_ a separate TOML read of the manifest. This is stronger than
  the planned "direct TOML read" (D-G1 caveat): `cargo metadata` stays the
  single authoritative source, no parallel manifest parse exists. A malformed
  `tags` value (not an array of strings) warns and is ignored rather than
  throwing, so one bad manifest never breaks graph construction for the whole
  workspace. **Deferred:** warning on _unknown_ sibling keys routes "via
  [14-diagnostics](./14-diagnostics.aps.md)" — that module is Proposed/unbuilt
  and the known-key set is still being finalised by modules 03/05, so the
  unknown-key warning is deferred to 14-diagnostics rather than guessed at
  here. No graph _edge_ changes (additive).
- **Validation:** Unit tests in `src/graph.spec.ts` (`inferred project tags`)
  assert lift, de-dup, omit-when-absent, empty-array omit, coexistence with
  reserved keys, and warn-and-ignore on malformed `tags`. E2e
  `nx show project <crate> --json` reports `tags: ["cargo","scope:anvil"]` for
  a crate with no `project.json`. Ships as a **minor** bump with a CHANGELOG
  entry (D-008), since the project `tags` set changes for adopters already
  writing the metadata key.

_Further items (nested globs, excludes, single-crate-at-root, name
normalisation, content-hash lockfile keying, dep-kind/feature edge metadata)
stay Proposed and promote individually on real-consumer asks per D-007._

## Risks & Mitigations

| Risk                                                                           | Impact | Likelihood | Mitigation                                                                                                        |
| ------------------------------------------------------------------------------ | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Widened glob support changes graph shape for existing consumers                | high   | medium     | D-008: minor bump + CHANGELOG; verify against v0.1 consumer before publish                                        |
| Content-hash lockfile keying is slower than mtime on huge workspaces           | medium | low        | Keep mtime as the fast path; content-hash only on mtime change or on cold cache                                   |
| `package.metadata.nxrust` ambiguity (key collision with target options)        | medium | medium     | Document namespace clearly; reject unknown keys with a warning                                                    |
| Project-key/cargo-name divergence support invites generator/executor confusion | medium | medium     | Single source of truth: `cargo metadata` package name is always passed to `cargo -p`; Nx key is presentation-only |
| Feature-metadata-on-edges balloons graph size                                  | low    | medium     | Make it opt-in or strip in production graph view; preserve in raw graph for affected use                          |

## Decisions

- **D-G1:** `cargo metadata` stays the authoritative graph source.
  Inherits from index D-001's broader principle. _Accepted._
- **D-G2:** Project-key/cargo-name divergence supported only via explicit
  opt-in (plugin option or `package.metadata.nxrust.project`). Implicit
  divergence is rejected with a clear error message — produced by
  [14-diagnostics](./14-diagnostics.aps.md). _Accepted._
- **D-G3:** Graph-shape changes bump the minor version. Inherits index
  D-008. _Accepted._
- **D-G4:** `package.metadata.nxrust.tags = [...]` in `Cargo.toml` is
  the canonical Rust-side tag convention. The planned
  `package.metadata.nxrust` parser lifts values into the Nx project's
  `tags` array; until the parser ships, tagging happens via
  `project.json` (`"tags": [...]` or generator `--tags`). The metadata
  key shape is fixed from this point — adopters writing it today are
  safe from rework. Ratified by Anvil 2026-05-20 as the inaugural
  downstream-consumer convention. Full detail in the **Tag convention**
  bullet under § In Scope above.
  _Accepted 2026-05-22._

## Open Questions

- [ ] Should external `cargo:<crate>` nodes be visible by default in
      `nx graph`? Current v0.1 behaviour emits them; UX feedback is
      mixed. Resolve at first item promotion.
- [ ] Should `package.metadata.nxrust` ship under a different table name
      (e.g. `package.metadata.nx`) for forward-compat with a hypothetical
      official Nx-Rust contract? Probably no — `nxrust` is the plugin
      namespace.
- [ ] Dev-dependency edges: emit by default or behind an option? v0.1
      skips `kind === 'dev'`. Revisit when `nx affected -t test` misses
      edges in a real consumer.
- [ ] Feature-resolution metadata: emit at workspace level
      (one resolution) or per crate (different feature sets across
      callers)? Cargo's resolver is workspace-wide by default; mirror it.
