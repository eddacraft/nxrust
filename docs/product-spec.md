# nxrust Product Specification

| Field               | Value                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| Product             | `@eddacraft/nxrust`                                                      |
| Working description | Cargo-native Nx plugin for Rust workspaces                               |
| Status              | Adopted — source of truth for the v0.2 → v1.0 roadmap                    |
| Owner               | eddacraft                                                                |
| Licence             | Apache-2.0                                                               |
| References          | This repo's `plans/`, Nx documentation, `@monodon/rust` public API shape |

> **Note on placement.** This document lives in `docs/` because it is the
> long-form product thesis. The execution plan that derives from it lives
> in `plans/` — see [`plans/index.aps.md`](../plans/index.aps.md) for the
> module breakdown and roadmap milestones.

---

## 1. Product Thesis

`nxrust` should make Cargo workspaces feel native inside Nx.

It should not replace Cargo, hide Rust, or become a generic command wrapper.
Cargo remains the build engine. Nx becomes the orchestration layer that
understands the Cargo workspace deeply enough to run only what changed, cache
what is safe, release crates correctly, and orchestrate Rust alongside
TypeScript without duplicated configuration.

The product should become the Rust-native Nx plugin that treats
`cargo metadata` as the source of truth. Its role is to infer Rust projects,
wire Cargo tasks, model crate dependencies, and make Rust participate cleanly
in Nx affected, caching, release, and CI.

In plain terms:

> `nxrust` lets Rust crates participate in Nx as first-class projects while
> preserving Cargo as the source of truth.

---

## 2. Strategic Positioning

### 2.1 What nxrust is

`nxrust` is an Nx plugin for Rust workspaces. It wraps Cargo commands as Nx
executors, provides Rust-aware generators, and parses Cargo metadata into the
Nx project graph so `nx affected` works across Rust crates and mixed-language
monorepos.

### 2.2 What nxrust is not

`nxrust` is not:

- a replacement for Cargo;
- a replacement for `rustup`, `clippy`, `rustfmt`, `nextest`, `cargo audit`,
  or `cargo deny`;
- a generic shell-command wrapper;
- a TypeScript-first abstraction over Rust;
- a tool that forces every crate to maintain duplicated `project.json`
  configuration.

### 2.3 Why this matters

Nx is valuable because it orchestrates tasks across a workspace, understands
project graphs, runs affected-only workflows, and caches safe work. Rust teams
already have Cargo, but Cargo alone does not orchestrate mixed
TypeScript/Rust monorepos in the Nx model.

For EddaCraft and Anvil, this matters because Anvil is moving towards a
Rust-first kernel while still needing TypeScript surfaces, package tooling,
CI orchestration, release automation, and affected-only execution.

---

## 3. Source Context

### 3.1 Current nxrust baseline (post-v0.1)

`@eddacraft/nxrust@0.1.x` is shipped on npm. It currently exposes executors
for:

- `build` → `cargo build`
- `check` → `cargo check`
- `clippy` / `lint` → `cargo clippy`
- `fmt` → `cargo fmt`
- `run` → `cargo run`
- `test` → `cargo test`
- `release-publish` → `cargo publish`

It also currently exposes generators for:

- `init`
- `crate`
- `binary`
- `library`
- `release-version`

The current graph strategy already points in the right direction: run
`cargo metadata --format-version=1`, emit Nx project nodes for every
workspace member, emit external nodes for registry/git dependencies, and
emit dependency edges for direct dependencies.

### 3.2 Anvil context

The Anvil ADR for an in-house Nx Rust plugin describes a mixed monorepo with
TypeScript projects under Nx and Rust crates that were historically invisible
to Nx. The stated goal was to bring Rust crates under Nx so they benefit from
affected-only CI and remote caching, while Cargo remains the build engine.

The archived Anvil `nx-rust-plugin` module reinforces this direction: the
plugin should be thin, licence-clean, Cargo-driven, and responsible for
shaping input hashing, output caching, and project-graph edges for Nx.

### 3.3 Monodon context

The existing `@monodon/rust` plugin establishes a useful public API shape:
`binary` and `library` generators, Cargo-backed executors, optional NAPI
support, optional WASM support, and release helpers.

However, `nxrust` should not merely clone Monodon. It should use Monodon as a
compatibility reference while moving beyond it through deeper Cargo metadata
inference, stronger affected behaviour, better caching semantics, and stronger
release/workspace support.

