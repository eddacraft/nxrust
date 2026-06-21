<!-- APS Module: 03-target-inference -->
<!-- Status: Proposed -->

# Target Inference

Auto-infer Nx targets for every Rust crate, so consumers never need
per-crate `project.json` files for the canonical case.

| ID      | Owner     | Status                                                                                                |
| ------- | --------- | ----------------------------------------------------------------------------------------------------- |
| TARGETS | eddacraft | Proposed (TARGETS-001 + TARGETS-002 Complete 2026-06-11, released 0.3.0; further items promote per D-010) |

## Purpose

v0.1 generates a minimal `project.json` per crate at generator time, wiring
each executor target explicitly. Spec §6.3 expects the opposite: every
inferred Rust project receives sensible Cargo-backed targets automatically,
and `project.json` exists only when a consumer wants to override.

This module makes target inference the default. It is the single biggest
DX shift between v0.1 and v0.2: consumers can `git pull` a Rust crate into
a workspace, and Nx sees the targets without manual wiring. It also
captures the `fmt` / `fmt-check` split called out in spec §6.3 and §8.1.

## In Scope

**Default target inference per crate:**

- `check`, `build`, `test`, `lint` (alias `clippy`), `fmt-check`, `fmt`,
  `run` (binary crates only), `release-publish`.
- Each target keyed to the cargo package name on every invocation (the
  v0.1.1 pin fix stays in place — see `CHANGELOG`).
- Default `inputs` reference the named inputs introduced in
  [04-cache-semantics](./04-cache-semantics.aps.md) (`rustSources`,
  `rustWorkspace`).
- Default `outputs` per target follow the conservative table in spec §6.4.
- Default `dependsOn` for `test` and `build` reflect cross-crate edges from
  [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md).

**`fmt` / `fmt-check` split (spec §6.3, §8.1):**

- `fmt-check` runs `cargo fmt --check`, is safely cacheable, and is the CI
  default.
- `fmt` runs `cargo fmt`, mutates files, and is not remote-cacheable. Local
  cache acceptable.
- Generator-emitted `project.json`s lose their explicit `fmt` target where
  inference is enough; existing `project.json`s remain untouched.

**Per-crate overrides:**

- `package.metadata.nxrust.targets.<name>` table parsed by
  [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md)
  feeds target option defaults (e.g.
  `[package.metadata.nxrust.targets.test] all-features = true`).
- Plugin options (`buildTargetName`, `checkTargetName`, etc.) already
  exist in v0.1 — extended to cover the full target set.
- Existing `project.json` entries in a consumer take precedence over
  inferred targets (consumer-explicit wins).

## Out of Scope

- New executors (covered by [09-supply-chain](./09-supply-chain.aps.md),
  [11-nextest](./11-nextest.aps.md), etc.).
- Feature/profile option plumbing — that's
  [05-cargo-features](./05-cargo-features.aps.md).
- Cache input/output details — that's
  [04-cache-semantics](./04-cache-semantics.aps.md).
- Removing the `crate` / `library` / `binary` generators' `project.json`
  emission entirely — generators stay; emission becomes optional and
  defaults to off in a later module-promotion.
- Workspace-level targets — that's
  [12-workspace-synthetic-project](./12-workspace-synthetic-project.aps.md).

## Interfaces

### Depends On

- [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md)
  — inferred project list and `package.metadata.nxrust` parser.
- [04-cache-semantics](./04-cache-semantics.aps.md) — named inputs.
- v0.1 `inferProjectConfig` in `src/utils/`.

### Exposes

- Inferred targets in `createNodesV2` output for every Rust project.
- A documented set of plugin-option target-name overrides.
- A documented `package.metadata.nxrust.targets.<name>` override shape.

## Constraints

- **No `project.json` regression.** Existing consumer `project.json`
  entries take precedence; inference fills the gaps.
- **Cargo package name pinned on every target.** Inherits the v0.1.1 fix.
  Every inferred target's options carry `package: <cargo-name>` regardless
  of the Nx key.
- **`fmt` stays non-remote-cacheable.** Mutating targets must not be
  cached to a shared remote.
- **Stable target names.** Adding new target names is a minor bump
  (D-008). Renaming an inferred target is a major bump.
- **Inference must be deterministic.** Same workspace shape ⇒ same target
  set, target options, and target order across runs.

