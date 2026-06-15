<!-- APS Module: 15-monodon-migration -->
<!-- Status: Proposed -->

# Monodon Migration

A `migrate-from-monodon` generator that converts an existing
`@monodon/rust` workspace into an nxrust workspace, plus compatibility
aliases for the few naming differences.

| ID      | Owner     | Status   |
| ------- | --------- | -------- |
| MIGRATE | eddacraft | Proposed |

## Purpose

`nxrust` is positioned as the maintained Apache-2.0 alternative to
`@monodon/rust` for Nx 22 (index Problem statement). Consumers on
Monodon need a frictionless migration path — no manual `project.json`
rewrites, no executor renames done by hand, no broken graphs after the
switch.

Spec §6.15 specifies the migration generator's behaviour and the small
set of compatibility aliases (`lint` → `clippy`, `bin` → `binary`,
`lib` → `library`).

## In Scope

**`migrate-from-monodon` generator (spec §6.15):**

```bash
nx g @eddacraft/nxrust:migrate-from-monodon
```

Behaviour:

- Detect `@monodon/rust` in the consumer's `package.json` /
  `pnpm-lock.yaml`. Refuse to run if not detected.
- Detect plugin registration in `nx.json`. Replace with
  `@eddacraft/nxrust` registration.
- Walk every `project.json` that uses `@monodon/rust:*` executors:
  - Map executor names: `@monodon/rust:build` →
    `@eddacraft/nxrust:build`, etc. Direct rename for the 1:1 set.
  - Map `lint` ↔ `clippy` per spec §6.15.
  - Preserve every project-specific option (features, profile, target,
    custom args).
  - Flag napi/wasm projects with a TODO comment; do not auto-migrate
    those without [10-wasm-napi](./10-wasm-napi.aps.md) promoted.
- Detect `project.json` entries that the inferred graph would now
  cover, and offer to remove them (interactive prompt or
  `--prune-redundant` flag). Inherits
  [03-target-inference](./03-target-inference.aps.md)'s precedence rule.
- Update root `package.json` devDependencies: remove `@monodon/rust`,
  add `@eddacraft/nxrust` with the current published version range.
- Update root `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` via
  the consumer's package manager (one of `pnpm install`, `npm install`,
  `yarn install`) — the generator emits the install command but does not
  run it (consumer controls when their lockfile changes).
- Dry-run mode (`--dry-run`) prints a report of changes without writing
  anything.

**Compatibility aliases (spec §6.15):**

| Alias  | Resolves to           | Notes                                           |
| ------ | --------------------- | ----------------------------------------------- |
| `lint` | `clippy`              | v0.1 already supports both. Document the alias. |
| `bin`  | `binary` (generator)  | v0.1 ships `binary`; add `bin` alias.           |
| `lib`  | `library` (generator) | v0.1 ships `library`; add `lib` alias.          |

- Aliases are runtime-only; the canonical names stay primary.
- Aliases are documented in README but generators emit the canonical
  name in any new `project.json` they write.

**Generator outputs (spec §6.15):**

```text
replace @monodon/rust targets
map lint -> clippy/lint
map binary/library generators where possible
remove stale project.json boilerplate where inference is enough
preserve project-specific options
flag napi/wasm cases for review
update nx.json plugins
```

## Out of Scope

- Migration **away from** nxrust to something else. Not in scope; if a
  consumer wants to leave, they uninstall.
- Migration from older nxrust versions to newer (e.g. v0.2 → v0.3 with
  a breaking change). Those use `nx migrate @eddacraft/nxrust` per Nx's
  standard mechanism, with `migrations.json` entries added per
  breaking release.
- Migration from `cargo-make` or another orchestrator. Out of scope —
  too many shapes.
- Auto-running the post-migration `pnpm install`. The generator emits
  the command; the consumer runs it.

## Interfaces

### Depends On

- v0.1's generator framework.
- [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md)
  — the migration tool needs to know what the post-migration inferred
  graph will look like to decide which `project.json` entries are
  redundant.
- [03-target-inference](./03-target-inference.aps.md) — same as above,
  for redundant target removal.
- [07-generators](./07-generators.aps.md) — shared generator helpers.
- [14-diagnostics](./14-diagnostics.aps.md) — error messages for
  migration failures.

