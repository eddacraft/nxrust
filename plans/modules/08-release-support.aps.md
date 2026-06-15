<!-- APS Module: 08-release-support -->
<!-- Status: Proposed -->

# Release Support

Cargo-aware Nx release: version bump, internal dependency updates,
dry-run, package validation, registries, and fixed/independent modes.

| ID      | Owner     | Status   |
| ------- | --------- | -------- |
| RELEASE | eddacraft | Proposed |

## Purpose

v0.1 ships a `release-publish` executor that wraps `cargo publish`, plus a
`release-version` generator that bumps `package.version` in `Cargo.toml`.
Both work in isolation but neither participates fully in Nx release: there
is no internal-dep cascade ("bump crate `b` because it depends on crate
`a`'s new version"), no `cargo publish --dry-run` ergonomics, no
changelog integration, no fixed-vs-independent mode toggle, and no
explicit private-registry support.

Spec §6.8 lays out the full Cargo-aware Nx release surface. This module
brings nxrust into parity with how Nx release is expected to work in mixed
JS+Rust monorepos.

## In Scope

**Version handling (spec §6.8):**

- Update `package.version` in each crate's `Cargo.toml`, preserving
  comments and formatting (v0.1 `release-version` generator).
- Update workspace dependency versions across the workspace when an
  internal crate is bumped — if `crate-b` declares
  `crate-a = { version = "0.2", path = "../crate-a" }`, the `version`
  field updates too.
- Update `[workspace.dependencies]` shared declarations if used.
- Support fixed mode (all crates version together) and independent mode
  (crates version separately). Mode is a plugin / Nx release config
  option.

**Publishing (spec §6.8):**

- `release-publish` executor (already in v0.1) gains:
  - `--dry-run` plumbed through to `cargo publish --dry-run`.
  - `--registry <name>` for private registries.
  - `cargo package` validation pass available as a sibling
    `release-package` executor or as a dry-run pre-check.
  - Honour `package.metadata.nxrust.publish = false` to skip
    (private-only crates).

**Nx release integration (spec §6.8):**

- Plug into `nx release version` so Cargo crates participate in the
  release-group view that Nx release already shows for JS packages.
- Plug into `nx release changelog` — Cargo crates contribute to
  `CHANGELOG.md` entries with conventional-commits filtered by
  Cargo-package directory rather than only by Nx project tag.
- Plug into `nx release publish` so a single `nx release publish` covers
  both `npm publish` for JS and `cargo publish` for Rust.

**Release modes (spec §6.8):**

- Fixed release group: all crates share one version, bumped together.
- Independent: crates version separately based on conventional commits
  scoped per crate.
- Mixed: a release group covering a subset of crates (e.g. Anvil kernel
  crates as one group, utility crates independent).

## Out of Scope

- The actual publish-credential management (npm token, crates.io token,
  registry token). That's a CI concern; the executor consumes whatever
  cargo can read from its env.
- Yanking — `cargo yank` is rare and manual; not in scope for this
  module's first cut.
- Workspace inheritance refactors (moving from per-crate
  `version = "x.y.z"` to `version.workspace = true`) — covered as an
  opt-in feature in [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md)
  if a consumer asks.
- Migration of an existing JS-only Nx release config to mixed JS+Rust —
  covered in [15-monodon-migration](./15-monodon-migration.aps.md) for
  Monodon consumers; general migration is a docs item in
  [16-adoption-and-docs](./16-adoption-and-docs.aps.md).

## Interfaces

### Depends On

- `cargo publish`, `cargo package` (Cargo public contract).
- `@nx/devkit ^22.6.5` and Nx release's release-group + changelog
  contracts.
- v0.1's `release-publish` executor and `release-version` generator.
- [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md)
  — workspace-dep edges drive the internal-dep cascade.
- [03-target-inference](./03-target-inference.aps.md) — inferred
  `release-publish` target per crate.

### Exposes

- Cargo-aware `nx release version`: bumps `Cargo.toml` versions and
  cascades to internal dependents.
- Cargo-aware `nx release publish`: publishes crates in dependency
  order with dry-run and registry support.
- Cargo-aware `nx release changelog`: contributes entries from
  Cargo-package directories.
- `package.metadata.nxrust.publish` flag for crate-level publish opt-out.

## Constraints

- **Internal-dep cascade must be order-correct.** Publishes happen in
  topological order from the graph in
  [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md).
  A dependent crate must not publish before its dependency.
- **Dry-run is safe by default.** `nx release publish --dry-run` must
  never call `cargo publish` (no `--dry-run` flag to cargo if Cargo's
  dry-run still hits the network — verify and document).
- **Failed publish leaves a recoverable state.** Partial publishes
  (some crates succeeded, one failed) must produce a clear "resume here"
  instruction, not an opaque error.
- **Comments and formatting preserved in `Cargo.toml`.** Inherits the
  v0.1 generator contract.
- **No publish without explicit auth.** The plugin never silently picks
  up a credential it didn't expect.
- **release-publish stays "unvalidated against a real token"** per index
  open question 2 until a real consumer publishes. Promotion of release
  work items implies validating against a real consumer publish.

## Ready Checklist

Promote individual Work Items to Ready when:

- [ ] A real consumer asks to publish a crate (per D-007).
- [ ] The consumer's release shape is captured (fixed vs independent,
      registry target, changelog expectations).