## Ready Checklist

Promote individual Work Items to Ready when:

- [x] A real consumer asks for the inference behaviour or hits a gap
      (per D-007). **Met 2026-06-10:** index D-010 — consumer demand
      confirmed for the fully functioning adapter, satisfying the
      trigger plan-wide.
- [x] The desired inferred-target output is captured (Nx project JSON
      slice). Captured in TARGETS-001's Expected Outcome.
- [x] A Work Item is drafted scoped to that gap. TARGETS-001 below.
- [x] The CHANGELOG entry shape is drafted (minor bump for additions).
      Noted in TARGETS-001: minor bump per D-008, entry calls out the
      new inferred target set.

## Work Items

### TARGETS-001: Inferred default target set per crate

**Status: Complete: 2026-06-11** — PR #24 squash-merged as `66a0fa2`
(all CI checks green; 158/158 unit tests; e2e asserts the exact
inferred target set end-to-end). Unreleased: ships in the next minor
per D-008 (CHANGELOG § Unreleased). The Copilot review finding
(subset assertion let unexpected extra targets pass) was fixed in the
same PR — the e2e now requires exact set equality.
**Packages:** `@eddacraft/nxrust`
**Depends on:** GRAPH-001 (Released 0.2.0 — `package.metadata.nxrust`
parser), module 04 named inputs (Complete).

- **Intent:** Every inferred Rust project receives the canonical
  Cargo-backed target set automatically — `check`, `build`, `test`,
  `lint` (alias `clippy`), `fmt-check`, `fmt`, `run` (binary crates
  only), `release-publish` — so the canonical case needs no per-crate
  `project.json`. Includes the `fmt` / `fmt-check` split (D-T2).
  Trigger: consumer demand for the fully functioning adapter (index
  D-010, 2026-06-10).
- **Expected Outcome:** A crate with no `project.json` reports the full
  inferred target set via `nx show project <crate> --json`. Each
  inferred target pins `package: <cargo-name>` in its options (D-T3),
  references the module 04 named inputs (`rustSources`,
  `rustWorkspace`), and carries the conservative per-target `outputs`
  from spec §6.4. `fmt-check` is cacheable; `fmt` is not
  remote-cacheable. Existing consumer `project.json` targets take
  precedence over inferred ones (D-T1). Inference is deterministic:
  same workspace shape ⇒ same target set, options, and order. Ships as
  a **minor** bump with a CHANGELOG entry (D-008).
  **Reconciled against code 2026-06-11** (code is fact, plan carries
  intent): most of this outcome already shipped across v0.1 +
  modules 04/06 + GRAPH-001 — `inferProjectConfig` in `src/graph.ts`
  emits `build`, `check`, `clippy`, `fmt`, `fmt-check`, `test`, `run`
  (binary crates only), and `nx-release-publish` (non-private crates)
  with pinned package names, named inputs, toolchain runtime hashing,
  and narrowed build outputs. The code gap this item closes is the
  `lint` alias (D-T4) plus contract tests locking the full inferred
  set and its determinism. Two drift corrections from the original
  draft: (1) the publish target is **`nx-release-publish`** — the name
  Nx's `nx release publish` invokes; it shipped in v0.1 and renaming
  is a major bump — the draft's `release-publish` referred to the
  executor, not the target name. (2) `build` / `test` carry **no
  `dependsOn`**: cargo builds dependency crates itself (index
  constraint: cargo stays the build engine), affected correctness
  comes from the graph _edges_ `createDependencies` already emits, and
  a `^build` default would re-introduce the `target/`-lock
  serialisation hazard (ISS-001 / D-009) within the module 04 cache
  contract that shipped without it.
- **Validation:** Unit suite green via `pnpm test` (inference cases
  covering target set, package pinning, precedence, determinism, and
  binary-only `run`). E2e: `nx show project <crate> --json` in the
  validation workspace lists the inferred targets for a crate with no
  `project.json`, and the v0.1 consumer surface is unregressed (CI
  smoke stays green).
- **Scope/Non-scope:** In scope: inference of the default target set
  and the `fmt` / `fmt-check` split. Out of scope:
  `package.metadata.nxrust.targets.<name>` option overrides
  (TARGETS-002), feature/profile plumbing (module 05), new executors,
  and changes to generator `project.json` emission.

