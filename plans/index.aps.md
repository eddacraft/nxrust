<!-- APS Index -->
<!-- Status: In Progress -->

# nxrust — Cargo-native Nx plugin for Rust

| Field | Value |
|-------|-------|
| Status | In Progress |
| Owner | eddacraft |
| Created | 2026-04-21 |
| Last reframed | 2026-05-17 (adopt product spec) |
| Licence | Apache-2.0 |

## Vision

`nxrust` makes Cargo workspaces feel native inside Nx. Cargo stays the build
engine; Nx becomes the orchestration layer that understands the Cargo
workspace deeply enough to run only what changed, cache what is safe,
release crates correctly, and orchestrate Rust alongside TypeScript without
duplicated configuration.

The product thesis, design principles, capability areas, and long-form
roadmap live in [`docs/product-spec.md`](../docs/product-spec.md). The
modules below decompose that vision into bounded work areas.

## Problem

Teams that run Rust crates inside an Nx monorepo had two off-the-shelf
options before nxrust:

- **`@monodon/rust`** — the only community Nx plugin of the right shape,
  but effectively unmaintained: the published package pins
  `@nx/devkit >= 19 < 21` (no Nx 22 support), recent releases ship with
  `0.0.0-…` version tags, and the open-issue backlog has not moved in over
  a year. Licence is MIT — Apache-2.0-compatible, so monodon code may be
  borrowed with attribution where it saves real time.
- **`cargo-make`** — a Rust-only task runner. Does not orchestrate the
  TypeScript side of a mixed monorepo, does not integrate with remote
  caches such as `@nx/azure-cache`, does not provide `nx affected`.

`nxrust@0.1.x` shipped on npm as a maintained Apache-2.0 alternative.
The work tracked here covers the broader thesis: deep Cargo-metadata
inference, cache-correct task wiring, Cargo-aware Nx release, supply-chain
targets, and a clean migration path from Monodon — the v0.2 → v1.0
trajectory in the product spec.

## v0.1 Outcomes (Complete, 2026-05-12)

The shakedown work that established the plugin's baseline. Preserved for
historical reference; full detail in
[`modules/01-v0.1-shakedown`](./modules/01-v0.1-shakedown.aps.md).

- [x] Plugin compiles against `@nx/devkit ^22.6.5` with TypeScript strict
- [x] Executors wrap cargo for `build`, `test`, `check`, `clippy`, `fmt`,
      `run`, `release-publish`
- [x] Generators: `init`, `library`, `binary`, `crate`, `release-version`
- [x] Project-graph plugin (`createNodesV2` + `createDependencies`) emits
      Rust crate nodes + cross-crate edges from `cargo metadata`
- [x] Unit test suite green via Vitest
- [x] End-to-end validation against a real Rust crate in a real Nx 22
      workspace passes and caches
- [x] CI smoke test job in nxrust + dependent-repo smoke in the validation
      workspace
- [x] First `@eddacraft/nxrust@0.1.0` published to npm
- [x] Patch release `0.1.1` for two consumer-surfaced defects
- [x] Consumer switched from `workspace:*` link to the published package

## v0.2 → v1.0 Success Criteria

- [ ] Zero-config target inference: Rust crates participate in Nx without
      per-crate `project.json` files for the canonical case
- [ ] Cache correctness: toolchain, target triple, features, profile, and
      selected env vars are part of the cache key for every cacheable
      target
- [ ] Synthetic `rust-workspace` project exposes workspace-level Cargo
      tasks (`fmt-check`, `audit`, `deny`, `doc`, `cargo-metadata`, etc.)
- [ ] Cargo-aware Nx release covers version bump, internal dep updates,
      dry-run publish, and at least one consumer publish to crates.io or a
      private registry
- [ ] Supply-chain target set (`audit`, `deny`, `outdated`, `licenses`)
      ships with tool-presence-aware diagnostics