- [ ] A dry-run validation path is identified.
- [ ] A Work Item is drafted.

## Work Items

_No work items yet — module is Proposed. Items promote individually on
real-consumer asks per D-007._

## Risks & Mitigations

| Risk                                                                                                   | Impact | Likelihood | Mitigation                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Partial publish leaves the workspace in an inconsistent versions state                                 | high   | medium     | Topological publish; clear "resume from crate X" diagnostic on failure ([14-diagnostics](./14-diagnostics.aps.md))                                                   |
| Internal-dep cascade misses a `path = "..."` dep without an explicit `version = "..."`                 | medium | medium     | Detect `path = "..."` deps without `version =` and warn at version-bump time; document the require-version convention                                                |
| `cargo publish --dry-run` still hits the network in some versions                                      | medium | low        | Verify per supported Cargo version; document the verification result; keep `nx release publish --dry-run` as a soft barrier with explicit consent for the cargo call |
| Mixed JS+Rust release-group ordering surprises consumers                                               | medium | medium     | Make ordering explicit in Nx release output; document the rule (JS first or Rust first based on dep direction)                                                       |
| `package.metadata.nxrust.publish = false` collides with `cargo publish = false` already in `[package]` | low    | low        | Honour both; document precedence (cargo's takes priority — it's the Cargo contract)                                                                                  |

## Decisions

- **D-R1:** Internal-dep cascade is order-correct via the graph from
  [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md).
  _Accepted._
- **D-R2:** Fixed and independent release modes are both supported.
  Mode is per release-group, not workspace-wide. _Accepted (inherits spec
  §6.8)._
- **D-R3:** `release-publish` stays unvalidated against a real token
  until a real consumer publishes. Promotion of any work item in this
  module implies validating against that consumer. _Accepted (inherits
  index open question 2)._

## Open Questions

- [ ] Does Anvil want fixed or independent release initially? Spec §6.8
      says "Anvil may prefer fixed". Confirm at promotion.
- [ ] Should the Cargo changelog entries be parsed back into
      `CHANGELOG.md` files per crate, or aggregated workspace-wide? Nx
      release does per-project by default; mirror that.
- [ ] Does the consumer want `cargo-release` (the community tool)
      compatibility, or full Nx release integration? They are different
      models. Nx release is the spec direction.
- [ ] What's the right error UX when `cargo package` validation fails
      (typically a missing `description`, `license`, etc.)? Surface
      directly via [14-diagnostics](./14-diagnostics.aps.md).
- [ ] Should `release-version` generator be deprecated in favour of
      `nx release version`? Once Nx release covers it, the generator
      becomes redundant. Defer to promotion + consumer feedback.
