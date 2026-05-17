<!-- APS Module: 03-target-inference -->
<!-- Status: Proposed -->

# Target Inference

Auto-infer Nx targets for every Rust crate, so consumers never need
per-crate `project.json` files for the canonical case.

| ID | Owner | Status |
|----|-------|--------|
| TARGETS | eddacraft | Proposed |

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

- [ ] A real consumer asks for the inference behaviour or hits a gap
      (per D-007).
- [ ] The desired inferred-target output is captured (Nx project JSON
      slice).
- [ ] A Work Item is drafted scoped to that gap.
- [ ] The CHANGELOG entry shape is drafted (minor bump for additions).

## Work Items

*No work items yet — module is Proposed. Items promote individually on
real-consumer asks per D-007.*

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Inferred targets clash with existing consumer `project.json` | high | medium | Consumer-explicit wins; document precedence; surface a single-line "inferred / overridden by" diagnostic in `nx show project` if feasible |
| Adding `fmt-check` as a new default breaks consumer scripts that grep targets | low | medium | Minor bump + CHANGELOG; provide a plugin option to suppress |
| Inferred `outputs` over-cache on the wrong target | high | medium | Follow [04-cache-semantics](./04-cache-semantics.aps.md) conservative defaults; per-target validation in CI fixture matrix |
| `package.metadata.nxrust.targets.<name>` typos silently ignored | medium | medium | Reject unknown keys with a warning (`14-diagnostics`); CI lint that exercises a known-typo fixture |

## Decisions

- **D-T1:** Inferred targets are additive; consumer-explicit
  `project.json` always wins. *Accepted.*
- **D-T2:** `fmt` and `fmt-check` are split targets. `fmt-check` is
  cacheable; `fmt` is not. *Accepted (inherits spec §6.3).*
- **D-T3:** Every inferred target pins the cargo package name in its
  options. Inherits the v0.1.1 fix; documented as a contract. *Accepted.*

## Open Questions

- [ ] Should the generator-emitted `project.json` move to opt-in
      ("`--with-project-json`") once inference covers the canonical case?
      Defer to first promotion.
- [ ] Should `lint` keep its alias to `clippy`, or should the canonical
      name change to `clippy` with `lint` as the alias? v0.1 has both;
      consumer convention varies.
- [ ] Should `run` be inferred only when `[[bin]]` exists in
      `Cargo.toml`, or always inferred and emit a clean "not a binary
      crate" diagnostic on invocation? Latter is more uniform; former is
      cleaner in `nx show project`.