- [ ] `migrate-from-monodon` generator converts a real consumer workspace
      from `@monodon/rust` to nxrust with zero loss of behaviour
- [ ] Public documentation site, schema-validated for Nx Console, with
      examples for CLI/TUI/service/WASM/NAPI shapes
- [ ] Stable v1.0 contract: documented inference rules, documented cache
      rules, semver-backed schemas, Nx version compatibility matrix

## Constraints

- **Apache-2.0** across nxrust's own code. Monodon MIT code may be borrowed
  where useful, with per-file attribution and a `THIRD-PARTY-NOTICES.md` at
  repo root preserving the MIT terms.
- Nx **22.x** target. No back-support for Nx 19/20/21 in the v0.x line.
- Cargo stays the build engine. This plugin wraps invocation only — it
  never re-implements compilation or dependency resolution.
- Must work locally without remote-cache credentials — cache miss, not
  failure.
- UK English in plan and README text; user-facing CLI output stays
  locale-neutral.
- Zero regressions on shipped v0.1 surface as v0.2+ work lands. Every
  `cargo check/test/clippy/fmt` invocation that passes today must still
  pass after any plugin change.

## Modules

| # | Module | Spec § | Purpose | Status | Dependencies |
|---|--------|--------|---------|--------|--------------|
| 01 | [v0.1-shakedown](./modules/01-v0.1-shakedown.aps.md) | 3.1 | Prove the plugin end-to-end on a consumer workspace, ship first npm release | Complete | — |
| 02 | [workspace-inference-and-graph](./modules/02-workspace-inference-and-graph.aps.md) | 6.1, 6.2 | Cargo workspace + project graph inference (members, globs, excludes, edges, external nodes, kind metadata) | Proposed (GRAPH-001 released 0.2.0) | 01 |
| 03 | [target-inference](./modules/03-target-inference.aps.md) | 6.3 | Auto-inferred Nx targets per crate; zero `project.json`; `fmt` / `fmt-check` split | In Progress (TARGETS-001 merged 2026-06-11, unreleased; TARGETS-002 Ready) | 02 |
| 04 | [cache-semantics](./modules/04-cache-semantics.aps.md) | 6.4 | Named inputs, output narrowing, env-var hashing, per-target cache rules | Complete | 03 |
| 05 | [cargo-features](./modules/05-cargo-features.aps.md) | 6.5 | Feature/profile/target options across executors; inferred configurations | Proposed | 03 |
| 06 | [toolchain-awareness](./modules/06-toolchain-awareness.aps.md) | 6.6 | `rust-toolchain.toml`, `cargo +toolchain`, `rustc -Vv`/`cargo -V` hashing | Proposed | 04 |
| 07 | [generators](./modules/07-generators.aps.md) | 6.7 | Generator inventory: CLI, service, TUI, ffi, bench, xtask, policy preset | Proposed | 03 |
| 08 | [release-support](./modules/08-release-support.aps.md) | 6.8 | Cargo-aware Nx release: version, internal deps, dry-run, registries, fixed/independent modes | Proposed | 03 |
| 09 | [supply-chain](./modules/09-supply-chain.aps.md) | 6.9 | `audit`, `deny`, `outdated`, `vet`, `sbom`, `licenses` | Proposed | 03 |
| 10 | [wasm-napi](./modules/10-wasm-napi.aps.md) | 6.10 | `napi`, `wasm-pack` executors and generators (Monodon-parity surface) | Proposed (WN-001 released 0.2.0) | 03, 07 |
| 11 | [nextest](./modules/11-nextest.aps.md) | 6.11 | `cargo nextest` executor with profiles, partitions, archive-file | Proposed | 03 |
| 12 | [workspace-synthetic-project](./modules/12-workspace-synthetic-project.aps.md) | 6.12 | Synthetic `rust-workspace` project for workspace-level targets | Proposed | 02 |
| 13 | [affected-refinement](./modules/13-affected-refinement.aps.md) | 6.13 | Lockfile / toolchain / manifest / feature-aware affected behaviour | Proposed | 02, 04 |
| 14 | [diagnostics](./modules/14-diagnostics.aps.md) | 6.14 | Actionable error messages for cargo / toolchain / tool-missing failures | Proposed | — |
| 15 | [monodon-migration](./modules/15-monodon-migration.aps.md) | 6.15 | `migrate-from-monodon` generator + compatibility aliases | Proposed | 03, 07 |
| 16 | [adoption-and-docs](./modules/16-adoption-and-docs.aps.md) | 8.3, 8.4 | `create-nx-workspace` preset, docs site, examples, Nx Console schemas, v1.0 stable contract | Proposed | most |

