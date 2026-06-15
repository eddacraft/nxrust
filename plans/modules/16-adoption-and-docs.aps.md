<!-- APS Module: 16-adoption-and-docs -->
<!-- Status: Proposed -->

# Adoption and Docs

`create-nx-workspace` preset, public documentation, example workspaces,
Nx Console-friendly schemas, and the v1.0 stable contract.

| ID    | Owner     | Status   |
| ----- | --------- | -------- |
| ADOPT | eddacraft | Proposed |

## Purpose

The previous fifteen modules cover capabilities. This one covers
**discoverability and adoption**: how a consumer who has never seen
nxrust finds it, learns it, and decides whether it fits.

Spec §8.3 (v0.4 adoption-ready) and §8.4 (v1.0 stable contract) live
here. Three threads sit alongside each other:

1. **Bootstrap path** — `create-nx-workspace --preset @eddacraft/nxrust`
   so a new consumer can scaffold a working mixed TS+Rust workspace in
   one command.
2. **Documentation surface** — public docs site, examples, Nx
   Console-friendly schemas, compatibility matrix for Nx versions.
3. **v1.0 stability promise** — documented inference contract,
   documented cache contract, semver-backed schemas, official migration
   guide.

This module absorbs the `preset` generator from the original
`02-monodon-parity` module (the preset is workspace-bootstrap, with
packaging implications distinct from in-workspace generators) and the
v1.0 stable-contract work from index roadmap §8.4.

## In Scope

