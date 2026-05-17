<!-- APS Module: 11-nextest -->
<!-- Status: Proposed -->

# cargo-nextest Support

A dedicated `nextest` executor for teams that use `cargo nextest` as
their primary test runner.

| ID | Owner | Status |
|----|-------|--------|
| NEXTEST | eddacraft | Proposed |

## Purpose

`cargo nextest` is the de-facto choice for serious Rust teams running
tests in CI: parallel test execution, JUnit/XML reports, partition
support for sharded CI, archive-and-run for cross-host test execution,
better failure summarisation than `cargo test`. Spec §6.11 makes it a
first-class test runner.

v0.1's `test` executor opportunistically uses `nextest` when available
(per the original 03-v0.2-polish notes). This module formalises the
relationship: a dedicated `nextest` executor with nextest-specific
options, plus an opt-in plugin config that makes `nx test` route to
`nextest` automatically when configured.

This module absorbs the `cargo-nextest` items from the original
`03-v0.2-polish` module (now refactored away).

## In Scope

**`nextest` executor:**

- Wraps `cargo nextest run`.
- Cacheable; outputs follow [04-cache-semantics](./04-cache-semantics.aps.md)
  — `[]` for result-only mode, junit/xml report directory for reporting
  mode.
- Inferred per Rust crate by [03-target-inference](./03-target-inference.aps.md).
- Cargo package name pinned via `-p <pkg>` (inherits v0.1.1 fix).

**Nextest-specific options (spec §6.11):**

| Option | Behaviour |
|---|---|
| `profile` | `--profile <name>` (nextest profile, distinct from cargo profile) |
| `partition` | `--partition <spec>` for sharded CI |
| `archiveFile` | `--archive-file <path>` for cross-host runs |
| `workspaceRemap` | `--workspace-remap <path>` for archive-and-run |
| `noFailFast` | `--no-fail-fast` |
| `features` / `allFeatures` / `noDefaultFeatures` | Inherits the [05-cargo-features](./05-cargo-features.aps.md) option set |
| `target` | Rust target triple (inherits 05) |
| `toolchain` | Inherits [06-toolchain-awareness](./06-toolchain-awareness.aps.md) |

Options outside this allowlist are dropped at the cargo-args boundary —
same allowlist convention as v0.1.1's `buildCargoArgs` fix.

**Plugin configuration option:**

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

When `testRunner = "nextest"`, `nx test <crate>` invokes the `nextest`
executor instead of the `test` executor. Per-crate override via
`package.metadata.nxrust.test-runner = "nextest"`.

**Per-crate metadata override (spec §6.1):**

```toml
[package.metadata.nxrust]
test-runner = "nextest"
```

Per-crate value overrides plugin-level setting.

## Out of Scope

- Replacing the `test` executor. Both remain; `testRunner` is a
  selector. Spec open question 1 is deferred — no replacement until
  consumer feedback says so.
- Bench runner integration. `bench` is its own thing
  ([07-generators](./07-generators.aps.md) + Criterion).
- `nextest`'s `archive` subcommand as a separate executor. The
  `archiveFile` option on `run` is sufficient for v0.3; a dedicated
  `nextest-archive` executor is a v0.4+ ask.
- Test report parsing or aggregation. The plugin runs nextest;
  downstream CI consumes the report.

## Interfaces

### Depends On

- `cargo nextest` binary on PATH (`cargo install cargo-nextest --locked`
  or rustup).
- [03-target-inference](./03-target-inference.aps.md) — inferred
  `nextest` target on crates with test code.
- [05-cargo-features](./05-cargo-features.aps.md) — shared
  feature/profile/target/toolchain options.
- [04-cache-semantics](./04-cache-semantics.aps.md) — cache rules.
- [14-diagnostics](./14-diagnostics.aps.md) — missing-tool message.

### Exposes

- `nextest` executor.
- `testRunner` plugin option (`"cargo"` default, `"nextest"` opt-in).
- `package.metadata.nxrust.test-runner` per-crate override.
- A shared cargo-args builder between `test` and `nextest` to keep
  option translation consistent (D-PL2 inheritance — one source of
  truth for cargo-test/nextest option mapping).

## Constraints

- **Single source of truth for cargo-test/nextest option translation.**
  The `test` and `nextest` executors share an option-mapping module;
  divergence between them is a bug.
- **Tool-presence aware.** Missing `cargo-nextest` ⇒ structured
  diagnostic via [14-diagnostics](./14-diagnostics.aps.md), never raw
  shell error.
- **Cache rules inherit from [04-cache-semantics](./04-cache-semantics.aps.md).**
  `nextest`'s archive and junit files are outputs only when configured.
- **Option allowlist enforced.** Inherits v0.1.1 fix — unknown options
  dropped at cargo-args boundary.
- **`testRunner = "nextest"` does not silently change behaviour.** When
  the option is set, the executor used is part of `nx show project`
  output.

## Ready Checklist

Promote individual Work Items to Ready when:

- [ ] A real consumer asks for `nextest` (per D-007).
- [ ] The consumer's nextest usage is captured (which options, which
      profile, which CI shape).
- [ ] A Work Item is drafted.

## Work Items

*No work items yet — module is Proposed. Items promote individually on
real-consumer asks per D-007.*

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `cargo-nextest` executor diverges from `test` executor over time | medium | medium | Share the cargo-arg builder and options-allowlist logic between the two; one source of truth |
| Switching `testRunner` mid-line changes cache hits unexpectedly | medium | medium | Executor identity participates in cache key (via Nx); document the cache invalidation on switch |
| Nextest profile name collides with cargo profile name | low | medium | Distinct option names (`profile` for nextest profile; `cargoProfile` if both needed); document the distinction |
| Missing `cargo-nextest` on the consumer's CI runner | high | medium | Diagnostic on first invocation; consumer installs in their CI setup (documented in `09-supply-chain`-style install hint) |

## Decisions

- **D-NT1:** `nextest` is a sibling executor to `test`, not a
  replacement. Spec open question 1 (replace vs sibling) stays open. *Accepted.*
- **D-NT2:** `testRunner` plugin option + `package.metadata.nxrust.test-runner`
  per-crate override are the routing mechanism. *Accepted.*
- **D-NT3:** `test` and `nextest` share a single cargo-args builder.
  *Accepted.*

## Open Questions

- [ ] Should `nextest` replace `test` once stable? Replacing breaks
      consumers without nextest installed; keeping both grows the
      surface. Spec open question 1. Defer to promotion + consumer
      feedback.
- [ ] Default nextest profile — `default` (nextest's own) or `ci`?
      `default` is safer; `ci` is what most consumers want. Document
      the choice; configurable via option.
- [ ] Should `archiveFile` output participate in caching? Archives are
      large; probably yes with explicit opt-in.
- [ ] Should the `nextest-archive` subcommand be a separate executor
      for the archive-create step? Or keep within the `run` executor?
      Spec §6.11 lists `archive-file` as an option; one executor for
      v0.3.
