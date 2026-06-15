<!-- APS Module: 05-cargo-features -->
<!-- Status: Proposed -->

# Cargo Features and Configurations

First-class feature/profile/target controls across executors, plus
inferred Nx configurations that capture the common feature combinations.

| ID       | Owner     | Status   |
| -------- | --------- | -------- |
| FEATURES | eddacraft | Proposed |

## Purpose

Cargo feature flags materially change what Cargo builds, tests, and
lints — feature-gated dependencies, conditional code paths, optional
syscalls, optional protocols. Spec §6.5 makes feature/profile/target a
first-class option set across every relevant executor and lays out a
canonical inferred-configurations shape so consumers can run
`nx test my-crate --configuration=all-features` without per-crate
boilerplate.

v0.1 supports `features`, `all-features`, `release`, `profile`, `target`,
and `toolchain` in the shared executor schema. This module closes the
remaining gap (`no-default-features`, `defaultFeatures` convenience) and
adds the inferred configurations to every inferred target.

## In Scope

**Option surface (spec §6.5):**

| Option              | Behaviour                                                                        |
| ------------------- | -------------------------------------------------------------------------------- |
| `features`          | `--features` (string or string array). v0.1 ✅                                   |
| `allFeatures`       | `--all-features`. v0.1 ✅                                                        |
| `noDefaultFeatures` | `--no-default-features`. v0.1 partial — extend & document                        |
| `defaultFeatures`   | Explicit boolean convenience (mutually exclusive with `noDefaultFeatures`). New. |
| `profile`           | `--profile`. v0.1 ✅                                                             |
| `release`           | `--release`. v0.1 ✅                                                             |
| `target`            | `--target`. v0.1 ✅                                                              |
| `toolchain`         | `cargo +<toolchain>`. v0.1 ✅                                                    |

- The schema for these lives in `src/models/base-options.ts` (already
  exists for most). Schema additions follow the v0.1.1 allowlist pattern
  (`buildCargoArgs` per-subcommand allowlist) to avoid leaking
  unrelated CLI args into cargo.

**Inferred configurations (spec §6.5):**

```json
{
  "configurations": {
    "default": {},
    "all-features": { "allFeatures": true },
    "no-default-features": { "noDefaultFeatures": true },
    "release": { "release": true }
  }
}
```

- Configurations applied to every inferred target where they make sense
  (`check`, `build`, `test`, `lint`, `doc`; not `fmt`/`fmt-check`/`run`).
- Configurable via plugin option to suppress or extend the inferred set.
- Per-crate overrides via
  `[package.metadata.nxrust.targets.<name>.configurations]` table.

**`package.metadata.nxrust.targets.<name>` defaults:**

- Parsed by
  [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md).
- Examples that should round-trip cleanly:

  ```toml
  [package.metadata.nxrust.targets.test]
  all-features = true

  [package.metadata.nxrust.targets.check]
  features = ["default", "tokio"]
  ```

**Feature/profile/target participation in cache key:**

- Already covered by [04-cache-semantics](./04-cache-semantics.aps.md);
  this module ensures the options reach Nx's input layer via Nx's
  `args`/`configurationDefaults` so cache keys differentiate feature sets.

## Out of Scope

- Toolchain hashing — that's
  [06-toolchain-awareness](./06-toolchain-awareness.aps.md).
- Feature-aware affected behaviour (a `--features foo` change only
  invalidating `foo`-dependent crates) — that's
  [13-affected-refinement](./13-affected-refinement.aps.md).
- nextest-specific feature options — those live in
  [11-nextest](./11-nextest.aps.md).
- Cross-compile orchestration (matrix builds per `--target`) — flagged in
  spec §10 risk table as v0.3+; not in this module's scope.

## Interfaces

### Depends On

- v0.1's `src/utils/build-command.ts` and
  `src/models/base-options.ts`.
- [02-workspace-inference-and-graph](./02-workspace-inference-and-graph.aps.md)
  — `package.metadata.nxrust.targets.<name>` parser.
- [03-target-inference](./03-target-inference.aps.md) — inferred targets
  carry the configurations.
- [04-cache-semantics](./04-cache-semantics.aps.md) — feature/profile
  participation in the cache key.

### Exposes

- `noDefaultFeatures` / `defaultFeatures` option contract across
  executors.
- Inferred configuration set per target (`default`, `all-features`,
  `no-default-features`, `release`).
- `package.metadata.nxrust.targets.<name>.configurations` override shape.

## Constraints

- **Mutual exclusion checks.** `defaultFeatures: true` and
  `noDefaultFeatures: true` together is a configuration error rejected
  by [14-diagnostics](./14-diagnostics.aps.md).
- **Allowlist forwarding only.** Inherits the v0.1.1 fix — only the
  documented option keys reach cargo's argv; unknown keys are dropped.
- **Configuration names are stable.** Renaming `all-features` or
  `release` is a major bump.
- **Per-crate metadata overrides are additive.** They extend the inferred
  set, do not replace it, unless the consumer explicitly opts out via
  plugin option.

## Ready Checklist

Promote individual Work Items to Ready when:

- [ ] A real consumer hits a missing option, a broken configuration, or
      a feature-cache miss (per D-007).
- [ ] The desired invocation is captured (e.g.
      `nx test my-crate --configuration=all-features`).
- [ ] A Work Item is drafted.
- [ ] A test fixture for the failing configuration is added or planned.

## Work Items

_No work items yet — module is Proposed. Items promote individually on
real-consumer asks per D-007._

## Risks & Mitigations

| Risk                                                                         | Impact | Likelihood | Mitigation                                                                                    |
| ---------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------- |
| Inferred configurations collide with consumer-defined ones in `project.json` | medium | medium     | Consumer-explicit wins; surface the merge via `nx show project` if feasible                   |
| `noDefaultFeatures` + `defaultFeatures` simultaneous true silently picks one | medium | low        | Reject at schema/validate time with a [14-diagnostics](./14-diagnostics.aps.md) message       |
| Feature-set changes don't bust cache (because not in cache key)              | high   | low        | Verified in [04-cache-semantics](./04-cache-semantics.aps.md) fixture matrix                  |
| Per-crate metadata overrides become a second source of truth                 | medium | medium     | Document precedence (consumer `project.json` > `package.metadata.nxrust` > inferred defaults) |

## Decisions

- **D-F1:** Inferred configurations are `default`, `all-features`,
  `no-default-features`, `release` — fixed names for stability. Others
  must come from consumer `project.json` or `package.metadata.nxrust`.
  _Accepted (inherits spec §6.5)._
- **D-F2:** `noDefaultFeatures` and `defaultFeatures` are mutually
  exclusive at schema validation time. _Accepted._
- **D-F3:** Configuration name stability is part of the v1.0 contract.
  Renames are major bumps. _Accepted._

## Open Questions

- [ ] Should an inferred `minimal` configuration exist
      (`--no-default-features` + `--features <minimal-set>`)? Spec §8.2
      mentions "minimal" alongside "all-features/release". Defer to
      promotion.
- [ ] Should `target` (Rust target triple) get its own inferred
      configuration set, or stay an option? Configurations per target
      triple may explode the matrix. Stay option-only by default.
- [ ] How are workspace-wide feature defaults (`workspace.default-members`
      patterns) reconciled with per-crate feature sets? Cargo's resolver
      already does this; the plugin just forwards.
