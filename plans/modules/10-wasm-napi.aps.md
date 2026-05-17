<!-- APS Module: 10-wasm-napi -->
<!-- Status: Proposed -->

# WASM and NAPI

`wasm-pack` and `napi-rs` executors and generators. Closes the
Monodon-parity surface for Node-native and browser-targeted Rust crates.

| ID | Owner | Status |
|----|-------|--------|
| WASM-NAPI | eddacraft | Proposed |

## Purpose

Spec §6.10 says: some Rust workspaces need WASM (browser/edge) or
Node-native module support, and Monodon already exposes this shape, so
compatibility expectations exist. But WASM and NAPI should not dominate
the core plugin model — they are optional capability packs.

This module ships the executors and generators that bring nxrust to
parity with `@monodon/rust`'s WASM/NAPI surface, while keeping the core
Cargo-native plugin uncluttered. It absorbs the WASM/NAPI items from the
original `02-monodon-parity` module (now refactored away).

## In Scope

**NAPI (`napi-rs`):**

- `napi` executor — wraps `napi build` and `napi prepublish` for napi-rs
  crates that produce a Node-loadable `.node` binary.
- `add-napi` generator — converts an existing Rust crate into a napi-rs
  crate: Cargo manifest deltas (`crate-type = ["cdylib"]`,
  `napi-derive` dep, `napi-build` build-script), `package.json` shape for
  the sibling JS package, `napi.config.json` baseline.
- `create-napi-npm-dirs` generator — generates per-target npm
  sub-package directories that napi-rs expects for prebuilt
  platform-specific binaries (e.g. `npm/darwin-arm64`,
  `npm/linux-x64-gnu`).

**WASM (`wasm-pack`):**

- `wasm-pack` executor — wraps `wasm-pack build` for crates targeting
  `wasm32-*`. Supports `--target` (`bundler`, `nodejs`, `web`,
  `no-modules`), `--release`, `--scope`, output directory.
- `add-wasm` generator — converts an existing Rust crate into a
  `wasm-pack`-buildable crate: `crate-type = ["cdylib", "rlib"]`,
  `wasm-bindgen` dep, sibling `pkg.json` shape.
- `add-wasm-reference` generator — wires a JS/TS project to consume a
  sibling `wasm-pack` crate: dep in the JS `package.json`, optional types
  entry, bundler-specific glue (Vite/webpack/Next).

**Cache:**

- `napi` and `wasm-pack` executors cache the build artefact directory
  (`.node` for napi, `pkg/` for wasm). Cache rules inherit from
  [04-cache-semantics](./04-cache-semantics.aps.md) — toolchain + target
  triple + features participate in the key.
- WASM target triples (`wasm32-unknown-unknown` etc.) participate
  explicitly so a `--target=web` cache hit cannot satisfy a
  `--target=nodejs` invocation.

**Borrow vs rewrite:**

- Per index D-001 (and the original 02-monodon-parity's D-P2), borrowing
  from `@monodon/rust` (MIT) is permitted where it saves real time.
- Borrowed code carries a top-of-file attribution comment naming the
  source file and commit SHA, plus a `THIRD-PARTY-NOTICES.md` entry
  preserving the MIT licence text.
- Borrow vs rewrite decision is recorded per item at promotion time;
  napi-rs v3 may have shipped a new CLI shape that makes a borrow stale,
  in which case rewriting is cheaper.

## Out of Scope

- `create-nx-workspace` preset (workspace bootstrap) — that's
  [16-adoption-and-docs](./16-adoption-and-docs.aps.md). The original
  02-monodon-parity grouped them; they are split because preset is
  packaging-different (must be reachable without the plugin already
  installed).
- Generic `ffi` crate generator (cdylib for non-Node, non-WASM cases) —
  that's [07-generators](./07-generators.aps.md).
- Publishing the resulting npm packages — that flow uses the consumer's
  existing `nx release publish` for the JS sibling; the Cargo side uses
  [08-release-support](./08-release-support.aps.md).
- `wasm-bindgen`-only flows that bypass `wasm-pack`. Possible later, not
  in this module's first cut.

## Interfaces

### Depends On

- `napi-rs` CLI (`@napi-rs/cli`) on PATH or in the consumer's
  `devDependencies`.
- `wasm-pack` binary on PATH (`cargo install wasm-pack` or rustup).
- v0.1's executor and generator scaffolding utilities.
- [03-target-inference](./03-target-inference.aps.md) — for inferring the
  `napi` / `wasm-pack` targets on appropriately-shaped crates.
- [04-cache-semantics](./04-cache-semantics.aps.md) — output narrowing
  rules for WASM/NAPI artefacts.
- [07-generators](./07-generators.aps.md) — shared generator helpers.

### Exposes

- Executors: `napi`, `wasm-pack`.
- Generators: `add-napi`, `add-wasm`, `add-wasm-reference`,
  `create-napi-npm-dirs`.
- Cache contract for WASM/NAPI artefact directories.

## Constraints

- **Attribution mandatory for borrowed code.** Top-of-file attribution
  comment + `THIRD-PARTY-NOTICES.md` entry preserving the MIT licence
  text. Stripping attribution to make a file "look fresh" is not
  permitted.
- **Apache-2.0 stays the umbrella licence.** Borrowed MIT code is
  compatible; do not introduce dependencies under copyleft licences.
- **Borrow, but verify.** Borrowed code passes nxrust's TypeScript
  strict mode, ESLint config, and Vitest suite. Adapt monodon's patterns
  to nxrust's existing helpers (`buildCargoArgs`, `inferProjectConfig`)
  rather than importing monodon's full abstraction tree.
- **One executor/generator per PR.** Bundled drops make review hard and
  rollback harder.
- **napi-rs CLI version pinning.** Document the supported napi-rs CLI
  version range; reject earlier/later with a diagnostic.
- **Tool-presence detection.** Missing `napi` or `wasm-pack` ⇒
  diagnostic via [14-diagnostics](./14-diagnostics.aps.md), never raw
  shell error.

## Ready Checklist

Promote individual Work Items to Ready when:

- [ ] A real consumer asks for NAPI or WASM (per D-007).
- [ ] The consumer's use case is captured (which executor/generator,
      against which crate shape, with which command shape).
