<!-- APS Module: 07-generators -->
<!-- Status: Proposed -->

# Generators

The generator inventory beyond v0.1's `init`, `crate`, `binary`, `library`,
`release-version`.

| ID | Owner | Status |
|----|-------|--------|
| GEN | eddacraft | Proposed |

## Purpose

v0.1 ships P0 generators (spec §6.7): `init`, `crate`, `library`, `binary`,
`release-version`. Spec §6.7 lists a richer P1 surface — `workspace-crate`,
`cli`, `service`, `tui`, `wasm`, `napi`, `ffi`, `bench`, `xtask`, and an
optional Anvil-style `policy` / `check` preset — plus a refined behaviour
contract (preserve TOML comments, optional README, optional
`package.metadata.nxrust`, optional `cargo-deny`, no `project.json` unless
asked).

This module covers the **language-only** generators. WASM and NAPI
generators ship under [10-wasm-napi](./10-wasm-napi.aps.md) because they
carry their own executor/build-system pairing. The `create-nx-workspace`
preset ships under [16-adoption-and-docs](./16-adoption-and-docs.aps.md) —
it's invoked outside an existing Nx workspace, so it has packaging
implications the other generators do not.

This module also absorbs the "library-only preset" item from the original
`03-v0.2-polish` module (now refactored away).

## In Scope

**Language-only generators (P1, spec §6.7):**

- `workspace-crate` — explicit workspace-member scaffold; same as `crate`
  but with explicit `--workspace` semantics and no fallback to single-crate
  layout. Sharpens the v0.1 `crate` behaviour without breaking it.
- `cli` — binary crate with `clap`, `tracing`, error handling baseline.
- `service` — binary crate with Axum/Tokio baseline.
- `tui` — binary crate with Ratatui baseline.
- `ffi` — Rust crate configured for `cdylib` (`crate-type = ["cdylib"]`,
  `Cargo.toml` shape, default `build.rs` that emits a header if requested).
- `bench` — add a Criterion `benches/` directory + `[[bench]]` entry to an
  existing crate. Pairs with the `bench` executor scoped to
  [11-nextest](./11-nextest.aps.md)'s sibling work (executor mention in
  spec §6.3 P1).
- `xtask` — generate an `xtask` helper crate (the convention from
  `matklad/cargo-xtask`).
- `policy` / `check` preset (Anvil-flavoured) — deterministic policy crate
  layout, optional. See spec open question 6.

**Library-only workspace shape generator** (absorbed from the original
`03-v0.2-polish`):

- A `library-preset`-style generator that scaffolds multiple library
  crates with shared workspace config, doc-test wiring, and README
  scaffolding for a libs-only workspace shape. Distinct from `library`
  (single crate) and from the `create-nx-workspace` preset
  ([16-adoption-and-docs](./16-adoption-and-docs.aps.md)) (fresh workspace
  bootstrap).

**Generator behaviour contract (spec §6.7):**

- Update root `Cargo.toml` `workspace.members` preserving comments and
  formatting (already implemented via `@ltd/j-toml` in v0.1).
- Optionally add workspace dependencies under `[workspace.dependencies]`.
- Optionally create `README.md`.
- Optionally create `cargo-deny` config (`deny.toml`).
- Optionally add a `package.metadata.nxrust` block (default off; opt-in
  via `--with-metadata`).
- Optionally emit `project.json` (default off as
  [03-target-inference](./03-target-inference.aps.md) lands; explicit
  opt-in via `--with-project-json`).

## Out of Scope

- WASM (`wasm-pack`) generator — [10-wasm-napi](./10-wasm-napi.aps.md).
- NAPI (`napi-rs`) generator — [10-wasm-napi](./10-wasm-napi.aps.md).
- `create-nx-workspace` preset (workspace bootstrap) —
  [16-adoption-and-docs](./16-adoption-and-docs.aps.md).
- `migrate-from-monodon` generator —
  [15-monodon-migration](./15-monodon-migration.aps.md).
- v0.1 generators (`init`, `crate`, `binary`, `library`, `release-version`)
  — already shipped; bug fixes to those are CHANGELOG items, not module
  scope.

## Interfaces