**Promotion rule.** Modules 02-16 stay Proposed until at least one of their
items has a real downstream ask — an issue, a Slack ping, or a direct
request from a known downstream consumer (Anvil or external). Promotion is
**per-item, not per-module**: a single Work Item promotes to Ready when its
trigger fires, while the rest of the module stays Proposed. This is the
same convention established by the original modules 02-monodon-parity and
03-v0.2-polish (now folded into the modules above) and ratified as D-007.

**Update 2026-06-10 (D-010):** consumer demand now covers the fully
functioning adapter, satisfying the D-007 trigger plan-wide. Items no
longer wait for individual asks; they promote in dependency/roadmap
order (v0.2 → v0.3 → v0.4 → v1.0), one Ready slice at a time, which
preserves D-007's no-speculative-builds discipline as an ordering rule.

## Roadmap milestones

The product spec's roadmap (spec §8) maps onto the modules above. Each
milestone is a logical version target — there is no calendar commitment;
items only ship when a real consumer ask promotes them.

### v0.2 — Make it solid (modules 02, 03, 04, 06, 13, 14)

- Harden cargo metadata graph inference (`02`)
- Infer targets without `project.json` (`03`)
- Split `fmt` and `fmt-check` (`03`)
- Add `no-default-features` option to existing executors (`05`)
- Hash `rustc`/`cargo`/toolchain correctly (`04`, `06`)
- Improve target output narrowing (`04`)
- Add actionable errors (`14`)
- Add CI fixture matrix (cross-cuts; tracked under `04` / `14`)
- Document Anvil migration path (cross-cuts; tracked under `15`)

### v0.3 — Make it compelling (modules 05, 07, 08, 09, 11, 12)

- `cargo nextest` executor (`11`)
- `cargo audit`, `cargo deny`, `cargo outdated` executors (`09`)
- `cargo doc` executor (`12` workspace-level, `03` per-crate)
- Criterion `bench` executor + generator (`07`)
- Synthetic `rust-workspace` project (`12`)
- `package.metadata.nxrust` overrides (`02`, `05`)
- Inferred configurations: `all-features`, `no-default-features`, `release`
  (`05`)
- Cargo-aware Nx release surface (`08`)

### v0.4 — Make it adoption-ready (modules 10, 15, 16)

- `migrate-from-monodon` generator (`15`)
- `wasm-pack` support (`10`)
- `napi-rs` support (`10`)
- `create-nx-workspace --preset @eddacraft/nxrust` (`16`)
- Public docs site + examples (`16`)
- Nx Console-friendly schemas (`16`)
- Example workspaces: CLI, TUI, Axum service, WASM, NAPI (`16`)

### v1.0 — Make it the Rust Nx plugin (module 16)