### TARGETS-002: `package.metadata.nxrust.targets.<name>` overrides

**Status: Complete: 2026-06-11** — PR #26 squash-merged as `cef81ff`
(all CI checks green; 171/171 unit tests; e2e asserts the metadata
default reaches the inferred test target end-to-end). Unreleased:
ships in the next minor per D-008 (CHANGELOG § Unreleased, alongside
TARGETS-001's `lint` alias). Implementation notes: a metadata
`toolchain` feeds both the executor option and the cache runtime
input via the TOOLCHAIN-002 hierarchy (D-TC2 steps 3-4) so toolchain
updates stay cache-correct (D-TC3); guard rails — `package` pin not
overridable, `check` stripped from `fmt-check`, `lint` follows the
`clippy` table (D-T4), malformed/unknown entries warn and are
ignored.
**Packages:** `@eddacraft/nxrust`
**Depends on:** TARGETS-001 (Complete: 2026-06-11).

- **Intent:** Per-crate target option defaults declared in
  `[package.metadata.nxrust.targets.<name>]` feed the inferred targets
  (e.g. `[package.metadata.nxrust.targets.test] all-features = true`),
  using the GRAPH-001 parser, so per-crate tuning needs no
  `project.json` either.
- **Expected Outcome:** A crate carrying a `targets.<name>` metadata
  table yields inferred targets whose options reflect the declared
  defaults; consumer-explicit `project.json` still wins (D-T1); unknown
  keys warn rather than throw (routes via module 14's envelope when it
  ships).
- **Validation:** Unit suite green via `pnpm test`; e2e
  `nx show project --json` reflects a metadata-declared option default.

_Further items (plugin-option target-name coverage, generator
`project.json` emission opt-out) promote in dependency order per
D-010._

## Risks & Mitigations

| Risk                                                                          | Impact | Likelihood | Mitigation                                                                                                                                |
| ----------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Inferred targets clash with existing consumer `project.json`                  | high   | medium     | Consumer-explicit wins; document precedence; surface a single-line "inferred / overridden by" diagnostic in `nx show project` if feasible |
| Adding `fmt-check` as a new default breaks consumer scripts that grep targets | low    | medium     | Minor bump + CHANGELOG; provide a plugin option to suppress                                                                               |
| Inferred `outputs` over-cache on the wrong target                             | high   | medium     | Follow [04-cache-semantics](./04-cache-semantics.aps.md) conservative defaults; per-target validation in CI fixture matrix                |
| `package.metadata.nxrust.targets.<name>` typos silently ignored               | medium | medium     | Reject unknown keys with a warning (`14-diagnostics`); CI lint that exercises a known-typo fixture                                        |

## Decisions

- **D-T1:** Inferred targets are additive; consumer-explicit
  `project.json` always wins. _Accepted._
- **D-T2:** `fmt` and `fmt-check` are split targets. `fmt-check` is
  cacheable; `fmt` is not. _Accepted (inherits spec §6.3)._
- **D-T3:** Every inferred target pins the cargo package name in its
  options. Inherits the v0.1.1 fix; documented as a contract. _Accepted._
- **D-T4:** `clippy` stays the canonical inferred lint target (matches
  the executor name and the shipped v0.1 surface); `lint` is inferred
  as an alias with an identical configuration so ecosystem-wide
  invocations (`nx run-many -t lint`, `nx affected -t lint`) include
  Rust crates alongside JS projects. Both cache independently; adding
  the alias is a minor bump (D-008). _Accepted 2026-06-11
  (TARGETS-001)._

## Open Questions

- [ ] Should the generator-emitted `project.json` move to opt-in
      ("`--with-project-json`") once inference covers the canonical case?
      Defer to first promotion.
- [x] Should `lint` keep its alias to `clippy`, or should the canonical
      name change to `clippy` with `lint` as the alias? **Resolved
      2026-06-11 (D-T4):** `clippy` is canonical; `lint` is inferred as
      an identical alias so `nx run-many -t lint` covers Rust crates.
- [ ] Should `run` be inferred only when `[[bin]]` exists in
      `Cargo.toml`, or always inferred and emit a clean "not a binary
      crate" diagnostic on invocation? Latter is more uniform; former is
      cleaner in `nx show project`.
