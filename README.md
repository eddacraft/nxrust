# nxrust

**The Cargo-native Nx plugin for Rust workspaces.** Cargo stays the build
engine; `nxrust` makes Cargo workspaces feel native inside Nx by inferring
Rust crates from `cargo metadata`, wiring Cargo tasks as Nx executors, and
modelling crate dependencies in the Nx project graph so `nx affected`,
caching, and release work the same way across Rust crates and TypeScript
projects.

Apache-2.0, Nx 22, single npm package. See
[`docs/product-spec.md`](./docs/product-spec.md) for the long-form product
thesis and roadmap, and [`plans/`](./plans/) for the live work plan.

## Install

```sh
pnpm add -D @eddacraft/nxrust
# or: npm i -D @eddacraft/nxrust  / yarn add -D @eddacraft/nxrust
```

Register in `nx.json`:

```json
{
  "plugins": ["@eddacraft/nxrust"]
}
```

## Why Cargo-native?

`nxrust` treats `cargo metadata` as the source of truth. The plugin's role
is to:

- **infer** Rust projects from your Cargo workspace, without per-crate
  `project.json` boilerplate;
- **wire** Cargo tasks as Nx executors so `nx affected -t test` and
  `nx run-many -t check` work over Rust crates;
- **model** internal and external crate dependencies in the Nx graph so
  changes propagate correctly;
- **orchestrate** Rust release flows through Nx release without losing
  Cargo semantics.

What `nxrust` is **not**: a replacement for Cargo, `rustup`, `clippy`,
`rustfmt`, `nextest`, `cargo audit`, or `cargo deny`. Cargo and its
ecosystem stay the canonical Rust tooling. `nxrust` is the bridge that
lets Nx understand your Cargo workspace.

## Executors

| Executor                | Wraps                  | Cache |
| ----------------------- | ---------------------- | ----- |
| `@eddacraft/nxrust:build`          | `cargo build`          | yes   |
| `@eddacraft/nxrust:check`          | `cargo check`          | yes   |
| `@eddacraft/nxrust:clippy` / `lint`| `cargo clippy`         | yes   |
| `@eddacraft/nxrust:fmt`            | `cargo fmt`            | yes   |
| `@eddacraft/nxrust:run`            | `cargo run`            | no    |
| `@eddacraft/nxrust:test`           | `cargo test`           | yes   |
| `@eddacraft/nxrust:release-publish`| `cargo publish`        | no (use via `nx release publish`) |

All executors accept a shared option set:

| Option        | Type                   | Notes                                          |
| ------------- | ---------------------- | ---------------------------------------------- |
| `toolchain`   | `stable`/`beta`/`nightly` | Translates to `cargo +<toolchain> …`        |
| `target`      | `string`               | Rust target triple                             |
| `profile`     | `string`               | `cargo` profile (e.g. `dev`, `release`)        |
| `release`     | `boolean`              | `--release`                                    |
| `features`    | `string \| string[]`   | `--features`                                   |
| `all-features`| `boolean`              | `--all-features`                               |
| `target-dir`  | `string`               | `--target-dir`                                 |
| `args`        | `string \| string[]`   | Forwarded after `--`                           |

Individual executors add specialised flags — see each schema.

## Generators

```sh
# Library crate
nx g @eddacraft/nxrust:crate my-crate

# Binary crate
nx g @eddacraft/nxrust:crate my-cli --bin
# or alias:
nx g @eddacraft/nxrust:binary my-cli

# Library alias
nx g @eddacraft/nxrust:library my-lib
```

Generated crates are added to the root `Cargo.toml` `[workspace.members]`
(comments preserved via `@ltd/j-toml`) and get a minimal `project.json`
pre-wired to the plugin's executors.

## Inferred targets

Every Cargo workspace member is inferred as an Nx project with a default
target set — no `project.json` required for the canonical case:

| Target | Wraps | Notes |
| ------ | ----- | ----- |
| `build`, `check`, `test` | `cargo build` / `check` / `test` | cacheable |
| `clippy`, `lint` | `cargo clippy` | `lint` is an exact alias so `nx run-many -t lint` covers Rust crates |
| `fmt-check` | `cargo fmt --check` | cacheable; the CI gate |
| `fmt` | `cargo fmt` | mutates files, not cached |
| `run` | `cargo run` | binary crates only |
| `nx-release-publish` | `cargo publish` | publishable crates only; invoked by `nx release publish` |

Every inferred target pins the cargo package name in its options, so the
crate keeps working even when another plugin renames the Nx project.
Targets declared in a `project.json` take precedence over inferred ones.

Per-crate option defaults live in `Cargo.toml` — no `project.json` needed:

```toml
[package.metadata.nxrust.targets.test]
all-features = true

[package.metadata.nxrust.targets.build]
toolchain = "nightly"
```

Any option the target's executor accepts can be defaulted this way. A
`toolchain` set here (or crate-wide via `package.metadata.nxrust.toolchain`)
also feeds the target's cache key, so toolchain updates invalidate correctly.
The cargo `package` pin cannot be overridden, and `lint` follows the
`clippy` table so the alias never diverges. Unknown or malformed entries
warn and are ignored.

## Project graph

The plugin runs `cargo metadata --format-version=1` and emits:

- **Nx project nodes** for every workspace member (keyed by its directory).
- **External nodes** (`cargo:<name>`) for every registry / git dependency.
- **Dependency edges** for every direct dependency resolved via metadata.

This is what makes `nx affected -t test` correct across your Rust crates.

## Requirements

- Node.js ≥ 20
- Nx ≥ 22
- Cargo on `PATH`
- A Cargo workspace at the Nx workspace root (or a single crate at root)

## Roadmap

See [`docs/product-spec.md`](./docs/product-spec.md) §8 for the long-form
roadmap, and [`plans/index.aps.md`](./plans/index.aps.md) for the module
breakdown and per-module status. Headlines:

- **v0.2 — Solid.** Zero-`project.json` target inference, `fmt`/`fmt-check`
  split, `no-default-features`, toolchain + env hashing, narrower target
  outputs, actionable error messages.
- **v0.3 — Compelling.** `nextest`, `audit`, `deny`, `doc`, Criterion
  `bench`, synthetic `rust-workspace` project, `package.metadata.nxrust`
  overrides, inferred configurations.
- **v0.4 — Adoption-ready.** `migrate-from-monodon` generator, WASM and
  NAPI executors, `create-nx-workspace` preset, docs site, Nx
  Console-friendly schemas, example workspaces.
- **v1.0 — The Rust Nx plugin.** Stable inference contract, stable release
  support, semver-backed schemas, Nx version compatibility matrix.

Work is consumer-driven — see the per-item promotion rule in
[`plans/index.aps.md`](./plans/index.aps.md). No speculative builds.

## License

Apache-2.0 © eddacraft. See [LICENSE](./LICENSE).

This project does not contain code copied from `@monodon/rust`; it
references the public API shape only. `cargo metadata` is the official Rust
tooling contract. Where Monodon-MIT code is borrowed in future modules
(per index decision D-001), it is attributed in a top-of-file comment and
in `THIRD-PARTY-NOTICES.md`.

## Acknowledgements

Thanks to the author of `@monodon/rust`; that project established the shape
of Rust support many Nx users expect.