- Stable inference contract (`02`, `03`, `06`)
- Stable release support (`08`)
- Fixed and independent crate release modes (`08`)
- Robust cache docs (`04`, `16`)
- Semver-backed schema for every executor and generator (`16`)
- Compatibility matrix for Nx versions (`16`)
- Official migration guide (`15`, `16`)

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `target/` caching yields stale artefacts under remote cache | high | Narrow `outputs` per target; cache reports not whole `target/` subtrees. **Resolved 2026-05-12** for `test` (now `outputs: []`) and **2026-05-29** for `build` (narrowed to per-binary/per-rlib paths via CACHE-002, with a `narrowBuildOutputs: false` escape hatch for target-dir/custom-profile/unsupported crate types). Contract closed in `04-cache-semantics` (Complete). |
| Nx 22 project-graph plugin API drifts on minor upgrades | medium | Small public surface (`createNodesV2` + `createDependencies` only); CI smoke test pins the contract; semver-backed schemas land in `16-adoption-and-docs` for v1.0. |
| `cargo metadata` performance on large workspaces | medium | Mtime-keyed `Cargo.lock` cache already in `graph.ts`; performance-tracking in `02-workspace-inference-and-graph` and `13-affected-refinement`. |
| Consumer switchover breaks the consumer's pnpm graph mid-flight | medium | Switch only after the consumer's own CI smoke is green; keep a revert commit ready. Repeats per major version bump. |
| Speculative builds outpace real demand | high | Per-item consumer-driven promotion (D-007). **Updated 2026-06-10:** demand for the full adapter confirmed (D-010); promotion now proceeds in dependency/roadmap order, one Ready slice at a time, so build order still tracks the roadmap rather than speculation. |
| Cache-key gaps cause silent miscompiles | high | Toolchain + env hashing is foundational (`04`, `06`) — these must land before any `target/`-aware caching expansion in later modules. |
| Mixed-stack `^build` inheritance serialises JS tests on cargo `target/` lock | high | **Resolved 2026-05-20.** D-009 binds nxrust generators to never emit `^build` on cross-language edges; canonical recipe at `docs/recipes/javascript-rust-test-seams.md` covers consumer-side remediation for workspaces hitting the failure mode via `@nx/js` auto-deps. |

## Open Questions

- [x] Final npm scope for v0.1 publish — use scoped `@eddacraft/nxrust`.
      The package is published under the eddacraft npm organisation.
- [ ] Keep the `release-publish` executor in v0.1, or defer until a crate
      actually publishes to crates.io? Implemented and tested — keep it,
      but document as "unvalidated against a real crates.io token" until
      a consumer exercises it. Folded into `08-release-support`.
- [ ] Should the project-graph plugin emit external nodes for workspace
      dev-dependencies, or only runtime deps? Current behaviour skips
      `kind === 'dev'`; revisit in `02-workspace-inference-and-graph`.
- [ ] Should `nextest` become the default `test` runner when installed,
      or remain a separate target? Tracked in `11-nextest`.
- [ ] Should `audit` and `deny` be crate-level, workspace-level, or both?
      Tracked in `09-supply-chain` and `12-workspace-synthetic-project`.
- [ ] Should external `cargo:<crate>` nodes be visible by default in
      `nx graph`? Tracked in `02-workspace-inference-and-graph`.
- [ ] How aggressive should lockfile affected detection become after the
      conservative baseline? Tracked in `13-affected-refinement`.
- [x] Should generated crates include `package.metadata.nxrust` by
      default? **Yes** — at minimum `[package.metadata.nxrust] tags = ["cargo"]`
      so the metadata key is present when the planned module 02 parser
      ships and lifts tags into Nx. Anvil ratified the convention
      2026-05-20. Detail tracked in `07-generators`; the convention
      itself is recorded in `02-workspace-inference-and-graph` § Tag
      convention.
- [ ] Should Anvil-style presets live in `nxrust` or in a separate
      EddaCraft plugin package? Tracked in `16-adoption-and-docs`.
- [ ] Should `target/` outputs be cached at all by default, or should
      cacheable targets initially be mostly result-oriented? Tracked in
      `04-cache-semantics`.

## Decisions

- **D-001:** Fork vs rewrite vs borrow — primary implementation is
  written fresh against `@nx/devkit` and public cargo docs. Borrowing
  from `@monodon/rust` (MIT) is permitted where it saves real time;
  borrowed code gets a top-of-file attribution comment and a
  `THIRD-PARTY-NOTICES.md` entry preserving the MIT notice.
  *Revised 2026-04-21 — previously "clean-room only".*