### Exposes

- `@eddacraft/nxrust:migrate-from-monodon` generator.
- Compatibility aliases: `lint` → `clippy`, `bin` → `binary` (generator),
  `lib` → `library` (generator).
- A documented migration guide (in `docs/`), referenced by
  [16-adoption-and-docs](./16-adoption-and-docs.aps.md).
- `migrations.json` entries for nxrust-internal migrations (v0.2 → v0.3
  shape changes when they arrive).

## Constraints

- **Migration is idempotent.** Running `migrate-from-monodon` twice on
  the same workspace is a no-op the second time.
- **Migration preserves consumer customisation.** Custom args, features,
  profiles, output paths in the consumer's `project.json` must survive.
- **Dry-run mode is reliable.** `--dry-run` output must match what an
  actual run produces, modulo timestamps.
- **napi/wasm projects are not auto-migrated.** Until
  [10-wasm-napi](./10-wasm-napi.aps.md) promotes the relevant work
  items, the generator flags those projects with a TODO and skips them.
- **Compatibility aliases are runtime-only.** Generators emit canonical
  names; aliases exist for executor invocations and existing
  `project.json` entries.
- **No silent network calls.** The generator does not fetch the latest
  nxrust version from npm at runtime; it writes the version pin from a
  static constant in the generator.

## Ready Checklist

Promote individual Work Items to Ready when:

- [ ] A real consumer asks to migrate from `@monodon/rust` (per D-007).
- [ ] The consumer's Monodon workspace shape is captured (which
      executors, which generator options, any napi/wasm complexity).
- [ ] A Work Item is drafted.

## Work Items

_No work items yet — module is Proposed. Items promote individually on
real-consumer asks per D-007._

## Risks & Mitigations

| Risk                                                                                      | Impact | Likelihood | Mitigation                                                                                                               |
| ----------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Monodon's option schema differs subtly from nxrust's                                      | medium | high       | Per-executor mapping table; CI fixture matrix exercises the full mapping; diagnostic on unmapped options                 |
| Removing redundant `project.json` entries breaks the consumer's CI scripts that grep them | medium | medium     | `--prune-redundant` is opt-in (default off until consumer feedback says default-on); document the safe order             |
| napi/wasm migration flagged but consumer expects auto-handling                            | medium | medium     | Diagnostic on detection; clear "migrate manually or wait for [10-wasm-napi](./10-wasm-napi.aps.md)" message              |
| Compatibility alias collides with a future canonical name                                 | medium | low        | Aliases are stable per index Decisions; canonical names are the source of truth; check before adding new canonical names |
| Generator dry-run diverges from actual run                                                | high   | low        | Same code path with a `dryRun` flag; CI test exercises both modes on the same fixture                                    |

## Decisions

- **D-MIG1:** Migration is consumer-driven (D-007) — work happens when a
  real Monodon consumer asks to switch. _Accepted._
- **D-MIG2:** Compatibility aliases (`lint` ↔ `clippy`, `bin` ↔ `binary`,
  `lib` ↔ `library`) are runtime-only; canonical names are emitted by
  generators. _Accepted (inherits spec §6.15)._
- **D-MIG3:** napi/wasm migration is gated on
  [10-wasm-napi](./10-wasm-napi.aps.md) promotion; until then the
  generator flags those projects. _Accepted._
- **D-MIG4:** Migration is idempotent; second run is a no-op. _Accepted._

## Open Questions

- [ ] Should the migration generator also do the reverse compatibility
      check — refuse to run if the consumer's Nx version is below
      `^22.6.5`? Yes; diagnose early with a "bump Nx first" message.
- [ ] Should `migrate-from-monodon` be the entry point, or a friendlier
      `nx migrate @eddacraft/nxrust@latest` flow that wraps it? The
      latter is more idiomatic for Nx consumers; the former is more
      direct. Probably both: the friendly flow calls the underlying
      generator.
- [ ] Should the generator write a `MIGRATION.md` summary in the
      consumer's repo? Useful for code review of the migration commit;
      opt-out via `--no-summary`.
- [ ] How are Monodon's option names mapped where they don't have a
      direct nxrust equivalent? Per-executor table in the migration
      generator's source, kept in sync with both schemas; tested in
      CI fixture.