---

## 4. Product Goals

### 4.1 Primary goals

1. Make Rust crates first-class Nx projects.
2. Use Cargo metadata as the authoritative project and dependency source.
3. Enable correct `nx affected` behaviour across Rust crates.
4. Provide cache-safe Rust task execution through Nx.
5. Support mixed TypeScript/Rust monorepos without duplicated config.
6. Provide Rust-native generators for common crate shapes.
7. Integrate with Nx release for Rust crate versioning and publishing.
8. Provide a clean migration path from `@monodon/rust`.

### 4.2 Secondary goals

1. Support advanced Rust workflows such as `nextest`, `cargo audit`,
   `cargo deny`, Criterion benches, docs, NAPI, and WASM.
2. Support both single-crate repositories and full Cargo workspaces.
3. Support CI and local development with predictable behaviour.
4. Support EddaCraft/Anvil needs without hard-coding Anvil assumptions.
5. Become publishable and adoption-ready as a general Rust plugin for Nx.

### 4.3 Non-goals

1. Replace Cargo.
2. Replace Rust-native configuration with Nx-only configuration.
3. Cache arbitrary Cargo output unsafely.
4. Hide Rust toolchain details from the user.
5. Copy source from `@monodon/rust` without attribution.
6. Become a general-purpose shell task runner.

---

## 5. Design Principles

### 5.1 Cargo remains the source of truth

`Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `.cargo/config.toml`, and
`cargo metadata` should drive project discovery, dependency modelling, and
task behaviour.

### 5.2 Nx orchestrates, Cargo builds

Nx should decide what to run, when to run it, and whether it can be cached.
Cargo should compile, test, lint, format, document, and publish Rust crates.

### 5.3 Inference over duplication

The default user experience should not require per-crate `project.json`
files. Explicit Nx config should remain available for overrides, but not
required for normal use.

### 5.4 Deterministic cache semantics

Cache correctness matters more than cache ambition. It is better to cache
fewer outputs safely than to cache broad `target/` state incorrectly.

### 5.5 Rust-native overrides

Where possible, crate-specific behaviour should be expressible in
`Cargo.toml` using `package.metadata.nxrust`, not only through Nx JSON
files.

### 5.6 Compatibility without stagnation

`nxrust` should provide compatibility aliases and migration support for
Monodon users, but it should not freeze itself at Monodon's capability
level.

---

## 6. Core Capability Areas

Each capability area below maps to a dedicated APS module under
[`plans/modules/`](../plans/modules/). See
[`plans/index.aps.md`](../plans/index.aps.md) for the full module table.

## 6.1 Cargo Workspace Inference

### Problem

Rust crates should not need duplicated Nx configuration to be recognised as
workspace projects.

### Product requirement

`nxrust` should infer projects from Cargo workspace structure.

### Required capabilities

| Capability               | Requirement                                                    |
| ------------------------ | -------------------------------------------------------------- |
| Root workspace detection | Detect a Cargo workspace at the Nx root.                       |
| Single-crate detection   | Support repositories with a single root crate.                 |
| Workspace members        | Honour `workspace.members`, including globs.                   |
| Workspace excludes       | Honour `workspace.exclude`.                                    |
| Package naming           | Use Cargo package names as the default Nx project names.       |
| Name normalisation       | Support optional naming rules for scoped or prefixed projects. |
| Project metadata         | Read optional `package.metadata.nxrust`.                       |
| Zero project.json path   | Infer projects without requiring per-crate `project.json`.     |

### Suggested `Cargo.toml` override shape

```toml
[package.metadata.nxrust]
tags = ["scope:cli", "type:binary"]
test-runner = "nextest"

[package.metadata.nxrust.targets.check]
features = ["default"]