### Depends On

- v0.1's `@ltd/j-toml`-backed TOML mutation utilities in
  `src/utils/toml.ts` and `src/utils/add-to-workspace.ts`.
- [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md)
  — generators emit projects that the inference layer can pick up.
- [03-target-inference](./03-target-inference.aps.md) — generators rely on
  inference so they can drop `project.json` from the default output.

### Exposes

- Additional generator entries in `generators.json`.
- A consistent option vocabulary across generators:
  `--directory`, `--tags`, `--with-readme`, `--with-deny`,
  `--with-metadata`, `--with-project-json`, `--workspace-deps`.
- Reusable file-template helpers for the v0.1 generators to adopt.

## Constraints

- **Preserve TOML comments and formatting.** `@ltd/j-toml` is the
  contract.
- **No project.json by default once inference covers the crate.** Opt-in
  via `--with-project-json`. Inherits
  [03-target-inference](./03-target-inference.aps.md) D-T1.
- **Workspace `Cargo.toml` mutations are additive and idempotent.**
  Re-running the generator on an existing crate is a no-op for the
  workspace file.
- **Generated `Cargo.toml`s opt into the inferred toolchain.** They do not
  carry their own `[toolchain]` block unless the consumer asks.
- **Generator options are stable.** Renaming generators or option names
  is a major bump.

## Ready Checklist

Promote individual Work Items to Ready when:

- [ ] A real consumer asks for the specific generator or generator option
      (per D-007).
- [ ] The desired output is captured (target directory tree, generated
      `Cargo.toml`, generated source files).
- [ ] A Work Item is drafted scoped to that generator.
- [ ] The other generators stay Proposed.

## Work Items

*No work items yet — module is Proposed. Items promote individually on
real-consumer asks per D-007.*

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Generator templates lock consumers into a specific crate-version snapshot of `clap`/`tokio`/`axum`/`ratatui` | medium | high | Templates target the latest stable line; document the snapshot date in each `Cargo.toml` template's comment; bump templates as part of the v0.x line |
| `--with-deny` produces a `deny.toml` that breaks the consumer's existing audit policy | medium | low | Default `deny.toml` is permissive; opt-in only |
| Generators silently overwrite an existing crate directory | high | low | Check directory existence first; refuse with diagnostic ([14-diagnostics](./14-diagnostics.aps.md)) |
| Workspace `Cargo.toml` mutation breaks TOML formatting | high | low | `@ltd/j-toml` is the contract; CI fixture exercises a TOML-with-comments round-trip |
| Generator surface grows speculatively | medium | medium | D-007 promotion gate — each generator promotes on a real consumer ask |

## Decisions

- **D-GEN1:** Language-only generators live in this module; WASM/NAPI
  generators live in [10-wasm-napi](./10-wasm-napi.aps.md); workspace
  bootstrap (preset) lives in
  [16-adoption-and-docs](./16-adoption-and-docs.aps.md). *Accepted.*
- **D-GEN2:** Default no `project.json` emission once
  [03-target-inference](./03-target-inference.aps.md) lands. Opt-in via
  `--with-project-json`. *Accepted.*
- **D-GEN3:** Generators preserve TOML comments and formatting via
  `@ltd/j-toml`. *Accepted (inherits v0.1 contract).*

## Open Questions

- [ ] Should the Anvil-flavoured `policy` preset live in nxrust at all,
      or in a separate EddaCraft plugin? Spec open question 6. Defer to
      promotion — the preset is an explicit Anvil ask, not a general
      Rust-Nx need.
- [ ] Should `cli`/`service`/`tui` templates be opinionated (specific
      crates pinned) or scaffold-only (TODO comments, no deps)? Pin a
      stable baseline; documented as a template snapshot.
- [ ] Should `bench` be a separate generator or a `--with-bench` flag on
      `crate`/`library`? Both reasonable; separate is more discoverable.
- [ ] Should the library-only workspace shape generator share a base with
      `create-nx-workspace --preset @eddacraft/nxrust`
      ([16-adoption-and-docs](./16-adoption-and-docs.aps.md))? Templates
      can be shared; entry points differ (in-workspace vs fresh
      workspace).