- [ ] Monodon's current implementation is read; a borrow vs. rewrite
      decision is recorded.
- [ ] A Work Item is drafted scoped to the specific item being promoted.
- [ ] The other items stay Proposed.

## Work Items

*No work items yet — module is Proposed. Items promote individually on
real-consumer asks per D-007 — same gate as the original
02-monodon-parity module before refactor.*

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Borrowed monodon code drifts from upstream and we miss a bug fix | medium | medium | Record source commit SHA in file header; periodically diff against upstream when an issue lands |
| napi-rs / wasm-pack ecosystem moves faster than borrowed code | medium | medium | Validate against the consumer's actual napi-rs/wasm-pack version at promotion time; do not promote against a stale monodon snapshot |
| Attribution stripped accidentally during refactor | medium | low | `THIRD-PARTY-NOTICES.md` is the source of truth; CI lint that fails on borrowed-file attribution loss is a v0.4 candidate |
| WASM artefact caching across target triples mixes browser and nodejs builds | high | medium | Target triple participates in cache key; tested in [04-cache-semantics](./04-cache-semantics.aps.md) fixture matrix |
| `add-wasm-reference` glue lags behind bundler upgrades (Vite/webpack/Next) | medium | medium | Template snapshot date in each glue file's comment; bump templates as part of v0.x line |

## Decisions

- **D-WN1:** Borrow vs rewrite is per item, decided at promotion time
  against the consumer's actual napi-rs/wasm-pack version. *Accepted
  (inherits index D-001).*
- **D-WN2:** WASM and NAPI stay optional capability packs, not part of
  the core plugin model. They do not appear in `executors.json` /
  `generators.json` until promotion. *Accepted (inherits spec §6.10).*
- **D-WN3:** `create-nx-workspace` preset is **not** in this module —
  preset lives in [16-adoption-and-docs](./16-adoption-and-docs.aps.md).
  Different scope (workspace-bootstrap vs in-workspace generator).
  *Accepted 2026-05-17 (refactor decision).*

## Open Questions

- [ ] napi-rs has shipped a v3 with a different build CLI shape. Borrow
      from monodon's `napi` executor or rewrite against napi-rs v3?
      Resolve at promotion time against the consumer's napi-rs version.
- [ ] Should `add-napi` and `add-wasm` merge into a single `add-binding`
      generator with a `--kind` option, or stay split? Split is more
      discoverable; merge is more uniform. Resolve at promotion based on
      which one promotes first.
- [ ] Should `wasm-pack` executor expose `wasm-bindgen` directly for
      lower-level flows, or only via `wasm-pack`? `wasm-pack` covers most
      cases; lower-level is a v0.4+ ask.
- [ ] napi-rs prebuilt-binary publishing flow — does the plugin own the
      "publish per-platform package" loop, or does that stay manual? Most
      consumers use a GitHub Actions matrix; the plugin can stay out of
      the matrix and just wrap the build step.
