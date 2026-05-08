# nxrust

**Nx plugin for Rust workspaces.** Wraps `cargo` as Nx executors and generators,
and parses `cargo metadata` into the Nx project graph so `nx affected` works
across your Rust crates.

Inspired by the public API shape of
[`@monodon/rust`](https://github.com/Cammisuli/monodon), with an Apache-2.0
codebase targeting Nx 22.

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

## License

Apache-2.0 © eddacraft. See [LICENSE](./LICENSE).

This project does not contain code copied from `@monodon/rust`; it references
the public API shape only. `cargo metadata` is the official Rust tooling
contract.

## Acknowledgements

Thanks to the author of `@monodon/rust`; that project established the shape of
Rust support many Nx users expect.