- **D-002:** Licence — Apache-2.0 (not MIT). Explicit patent grant.
  *Accepted.*
- **D-003:** Nx version floor — `@nx/devkit ^22.6.5`. No back-support
  for Nx 19/20/21 in the v0.x line. *Accepted.*
- **D-004:** Build target — CommonJS to `./dist`. Nx devkit plugins are
  consumed by Nx's Node runtime; ESM offers no win here. *Accepted.*
- **D-005:** Distribution channel — publish `@eddacraft/nxrust` to npm,
  not crates.io. *Accepted 2026-05-07.*
- **D-006:** Adopt [`docs/product-spec.md`](../docs/product-spec.md) as
  the source of truth for the v0.2 → v1.0 roadmap. The Modules table
  above is a structural decomposition of spec §6 + §8. Refactored the
  original `02-monodon-parity` and `03-v0.2-polish` modules into
  capability-area modules (one per spec sub-section). The old modules
  are removed; their content is preserved in the new modules where it
  applies. *Accepted 2026-05-17.*
- **D-007:** Per-item, consumer-driven promotion. Modules 02-16 stay
  Proposed; individual Work Items promote to Ready only when a real
  downstream consumer asks. No speculative builds. Inherits the rule
  established by the original 02-monodon-parity and 03-v0.2-polish
  modules. *Accepted 2026-05-17 (formalised at index level).*
- **D-008:** Graph-behaviour-changing fixes bump the **minor** version,
  not patch. Consumers should be able to pin patch versions and trust
  that graph shape is stable within a minor line. Inherits from the
  original 03-v0.2-polish module. *Accepted 2026-05-17.*
- **D-009:** nxrust generators **never emit `^build` on cross-language
  edges by default.** Any generator that wires a JS↔Rust edge (current:
  `add-wasm-reference`, `add-napi`; future: any cross-stack glue under
  modules 13, 15, or beyond) emits narrow per-target `dependsOn` on the
  JS side, explicitly overriding any workspace-default `^build`. Opt-in
  to `^build` is per-generator-flag and is only correct when the JS
  build actually imports the Rust artefact at TS build time (WASM
  bundled into webpack/Vite, generated `.d.ts` consumed by `tsc`,
  embedded blobs). Rationale: cargo's workspace `target/` lock
  serialises concurrent builds, which silently amplifies into 40+
  minute test runs in mixed-stack workspaces. Empirical anchor:
  eddacraft/anvil-001 PR #1729 — 40m03s → 31-52s, 46× speedup.
  Implementing decision: D-WN4 in
  [`10-wasm-napi`](./modules/10-wasm-napi.aps.md). Consumer recipe:
  [`docs/recipes/javascript-rust-test-seams.md`](../docs/recipes/javascript-rust-test-seams.md).
  Full risk context: ISS-001 in [`plans/issues.md`](./issues.md).
  *Accepted 2026-05-20 (consumer-driven via Anvil; ratified upstream
  after anvil agent confirmed the upstream contract is the more elegant
  fix than per-consumer script splits).*
- **D-010:** Consumer demand for the fully functioning adapter is
  confirmed (plan-owner declaration, 2026-06-10). This satisfies the
  D-007 per-item trigger across the whole v0.2 → v1.0 surface: work
  items no longer wait on individual downstream asks. D-007's
  discipline survives as an ordering rule — items promote in
  dependency/roadmap order (v0.2 → v0.3 → v0.4 → v1.0), one Ready
  slice at a time, smallest coherent item first. First promotion under
  this decision: TARGETS-001 in
  [`03-target-inference`](./modules/03-target-inference.aps.md) — the
  zero-`project.json` DX core, whose stated dependencies (GRAPH-001
  parser, released 0.2.0; module 04 named inputs, Complete) have all
  shipped. *Accepted 2026-06-10.*