[package.metadata.nxrust.targets.test]
all-features = true
```

---

## 6.2 Project Graph Support

### Problem

Nx cannot correctly run affected-only tasks unless it understands Rust crate
dependencies.

### Product requirement

`nxrust` should use `cargo metadata` to emit Rust project nodes, external
crate nodes, and dependency edges into the Nx project graph.

### Required capabilities

| Capability                   | Requirement                                                         |
| ---------------------------- | ------------------------------------------------------------------- |
| Workspace crate nodes        | Emit one Nx node per Cargo workspace package.                       |
| Internal dependency edges    | Emit direct Rust-to-Rust dependency edges.                          |
| External dependency nodes    | Emit `cargo:<crate>` nodes for registry and git dependencies.       |
| Dependency kind metadata     | Track normal, dev, and build dependencies where possible.           |
| Feature metadata             | Preserve feature/dependency metadata for future affected precision. |
| Lockfile invalidation        | Invalidate graph cache on `Cargo.lock` changes.                     |
| Manifest invalidation        | Invalidate graph cache on relevant `Cargo.toml` changes.            |
| Optional external visibility | Allow users to hide or show external crate nodes.                   |

### Design decision

`cargo metadata` should be the authoritative graph source. Direct TOML parsing
is acceptable for lightweight discovery and generators, but not as the primary
dependency source.

---

## 6.3 Nx-Native Target Inference

### Problem

Rust crates need standard Nx targets without manual boilerplate.

### Product requirement

Each inferred Rust project should automatically receive sensible Cargo-backed
targets.

### Recommended target set

| Target            | Command                      |            Cache | Priority |
| ----------------- | ---------------------------- | ---------------: | -------- |
| `check`           | `cargo check -p <pkg>`       |              Yes | P0       |
| `build`           | `cargo build -p <pkg>`       |              Yes | P0       |
| `test`            | `cargo test -p <pkg>`        |              Yes | P0       |
| `nextest`         | `cargo nextest run -p <pkg>` |              Yes | P1       |
| `lint` / `clippy` | `cargo clippy -p <pkg>`      |              Yes | P0       |
| `fmt-check`       | `cargo fmt --check`          |              Yes | P0       |
| `fmt`             | `cargo fmt`                  | No or local-only | P0       |
| `run`             | `cargo run -p <pkg>`         |               No | P0       |
| `bench`           | `cargo bench -p <pkg>`       |       Usually no | P1       |
| `doc`             | `cargo doc -p <pkg>`         |              Yes | P1       |
| `audit`           | `cargo audit`                |          Yes-ish | P1       |
| `deny`            | `cargo deny check`           |              Yes | P1       |
| `udeps`           | `cargo +nightly udeps`       |              Yes | P2       |
| `miri`            | `cargo +nightly miri test`   |          Yes-ish | P2       |
| `release-publish` | `cargo publish -p <pkg>`     |               No | P0/P1    |

### Formatting split

`fmt` and `fmt-check` should be separate targets:

- `fmt` mutates files and should not be treated as a normal remote-cacheable
  target.
- `fmt-check` validates formatting and can be safely used in CI.

---

## 6.4 Cache Semantics

### Problem

Rust caching is easy to get wrong. Broadly caching `target/` can produce
confusing behaviour if the cache key omits toolchain, target, feature, or
environment inputs.

### Product requirement

`nxrust` should define conservative, explicit cache inputs and outputs.

### Recommended named inputs

```json
{
  "rustSources": [
    "{projectRoot}/src/**/*.rs",
    "{projectRoot}/tests/**/*.rs",
    "{projectRoot}/benches/**/*.rs",
    "{projectRoot}/examples/**/*.rs",
    "{projectRoot}/build.rs",
    "{projectRoot}/Cargo.toml"
  ],
  "rustWorkspace": [
    "{workspaceRoot}/Cargo.toml",
    "{workspaceRoot}/Cargo.lock",
    "{workspaceRoot}/rust-toolchain.toml",
    "{workspaceRoot}/.cargo/config.toml"
  ]
}
```

### Environment variables to consider in hashing

```text
RUSTFLAGS
RUSTDOCFLAGS
CARGO_TARGET_DIR
CARGO_BUILD_TARGET
CARGO_PROFILE_RELEASE_LTO
CARGO_PROFILE_RELEASE_CODEGEN_UNITS
CC
CXX
AR
PKG_CONFIG_PATH
OPENSSL_DIR
```

### Platform and toolchain inputs

Cache keys should account for:

- target triple;
- host OS;
- architecture;
- Rust toolchain channel;
- `rustc -Vv`;
- `cargo -V`;
- selected features;
- profile;
- release/debug mode;
- relevant environment variables.

### Output guidance

Start conservative:

| Target            | Output strategy                                      |
| ----------------- | ---------------------------------------------------- |
| `check`           | Cache exit/result, avoid broad artefact assumptions. |
| `clippy`          | Cache exit/result, optionally reports.               |
| `fmt-check`       | Cache exit/result.                                   |
| `test`            | Cache result and test reports where configured.      |
| `build`           | Cache configured target output only when safe.       |
| `doc`             | Cache documentation output.                          |
| `run`             | Do not cache.                                        |
| `release-publish` | Do not cache.                                        |

---

## 6.5 Cargo Feature Handling

### Problem

Feature flags materially affect Rust build/test/lint behaviour and must be
first-class in Nx task configuration.

### Product requirement

`nxrust` should expose Cargo feature controls consistently across relevant
executors.

### Required options

| Option              | Behaviour                                         |
| ------------------- | ------------------------------------------------- |
| `features`          | Pass `--features`. Accept string or string array. |
| `allFeatures`       | Pass `--all-features`.                            |
| `noDefaultFeatures` | Pass `--no-default-features`.                     |
| `defaultFeatures`   | Explicit boolean convenience where useful.        |
| `profile`           | Pass `--profile`.                                 |
| `release`           | Pass `--release`.                                 |
| `target`            | Pass `--target`.                                  |
| `toolchain`         | Use `cargo +<toolchain>`.                         |

### Suggested inferred configurations

```json
{
  "configurations": {
    "default": {},
    "all-features": {
      "allFeatures": true
    },
    "no-default-features": {
      "noDefaultFeatures": true
    },
    "release": {
      "release": true
    }
  }
}
```

---

## 6.6 Toolchain Awareness

### Problem

Rust toolchains are part of build determinism. A plugin that ignores them
will produce incorrect cache behaviour and poor error messages.

### Product requirement

`nxrust` should read and respect `rust-toolchain.toml` and hash the actual
Rust toolchain used.

### Required capabilities

| Capability                 | Requirement                                           |
| -------------------------- | ----------------------------------------------------- |
| Read `rust-toolchain.toml` | Use declared toolchain as default.                    |
| Support `cargo +toolchain` | Allow explicit stable/beta/nightly/custom toolchains. |
| Hash `rustc -Vv`           | Avoid false cache hits across compilers.              |
| Hash `cargo -V`            | Avoid false cache hits across Cargo versions.         |
| Validate missing toolchain | Produce actionable error messages.                    |
| Detect missing target      | Explain `rustup target add <target>`.                 |

---

## 6.7 Generators

### Problem

Rust projects need predictable scaffolding that respects both Cargo and Nx
conventions.

### Product requirement

`nxrust` should provide generators for common Rust crate shapes and optional
advanced surfaces.

### P0 generators

| Generator | Purpose                                         |
| --------- | ----------------------------------------------- |
| `init`    | Add Cargo workspace support to an Nx workspace. |
| `crate`   | Generic crate generator.                        |
| `library` | Thin wrapper around `crate --lib`.              |
| `binary`  | Thin wrapper around `crate --bin`.              |

### P1 generators

| Generator                 | Purpose                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| `workspace-crate`         | Explicit workspace-member scaffold.                                        |
| `cli`                     | Binary crate with `clap`, `tracing`, and error handling.                   |
| `service`                 | Binary crate with Axum/Tokio baseline.                                     |
| `tui`                     | Binary crate with Ratatui baseline.                                        |
| `wasm`                    | Rust crate configured for `wasm-pack`.                                     |
| `napi`                    | Rust crate configured for `napi-rs`.                                       |
| `ffi`                     | Rust crate configured for `cdylib`.                                        |
| `bench`                   | Add Criterion benchmark target.                                            |
| `xtask`                   | Generate an `xtask` helper crate.                                          |
| `policy` / `check` preset | Generate deterministic check/policy crates useful for Anvil-style systems. |

### Generator behaviour

Generators should:

- update root `Cargo.toml` `workspace.members`;
- preserve comments and formatting;
- optionally add workspace dependencies;
- optionally create `README.md`;
- optionally create `cargo-deny` or audit config;
- optionally add `package.metadata.nxrust`;
- avoid `project.json` unless explicitly requested.

---

## 6.8 Nx Release Support

### Problem

Rust crate versioning and publishing should work through Nx release workflows
in mixed-language repositories.

### Product requirement

`nxrust` should support Cargo-aware versioning and publishing through Nx
release.

### Required capabilities

| Capability                  | Requirement                                          |
| --------------------------- | ---------------------------------------------------- |
| Version bump                | Update `package.version` in `Cargo.toml`.            |
| Internal dependency updates | Update workspace dependency versions where required. |
| Dry-run publish             | Support `cargo publish --dry-run`.                   |
| Package validation          | Support `cargo package`.                             |
| Changelog support           | Integrate with Nx release changelog flow.            |
| Independent versions        | Allow crates to version independently.               |
| Fixed version mode          | Allow workspace-wide fixed versioning.               |
| crates.io publish           | Support default registry publishing.                 |
| Private registry publish    | Support `--registry`.                                |

### Recommended modes

```text
fixed release group    -> all crates version together
independent releases   -> crates version separately
```

Anvil may prefer fixed release initially, but the plugin should support both.

---

## 6.9 Security and Supply Chain Targets

### Problem

Rust dependency governance is important, especially for EddaCraft and
Anvil's broader deterministic governance story.

### Product requirement

`nxrust` should provide first-class security and supply-chain task support.

### Recommended targets

| Target     | Tool                                                        |
| ---------- | ----------------------------------------------------------- |
| `audit`    | `cargo audit`                                               |
| `deny`     | `cargo deny check`                                          |
| `outdated` | `cargo outdated`                                            |
| `vet`      | `cargo vet`                                                 |
| `sbom`     | `cargo auditable`, `cargo cyclonedx`, or configurable tool. |
| `licenses` | `cargo deny` licence checks.                                |

### Design guidance

These should be optional and tool-presence aware. If a tool is missing,
`nxrust` should explain how to install it rather than failing with a raw
shell error.

---

## 6.10 WASM and NAPI Support

### Problem

Some Rust workspaces need WASM or Node-native module support. Monodon already
exposes this shape, so compatibility expectations exist.

### Product requirement

`nxrust` should support WASM and NAPI, but they should not dominate the core
plugin model.

### Suggested shape

```text
@eddacraft/nxrust:wasm-pack
@eddacraft/nxrust:napi
@eddacraft/nxrust:add-wasm
@eddacraft/nxrust:add-napi
```

### Priority

WASM and NAPI should be P1/P2. The core value remains Cargo workspace
inference, affected detection, caching, and release.

---

## 6.11 cargo-nextest Support

### Problem

Many serious Rust teams use `cargo nextest` for faster and more CI-friendly
test execution.

### Product requirement

`nxrust` should support `cargo nextest` as a first-class test runner.

### Required commands

```bash
nx test my-crate
nx nextest my-crate
nx affected -t nextest
```

### Options to support

```text
profile
partition
archive-file
workspace-remap
no-fail-fast
features
target
```

### Configuration option

In `nx.json`, on the plugin entry:

```json
{
  "plugins": [
    {
      "plugin": "@eddacraft/nxrust",
      "options": {
        "testRunner": "nextest"
      }
    }
  ]
}
```

When configured, `nx test <crate>` may use `nextest` automatically.

---

## 6.12 Workspace-Level Targets

### Problem

Some Cargo commands are workspace-level, not crate-level. Treating every
task as per-crate creates awkward or incorrect behaviour.

### Product requirement

`nxrust` should infer a synthetic workspace-level project.

### Suggested synthetic project

```text
rust-workspace
```

### Suggested workspace targets

```text
cargo-metadata
fmt
fmt-check
audit
deny
doc
clean
update-lockfile
generate-lockfile
```

---

## 6.13 Affected Behaviour

### Problem

The main value of Nx is affected-only execution. Rust support must be
accurate enough to trust.

### Product requirement

`nxrust` should map Rust file, manifest, lockfile, and toolchain changes to
appropriate affected projects.

### Expected behaviour

| Change                                   | Affected result                                      |
| ---------------------------------------- | ---------------------------------------------------- |
| `crates/foo/src/lib.rs`                  | `foo` and dependants.                                |
| `crates/foo/Cargo.toml`                  | `foo` and dependants.                                |
| root `Cargo.lock`                        | All Rust crates initially; refined later where safe. |
| root `Cargo.toml` workspace dependencies | All Rust crates or resolved affected subset.         |
| `rust-toolchain.toml`                    | All Rust crates.                                     |
| `.cargo/config.toml`                     | All Rust crates.                                     |
| `build.rs`                               | Owning crate and dependants.                         |
| feature changes                          | Feature-dependent graph where possible.              |

### Future improvement

Start conservative, then use `cargo metadata` and feature resolution to
reduce over-triggering after lockfile or workspace dependency changes.

---

## 6.14 Error Messages and Diagnostics

### Problem

Nx plus Cargo failures can become hard to interpret. The plugin should make
failures understandable.

### Product requirement

`nxrust` should provide clear, actionable errors.

### Required diagnostic cases

```text
cargo not found
not a Cargo workspace
Cargo.toml parse failure
cargo metadata failure
crate not in workspace
duplicate package names
unsupported virtual manifest shape
toolchain missing
nightly required
target not installed
nextest/audit/deny not installed
```

### Error format

Each error should include:

1. what failed;
2. why it matters;
3. the exact command attempted, where safe;
4. the suggested fix.

---

## 6.15 Migration from Monodon

### Problem

`nxrust` is intended to replace the semi-official/community Rust Nx plugin
shape represented by `@monodon/rust`.

### Product requirement

`nxrust` should provide a migration path from Monodon.

### Migration generator

```bash
nx g @eddacraft/nxrust:migrate-from-monodon
```

### Required migration behaviour

```text
replace @monodon/rust targets
map lint -> clippy/lint
map binary/library generators where possible
remove stale project.json boilerplate where inference is enough
preserve project-specific options
flag napi/wasm cases for review
update nx.json plugins
```

### Compatibility aliases

```text
lint -> clippy
bin -> binary
lib -> library
```

---

## 7. User Experience

## 7.1 Installation

```bash
pnpm add -D @eddacraft/nxrust
```

Register in `nx.json`:

```json
{
  "plugins": ["@eddacraft/nxrust"]
}
```

## 7.2 Minimal plugin configuration

```json
{
  "plugins": [
    {
      "plugin": "@eddacraft/nxrust",
      "options": {
        "buildTargetName": "build",
        "checkTargetName": "check",
        "testTargetName": "test",
        "lintTargetName": "lint",
        "fmtCheckTargetName": "fmt-check"
      }
    }
  ]
}
```

## 7.3 Common commands

```bash
nx show projects
nx graph
nx affected -t check
nx affected -t test
nx run anvil-cli:clippy
nx run anvil-cli:test --features tui
nx run rust-workspace:deny
nx release version
nx release publish
```

## 7.4 New crate generation

```bash
nx g @eddacraft/nxrust:library anvil-policy
nx g @eddacraft/nxrust:binary anvil-cli
nx g @eddacraft/nxrust:crate anvil-kernel-types
```

---

## 8. Roadmap

## 8.1 v0.2 — Make it solid

Focus: correctness and Anvil usefulness.

```text
- harden cargo metadata graph inference
- infer targets without project.json
- split fmt and fmt-check
- add no-default-features
- hash rustc/cargo/toolchain correctly
- improve target outputs
- add better errors
- add CI fixture matrix
- document Anvil migration path
```

## 8.2 v0.3 — Make it compelling

Focus: things Rust teams actually want.

```text
- cargo nextest executor
- cargo audit executor
- cargo deny executor
- cargo doc executor
- bench executor
- workspace root synthetic project
- package.metadata.nxrust overrides
- generated configurations for all-features/release/minimal
```

## 8.3 v0.4 — Make it adoption-ready

Focus: replacement for Monodon and useful outside EddaCraft.

```text
- migrate-from-monodon generator
- wasm-pack support
- napi-rs support
- create-nx-workspace preset
- docs site examples
- Nx Console-friendly schemas
- examples: CLI, TUI, Axum service, WASM, NAPI
```

## 8.4 v1.0 — Make it the Rust Nx plugin

Focus: stable public contract.

```text
- stable inference contract
- stable release support
- fixed and independent crate release modes
- robust cache docs
- semver-backed schema
- compatibility matrix for Nx versions
- official migration guide
```

---

## 9. Prioritised Backlog

## P0 — Core correctness

| Item                 | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| Cargo metadata graph | Use `cargo metadata` as authoritative graph source.            |
| Project inference    | Infer crate projects without `project.json`.                   |
| Target inference     | Infer build/check/test/lint/fmt/fmt-check/run/release-publish. |
| Cache inputs         | Hash source, manifests, lockfile, toolchain, selected env.     |
| Feature options      | Support features, all-features, no-default-features.           |
| Toolchain support    | Read and hash Rust toolchain details.                          |
| Error messages       | Replace raw shell failures with actionable diagnostics.        |

## P1 — Serious Rust workflow

| Item              | Description                                   |
| ----------------- | --------------------------------------------- |
| nextest           | Add `cargo nextest` support.                  |
| audit             | Add `cargo audit` executor.                   |
| deny              | Add `cargo deny` executor.                    |
| doc               | Add `cargo doc` executor.                     |
| bench             | Add Criterion/cargo bench support.            |
| workspace project | Add synthetic root workspace project.         |
| release modes     | Support fixed and independent crate versions. |

## P2 — Adoption and ecosystem

| Item              | Description                                          |
| ----------------- | ---------------------------------------------------- |
| Monodon migration | Add migration generator.                             |
| WASM              | Add `wasm-pack` support.                             |
| NAPI              | Add `napi-rs` support.                               |
| Preset            | Add create-nx-workspace preset.                      |
| Examples          | Add example workspaces.                              |
| Docs              | Build public documentation and compatibility matrix. |

---

## 10. Risks and Mitigations

| Risk                               | Impact | Mitigation                                                      |
| ---------------------------------- | ------ | --------------------------------------------------------------- |
| Nx plugin API drift                | Medium | Keep API surface small; add compatibility tests.                |
| Incorrect cache hits               | High   | Conservative inputs/outputs; hash toolchain and target details. |
| Cargo metadata performance         | Medium | Cache metadata results and invalidate deliberately.             |
| Lockfile over-triggering           | Medium | Start conservative; refine later.                               |
| Monodon compatibility expectations | Medium | Provide aliases and migration generator.                        |
| Too much Anvil-specific behaviour  | Medium | Keep Anvil presets optional.                                    |
| WASM/NAPI scope creep              | Medium | Treat as optional capability packs, not core flow.              |

---

## 11. Open Questions

1. Should `nextest` become the default implementation of `test` when
   installed, or remain a separate target?
2. Should `audit` and `deny` be crate-level, workspace-level, or both?
3. Should external `cargo:<crate>` nodes be visible by default in
   `nx graph`?
4. How aggressive should lockfile affected detection become after the
   conservative baseline?
5. Should generated crates include `package.metadata.nxrust` by default?
6. Should Anvil-style presets live in `nxrust` or in a separate EddaCraft
   plugin package?
7. Should `target/` outputs be cached at all by default, or should
   cacheable targets initially be mostly result-oriented?

---

## 12. Status of Initial Next Steps

The recommendations originally proposed for adoption of this spec, with
current status:

1. **Reframe the README around the Cargo-native thesis.** Done — see
   [`README.md`](../README.md).
2. **Add a `docs/product-spec.md` version of this document to the repo.**
   Done — this file.
3. **Create v0.2/v0.3 GitHub milestones from the roadmap.** Pending — modules
   exist; GitHub milestones to be created at the first promotion of a v0.2
   item.
4. **Add an APS module or issue set per capability area** — Done. See
   [`plans/index.aps.md`](../plans/index.aps.md) for the module table
   covering target inference, cache semantics, fmt-check split, nextest,
   audit/deny, Monodon migration, and the rest.
5. **Decide whether `package.metadata.nxrust` is part of v0.2 or v0.3.** Open
   — tracked in module
   [`02-workspace-inference-and-graph`](../plans/modules/02-workspace-inference-and-graph.aps.md).
6. **Add fixture workspaces** — Pending; tracked as part of the v0.2 solid
   work in module
   [`04-cache-semantics`](../plans/modules/04-cache-semantics.aps.md) and
   the CI matrix discussion in
   [`14-diagnostics`](../plans/modules/14-diagnostics.aps.md).

---

## 13. One-Paragraph Product Summary

`nxrust` is the Cargo-native Nx plugin for Rust workspaces. It lets Nx infer
Rust crates from Cargo metadata, model Rust dependency edges in the Nx
project graph, run affected-only Cargo workflows, cache safe Rust tasks,
scaffold new crates, and support Rust release flows without duplicating
Cargo configuration. Cargo remains the build engine; Nx becomes the
orchestrator that understands Rust well enough to operate mixed
TypeScript/Rust monorepos with confidence.

---

## 14. Short Tagline Options

- Cargo-native Rust support for Nx.
- Make Cargo workspaces first-class in Nx.
- Rust crates, Nx orchestration, no duplicated config.
- Let Nx understand your Cargo workspace.
- Cargo builds. Nx orchestrates. nxrust connects them.