**Workspace bootstrap (spec §8.3, original 02-monodon-parity's `preset`):**

- `preset` generator — entry point Nx invokes for
  `create-nx-workspace --preset @eddacraft/nxrust`.
- Spawns a fresh workspace pre-wired with: Cargo workspace `Cargo.toml`,
  a sample crate, nxrust plugin registration in `nx.json`, named inputs
  per [04-cache-semantics](./04-cache-semantics.aps.md), and a baseline
  CI workflow.
- Packaging: the preset must be reachable without nxrust already being
  installed in a workspace — this is what makes the bootstrap path
  different from in-workspace generators ([07-generators](./07-generators.aps.md)).
- Variants: `--with-napi`, `--with-wasm`, `--with-axum`,
  `--with-ratatui` — each gated on the relevant module being promoted
  ([10-wasm-napi](./10-wasm-napi.aps.md) for napi/wasm).

**Public docs (spec §8.3, §8.4):**

- Documentation site — content lives in `docs/`, published via a static
  site generator (mdBook, Astro Starlight, or similar; choice deferred
  to first promotion).
- Sections:
  - Getting started: install, register, first run.
  - Cargo-native concepts: inference rules, named inputs, configurations.
  - Cache rules: per-target outputs, env-var allowlist, toolchain
    participation.
  - Executors and generators reference (auto-generated from schema
    JSON where possible).
  - Release flow: fixed vs independent, internal-dep cascade, registries.
  - Supply chain: audit, deny, outdated patterns.
  - Migration: from `@monodon/rust`
    ([15-monodon-migration](./15-monodon-migration.aps.md) cross-link).
  - Compatibility matrix: nxrust ↔ Nx version pairings.
  - Diagnostic catalogue
    ([14-diagnostics](./14-diagnostics.aps.md) cross-link).
  - Recipes (`docs/recipes/`) — focused how-to guides for specific
    failure modes and patterns. First recipe:
    `docs/recipes/javascript-rust-test-seams.md` (ISS-001 / D-WN4
    consumer-facing companion).

**Example workspaces (spec §8.3):**

- Examples under `examples/` in the repo:
  - CLI (binary crate with `clap` and `tracing`).
  - TUI (Ratatui).
  - Service (Axum + Tokio).
  - WASM (`wasm-pack` browser-targeted crate).
  - NAPI (napi-rs sibling JS package).
  - Mixed TS+Rust (TS frontend + Rust backend via napi-rs or HTTP).
- Each example carries its own README and is exercised by the CI
  fixture matrix from [04-cache-semantics](./04-cache-semantics.aps.md).

**Nx Console schemas (spec §8.3):**

- Every executor and generator `schema.json` includes Nx Console-friendly
  metadata: `x-prompt`, `x-priority`, descriptions, default values.
- IDE integration: Nx Console picks up the schemas without further
  configuration; "Run Target" UI shows executor options correctly.
- Schemas validate against Nx's expected shape — tested in CI.

**v1.0 stable contract (spec §8.4):**

- **Stable inference contract:** the rules from
  [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md),
  [03-target-inference](./03-target-inference.aps.md),
  [06-toolchain-awareness](./06-toolchain-awareness.aps.md) are
  documented and frozen at v1.0; changes after that are major bumps.
- **Stable release support:** [08-release-support](./08-release-support.aps.md)'s
  surface frozen at v1.0.
- **Robust cache docs:** [04-cache-semantics](./04-cache-semantics.aps.md)
  contract published as the authoritative reference.
- **Semver-backed schema:** every executor and generator carries a
  schema version; minor bumps add fields, major bumps remove or
  restructure.
- **Compatibility matrix for Nx versions:** which nxrust versions
  support which Nx versions, published and updated per release.
- **Official migration guide:** the `migrate-from-monodon` flow
  ([15-monodon-migration](./15-monodon-migration.aps.md)) plus any
  internal nxrust migrations between minor versions.

## Out of Scope

- Marketing — landing page copy, brand voice, conference talks. The
  docs site is technical reference, not promotion.
- Hosting infrastructure — Cloudflare Pages, Vercel, GitHub Pages
  choice. Operational; deferred to first promotion.
- Translating docs. UK English only in v0.x.
- The migration generator itself (covered in
  [15-monodon-migration](./15-monodon-migration.aps.md)).
- Anvil-specific presets (e.g. policy crate baseline). Spec open
  question 6: live in a separate EddaCraft plugin, not in nxrust.

## Interfaces

### Depends On

- Most of the other modules — this is the "expose the surface
  publicly" capstone.
- A static site generator (mdBook / Starlight / similar — TBD).
- `create-nx-workspace`'s preset contract (Nx public contract).
- [10-wasm-napi](./10-wasm-napi.aps.md) for the `--with-napi`,
  `--with-wasm` preset variants.

### Exposes

- `@eddacraft/nxrust:preset` generator.
- Public docs site at a TBD URL.
- `examples/` directory with runnable examples.
- Nx Console-validated executor and generator schemas.
- A compatibility matrix table in `docs/compatibility.md`.
- A v1.0 stable contract document in `docs/`.

## Constraints

- **Preset must be reachable without nxrust pre-installed.** The
  packaging shape of the preset is different from in-workspace
  generators — it's invoked by `create-nx-workspace` before the
  workspace exists. Verified against the `create-nx-workspace`
  contract.
- **Examples must run in CI.** Every example workspace is exercised in
  the CI fixture matrix from
  [04-cache-semantics](./04-cache-semantics.aps.md); examples that
  break the build break this module.
- **Docs site is generated, not hand-rolled.** Auto-generation from
  schemas + Markdown source so docs stay in sync with code.
- **Schemas validate.** A CI lint runs `Ajv`-style validation of every
  `schema.json` against the Nx Console expected shape.
- **v1.0 contract is documented before the version bump.** No "v1.0
  surprise"; the contract doc lands as a v0.4.x patch, then the
  version bumps when the contract has been stable across at least one
  release cycle.
- **Compatibility matrix is updated per release.** Not a one-time
  effort; every release entry adds a row.

## Ready Checklist

Promote individual Work Items to Ready when:

- [ ] A real consumer asks for the bootstrap, docs, or v1.0 contract
      (per D-007). The docs site especially is a build-on-demand: it
      promotes when there's a real external consumer asking how to
      adopt nxrust without reading the source.
- [ ] The scope is captured: which preset variant, which docs section,
      which example.
- [ ] A Work Item is drafted.

## Work Items

The module stays Proposed; individual items promote on real-consumer asks
per D-007. The v1.0 contract items wait until the underlying modules
(02, 03, 04, 06, 08) have stable shipped surface, then promote as a
coherent contract-doc push.

### ADOPT-001 — JavaScript/Rust test seams recipe

**Status:** Complete: 2026-05-20
**Triggered by:** Anvil PR eddacraft/anvil-001#1729 (ISS-001).
**Packages:** `@eddacraft/nxrust` (docs only)

- **Intent:** Publish a recipe so adopters of mixed TS+Rust Nx workspaces
  can find the cross-language `^build` failure mode and the canonical
  script-split workaround without reading the source.
- **Expected Outcome:** `docs/recipes/javascript-rust-test-seams.md`
  exists, explains the seam, names the failure mode (cargo `target/` lock
  contention under mixed-stack `nx run-many`), captures the script-split
  fix (`test:js && test:rust`), and cites anvil-001#1729 as empirical
  reference.
- **Validation:** Recipe linked from this module's docs Sections list;
  recipe references D-WN4 in `10-wasm-napi.aps.md` and ISS-001 in
  `plans/issues.md`; recipe is reachable from `docs/` index when the
  static site lands (forward-link tolerated until docs site promotion).
- **Scope:** Recipe markdown only. The static-site-generator choice
  (open question) and the broader recipes infrastructure stay deferred.
- **Files:** `docs/recipes/javascript-rust-test-seams.md` (new).

## Risks & Mitigations

| Risk                                                                        | Impact | Likelihood | Mitigation                                                                                                                              |
| --------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Preset shape drifts ahead of Nx's `create-nx-workspace` contract            | medium | medium     | CI test that runs `create-nx-workspace --preset @eddacraft/nxrust` against the supported Nx version range; pin the contract per release |
| Docs site goes stale                                                        | high   | high       | Auto-generation from schemas; CI fails if generated docs diverge from source; example workspaces tested in CI                           |
| Examples become unmaintained snippets that don't actually run               | high   | medium     | Same CI fixture matrix runs them; broken example = broken module = release blocker                                                      |
| Nx Console integration breaks on Nx upgrade                                 | medium | medium     | Compatibility matrix; CI smoke against the supported Nx version range                                                                   |
| v1.0 contract published prematurely and then needs major-bumping at v2.0    | high   | low        | Contract waits until at least one release cycle with stable surface; explicit "v1.0 readiness" Work Item before the bump                |
| Anvil-specific content leaks into the public docs                           | medium | medium     | Spec open question 6: Anvil presets live elsewhere; docs reference but don't ship Anvil specifics                                       |
| Static-site-generator choice locks the project into a stack we later regret | low    | medium     | Source-of-truth Markdown in `docs/`; generator is a thin layer that can be swapped                                                      |

## Decisions

- **D-AD1:** `preset` (workspace-bootstrap) lives in this module, not
  in [10-wasm-napi](./10-wasm-napi.aps.md) where the original
  02-monodon-parity placed it. Different scope: workspace bootstrap vs
  in-workspace generators. _Accepted 2026-05-17 (refactor decision)._
- **D-AD2:** Examples must run in the CI fixture matrix; broken
  examples block release. _Accepted._
- **D-AD3:** Docs are auto-generated from schemas where possible; hand-
  written content lives in Markdown source. _Accepted._
- **D-AD4:** v1.0 contract is documented before the version bump.
  _Accepted (inherits spec §8.4)._
- **D-AD5:** Anvil-specific presets and content do not ship in nxrust
  itself. _Accepted (inherits spec open question 6)._

## Open Questions

- [ ] Static site generator choice — mdBook (Rust-native, simple),
      Astro Starlight (richer features, JS-native), VitePress, Docusaurus?
      Defer to first promotion; mdBook is the most natural pairing for
      a Rust plugin's docs.
- [ ] Docs hosting — Cloudflare Pages, GitHub Pages, Vercel, custom?
      Operational; defer.
- [ ] Should the preset auto-include a `THIRD-PARTY-NOTICES.md` template
      to remind consumers about borrowed-code attribution? Probably no;
      that's a nxrust-internal concern, not a consumer-side concern.
- [ ] Should the compatibility matrix be in docs only, or also enforced
      in `package.json` `peerDependencies`? Both — `peerDependencies`
      gives npm-side enforcement, docs gives the human-readable history.
- [ ] What's the v1.0 release trigger? Calendar-based (e.g. "v1.0 at
      18 months of v0.x stability") or capability-based (e.g. "v1.0
      when modules 02, 03, 04, 06, 08 are all out of Proposed")? Spec
      §8.4 suggests capability-based. Capability-based, with the
      contract-doc promotion as the explicit Work Item.
- [ ] Should Anvil-style presets live in `nxrust` or in a separate
      EddaCraft plugin package? Spec open question 6 — defer to
      promotion. Default position: separate plugin, this module stays
      neutral.
