<!-- APS Module: 02-monodon-parity -->
<!-- Status: Proposed -->

# Monodon Parity

Catch up on the executors and generators present in `@monodon/rust` that
nxrust does not yet cover.

| ID | Owner | Status |
|----|-------|--------|
| PARITY | eddacraft | Proposed |

## Purpose

`@monodon/rust` ships a handful of executors and generators that nxrust
v0.1 deliberately skipped — they were not on the critical path to a
maintained Nx 22 plugin for plain Rust crates. This module exists to
close the parity gap **if and when** a real consumer asks for it.

Monodon is MIT-licensed and Apache-2.0 compatible, so its
implementations may be borrowed where they fit, with per-file
attribution and a `THIRD-PARTY-NOTICES.md` entry preserving the MIT
notice (per index decision D-001).

The module stays **Proposed** until a real consumer requests one of the
items below. Promotion to **Ready** is the trigger for any actual work
here — we do not pre-build parity features speculatively.

## In Scope

The parity surface, by area:

**Native-module integration (napi-rs):**

- `napi` executor — wraps `napi build` / `napi prepublish` for napi-rs
  crates that produce a Node-loadable `.node` binary
- `add-napi` generator — convert an existing Rust crate into a napi-rs
  crate (Cargo manifest deltas, `napi` build script, sibling
  `package.json` shape)
- `create-napi-npm-dirs` generator — generate the per-target npm
  sub-package directories napi-rs expects for prebuilt platform-specific
  binaries

**WebAssembly integration (wasm-pack):**

- `wasm-pack` executor — wraps `wasm-pack build` for crates targeting
  `wasm32-*`
- `add-wasm` generator — convert an existing Rust crate into a
  wasm-pack-buildable crate
- `add-wasm-reference` generator — wire a JS/TS project to consume a
  sibling wasm-pack crate (package.json reference, types entry,
  bundler-specific glue)

**Workspace bootstrap:**

- `preset` generator — the entry point Nx invokes when a consumer runs
  `create-nx-workspace --preset @eddacraft/nxrust`. Spawns a fresh
  workspace pre-wired with Cargo workspace, sample crate, and nxrust
  plugin registration

## Out of Scope

- Anything not present in `@monodon/rust` at parity-evaluation time —
  net-new features belong in v0.2-polish or a later module
- Executors/generators that v0.1 already covers (`build`, `test`,
  `check`, `clippy`, `fmt`, `run`, `release-publish`, `init`, `library`,
  `binary`, `crate`, `release-version`)
- Rewriting monodon's implementations from scratch when a borrow saves
  meaningful time — borrowing with attribution is the explicit
  preference here (D-001)
- `cargo-nextest`, `bench`, glob edge cases, project-key/cargo-name
  divergence handling — those live in [03-v0.2-polish](./03-v0.2-polish.aps.md)

## Interfaces

### Depends On

- `@nx/devkit ^22.6.5` (already pinned)
- `@monodon/rust` source on GitHub for the borrow candidates (MIT)
- A real consumer crate per parity item to validate against — speculative
  parity work is explicitly disallowed by the promotion criterion below

### Exposes (at the end of this module, once promoted and completed)

- Additional executors registered in `executors.json`:
  `napi`, `wasm-pack`
- Additional generators registered in `generators.json`:
  `add-napi`, `add-wasm`, `add-wasm-reference`, `create-napi-npm-dirs`,
  `preset`
- `THIRD-PARTY-NOTICES.md` entries for every file containing borrowed
  monodon code, preserving the MIT notice
- README coverage for each new executor/generator at the same shape as
  the v0.1 entries

## Constraints

- **Attribution is mandatory.** Any borrowed monodon code gets a
  top-of-file attribution comment naming the source file and commit SHA,
  plus an entry in `THIRD-PARTY-NOTICES.md` preserving the MIT licence
  text. Stripping attribution to make a file "look fresh" is not
  permitted.
- **Apache-2.0 stays the umbrella licence.** Borrowed MIT code is
  compatible; do not introduce dependencies under copyleft licences.
- **No speculative builds.** Each parity item promotes from Proposed to
  Ready only when a real consumer asks for it. The cost of carrying
  unused executors is not zero — they widen the public surface and
  invite bug reports against code nobody has exercised.
- **Borrow, but verify.** Borrowed code must still pass nxrust's
  TypeScript strict mode, ESLint config, and Vitest suite. Adapt
  monodon's patterns to nxrust's existing helpers (`buildCargoArgs`,
  `inferProjectConfig`, etc.) rather than importing monodon's full
  abstraction tree.
- **One parity item per PR.** Bundled parity drops make review hard and
  rollback harder.

## Ready Checklist

Change status to **Ready** when **all** of the following hold for at
least one parity item:

- [ ] A real consumer has asked for the item (issue, Slack ask, or
      direct request from a known downstream)
- [ ] The consumer's use case has been captured in writing (which
      executor/generator, against which crate shape, with which command
      shape)
- [ ] Monodon's current implementation has been read and a borrow vs.
      rewrite decision has been recorded
- [ ] A Work Item has been drafted for the specific item being promoted
- [ ] Module is narrowed to that item — the rest stay Proposed

## Work Items

*No work items yet — module is Proposed. Promotion to Ready happens
per-item, on demand from a real consumer. See the Ready Checklist
above for the trigger.*

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Borrowed monodon code drifts from upstream and we miss a bug fix | medium | medium | Record the source commit SHA in the file header; periodically diff against upstream when an issue lands |
| Attribution stripped accidentally during a future refactor | medium | low | `THIRD-PARTY-NOTICES.md` is the source of truth; CI lint that fails if a file flagged as borrowed loses its attribution header is a v0.2-polish candidate |
| Speculative parity work bloats the public surface | medium | medium | Promotion gate above — Proposed stays Proposed until a real consumer asks |
| napi-rs / wasm-pack ecosystem moves faster than the borrowed code | medium | medium | Validate against the consumer's actual napi-rs / wasm-pack version at promotion time; do not promote against a stale monodon snapshot |

## Decisions

- **D-P1:** Promotion is consumer-driven. Items in this module are not
  built speculatively; each promotion to Ready requires a real
  downstream ask. *Accepted.*
- **D-P2:** Borrowing from monodon (MIT) is preferred over rewriting
  when a borrow saves real time, subject to attribution and licence
  notice requirements. Inherits index decision D-001. *Accepted.*

## Open Questions

- [ ] Does the `preset` generator belong here or in a later module
      focused on first-run experience? `preset` differs from the other
      parity items — it's invoked by `create-nx-workspace`, not by an
      existing Nx workspace, so it has packaging implications (must be
      reachable without the plugin already installed).
- [ ] napi-rs has shipped a v3 with a different build CLI shape. Does
      borrowing monodon's `napi` executor make sense, or is monodon's
      implementation already stale enough that a fresh write is
      cheaper? Resolve at promotion time against the consumer's napi-rs
      version.
- [ ] Should `add-napi` and `add-wasm` be merged into a single
      `add-binding` generator with a `--kind` option, or stay split?
      Resolve at promotion time based on which one promotes first.
