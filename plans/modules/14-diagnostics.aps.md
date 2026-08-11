<!-- APS Module: 14-diagnostics -->
<!-- Status: In Progress -->

# Diagnostics

Actionable error messages for cargo, toolchain, and tool-missing
failures. Every error names what failed, why it matters, the exact
command attempted, and the suggested fix.

| ID   | Owner     | Status                                                                                |
| ---- | --------- | ------------------------------------------------------------------------------------- |
| DIAG | eddacraft | In Progress (DIAG-001 + DIAG-002 + CACHE-OBS-001 Complete on main — pending next minor) |

## Purpose

Nx-plus-Cargo failures are easy to misread. A raw `cargo` shell error
dropped into an Nx task output is a stack trace divorced from context —
the consumer sees `error: no matching package named 'foo' found` and
loses time chasing it. Spec §6.14 makes diagnostics first-class: every
plugin-detectable failure surfaces a structured error with four parts:
what failed, why it matters, the exact command attempted (when safe to
quote), and the suggested fix.

This module is cross-cutting. It is consumed by every other module —
[06-toolchain-awareness](./06-toolchain-awareness.aps.md) needs missing-
toolchain diagnostics, [09-supply-chain](./09-supply-chain.aps.md) needs
missing-tool diagnostics, [08-release-support](./08-release-support.aps.md)
needs publish-failure diagnostics, and so on.

## In Scope

**Diagnostic surface (spec §6.14):**

A single `formatDiagnostic({ what, why, command?, fix })` helper that
produces consistent output across all executors and generators. Output
shape:

```
[nxrust] <what>
  why: <why>
  command: <command, if safe to print>
  fix: <fix>
```

**Required diagnostic cases (spec §6.14):**

| Trigger                                                                | Output                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cargo` not on PATH                                                    | "cargo not found … install rustup via https://rustup.rs"                                                                                                                                                                                                                                                                                                                                                                                                      |
| not a Cargo workspace at Nx root                                       | "no `[workspace]` or `[package]` in root Cargo.toml … run `nx g @eddacraft/nxrust:init`"                                                                                                                                                                                                                                                                                                                                                                      |
| `Cargo.toml` parse failure                                             | "Cargo.toml parse error at <path>:<line> … fix the syntax error"                                                                                                                                                                                                                                                                                                                                                                                              |
| `cargo metadata` failure                                               | "cargo metadata exited <code> … run `cargo metadata` directly to see Cargo's own error"                                                                                                                                                                                                                                                                                                                                                                       |
| crate not in workspace                                                 | "<crate> not declared in workspace.members … add `members = ["<path>"]` to root Cargo.toml"                                                                                                                                                                                                                                                                                                                                                                   |
| duplicate package names                                                | "<name> appears twice in workspace … rename one or use package-key/project-key divergence option"                                                                                                                                                                                                                                                                                                                                                             |
| unsupported virtual manifest shape                                     | "virtual manifest with no members … add `members = [...]`"                                                                                                                                                                                                                                                                                                                                                                                                    |
| toolchain missing (`rustup` channel not installed)                     | "toolchain `<channel>` not installed … `rustup install <channel>`"                                                                                                                                                                                                                                                                                                                                                                                            |
| nightly required                                                       | "<target> requires nightly … add `[toolchain] channel = "nightly"` to rust-toolchain.toml or pass `--toolchain=nightly`"                                                                                                                                                                                                                                                                                                                                      |
| target not installed                                                   | "Rust target `<triple>` not installed … `rustup target add <triple>`"                                                                                                                                                                                                                                                                                                                                                                                         |
| `nextest`/`audit`/`deny`/`outdated`/`vet` not installed                | "cargo-<tool> not on PATH … `cargo install cargo-<tool> --locked`"                                                                                                                                                                                                                                                                                                                                                                                            |
| `napi`/`wasm-pack` not installed                                       | tool-specific install hint                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `defaultFeatures` + `noDefaultFeatures` simultaneous true              | "options mutually exclusive … pass exactly one"                                                                                                                                                                                                                                                                                                                                                                                                               |
| `package.metadata.nxrust` unknown key                                  | "unknown key `<key>` in package.metadata.nxrust … see <docs link>"                                                                                                                                                                                                                                                                                                                                                                                            |
| `project.json` declares a target that conflicts with inferred shape    | "<target> in project.json overrides inferred target … remove project.json entry to use inference, or keep override and silence this warning via <option>"                                                                                                                                                                                                                                                                                                     |
| `release-publish` without credentials                                  | "no CARGO_REGISTRY_TOKEN and no `[registry]` config … `cargo login` or pass `--registry=<name>` with config"                                                                                                                                                                                                                                                                                                                                                  |
| Workspace-dep missing version                                          | "`crate-a = { path = "..." }` has no `version = "..."` field; release-publish requires version … add version"                                                                                                                                                                                                                                                                                                                                                 |
| Cross-language edge inherits workspace `^build` test default (ISS-001) | warning: "JS project `<name>` inherits `test.dependsOn: ["^build"]` across a cross-language edge to Rust crate `<crate>`; every JS test will trigger a transitive cargo build and serialise on the workspace `target/` lock. Fix: narrow `test.dependsOn` on `<name>`, or split scripts at the entry point (`test:js && test:rust`). See `docs/recipes/javascript-rust-test-seams.md`." (severity: warning; surfaced by `nxrust doctor` only — not in-flight) |

**Common envelope:**

- All diagnostics route through the same formatter.
- Exit code 1 on hard failures; stderr-only warning shape for soft cases
  (unknown metadata key).
- Optional `--json-diagnostics` plugin option emits structured JSON
  alongside human-readable text for IDE consumption (Nx Console).

**Severity tiers:**

- **Error** — task does not run, exits non-zero, plugin sets `result =
failure`.
- **Warning** — task runs but the plugin logs a diagnostic; e.g.
  deprecated option, unknown metadata key.
- **Info** — informational; e.g. "using `rustup` default toolchain
  because rust-toolchain.toml not found". Off by default behind a
  `verboseDiagnostics` plugin option.

## Out of Scope

- Translating arbitrary `cargo` stdout/stderr into structured
  diagnostics. The plugin handles its own pre-flight checks and post-mortem
  classification; Cargo's own output passes through unchanged for
  in-flight errors (rustc compile errors, etc.).
- Replacing rustc's diagnostic format. Compiler errors stay as Cargo
  emits them; this module wraps the surrounding plugin layer.
- Localisation. UK English in plan and README; user-facing CLI output
  stays locale-neutral (inherits index constraint). Localised messages
  are a v1.x+ ask.

## Interfaces

### Depends On

- v0.1's executor and generator framework.
- Nx's error-surfacing contract (`@nx/devkit ^22.6.5`).
- Every other module that needs to surface a diagnostic.

### Exposes

- `formatDiagnostic(...)` helper.
- `runWithDiagnostic(...)` wrapper around `cargo` invocations that
  catches known-failure shapes and emits structured diagnostics.
- `--json-diagnostics` plugin option.
- `verboseDiagnostics` plugin option.
- A documented diagnostic catalogue (in `docs/`) listing every code,
  trigger, and fix for consumer reference and Nx Console integration.

## Constraints

- **Every plugin-detectable failure produces a diagnostic.** Raw
  unwrapped shell errors are a bug; the catalogue above is exhaustive
  for known cases.
- **`command:` field redacts secrets.** Never print env vars containing
  `TOKEN`, `SECRET`, `KEY`, `PASSWORD`. Substitute with `<redacted>`.
- **Diagnostic codes are stable.** Renaming or removing a code is a
  major bump. Adding new codes is a minor bump (D-008).
- **No `console.log` outside `formatDiagnostic`.** All plugin output
  routes through the formatter.
- **JSON output is schema-stable.** Nx Console may consume it; schema
  changes are minor bumps with a CHANGELOG entry.

## Ready Checklist

Promote individual Work Items to Ready when:

- [ ] A real consumer hits an opaque failure and reports it (per
      D-007), or a missing diagnostic case surfaces during another
      module's work.
- [ ] The failing input is captured (the trigger that produces the bad
      UX).
- [ ] A Work Item is drafted scoped to that diagnostic.

## Work Items

### DIAG-001 — `formatDiagnostic` helper + `nxrust doctor` (ISS-001 seam check)

- **Status:** Complete (2026-06-21, on main — pending next minor release;
  Anvil's #2 upstream ask; Anvil ADR-049 waits on `doctor`. First slice under
  D-011. Reconciled 2026-08-10.)
- **Validation:** `pnpm test` (doctor + diagnostics unit suite green on merge
  commit `5a51ce3`); generator registered in `generators.json`; code under
  `src/generators/doctor/` and `src/utils/diagnostics.ts`.

- `src/utils/diagnostics.ts` — the shared `formatDiagnostic({ what, why,
  command?, fix, severity? })` helper (spec §6.14 envelope) with secret
  redaction (`redactSecrets` strips `TOKEN`/`SECRET`/`KEY`/`PASSWORD` values
  from the `command:` field, D-D / module constraint).
- `@eddacraft/nxrust:doctor` generator (`src/generators/doctor/`) — read-only;
  resolves the project graph and reports the **ISS-001 cross-language `^build`
  test seam**: a JS project whose merged `test` target still inherits `^build`
  across a dependency edge to a Rust crate. Pure detection
  (`findCrossLanguageBuildSeams`) is split from the generator for unit testing
  and reuses the exact `isInheritedBuildDep` matcher that the WN-001 seam
  helpers use, so detection and fix never diverge. Ships as a generator because
  that is the Nx entry point with graph access and there is no synthetic
  `rust-workspace` project to host an executor yet (module 12, Proposed).

**Deferred to later DIAG slices** (not in DIAG-001): the cache-config warnings
(`CARGO_TARGET_DIR` / lockfile / toolchain surprises), `--json-diagnostics` for
Nx Console, `explain affected` (ISS-004 #4, module 13), and the tool-missing
checks for the supply-chain/wasm tools (promote with modules 09/10). The
cargo/toolchain pre-flight family is now **DIAG-002** (below).

### DIAG-002 — Cargo/toolchain pre-flight diagnostic family

- **Status:** Complete (2026-06-24, on main — pending next minor release;
  next slice after DIAG-001, built on its `formatDiagnostic` envelope. Routes
  cargo/rustup failures through the structured envelope so a missing
  toolchain/target surfaces as an actionable nxrust error instead of a raw
  shell failure. Reconciled 2026-08-10.)
- **Validation:** `pnpm test` (225 green on merge commit `7d0dd3e`); catalogue
  in `docs/diagnostics.md`; classifier coverage in `diagnostics.spec.ts` /
  `run-process.spec.ts`.

- `src/utils/diagnostics.ts` — extends the envelope with **slug-based diagnostic
  codes** (`DIAGNOSTIC_CODES`, `DiagnosticCode`, D-D5), a `code` field on
  `Diagnostic` plus a `CataloguedDiagnostic` type, and an
  `NxrustDiagnosticError` that carries the code so callers branch on `.code`.
  Builders for the family: `cargo-not-found`, `toolchain-not-installed`,
  `target-not-installed`, `nightly-required`, `invalid-toolchain-literal`, and a
  generic `spawn-failed`. Secret redaction extended to `--token`-style flags
  (both `--token x` and `--token=x`).
- `runWithDiagnostic` classifier — maps spawn `ENOENT` on cargo/rustup to
  `cargo-not-found` and classifies rustup/cargo stderr (toolchain/target
  missing, nightly-only). Unknown cargo output passes through unchanged (module
  14 Out-of-Scope — no translation of arbitrary cargo output).
- `src/utils/run-process.ts` — stderr is teed (live passthrough + 64 KB tail
  capture) so the single cargo-invocation chokepoint can classify failures;
  replaces the bare `console.error` (constraint: no `console.*` outside the
  envelope). Settles once across `error`/`close`.
- `src/utils/rust-toolchain.ts` — `validateChannelLiteral` now throws
  `NxrustDiagnosticError(invalidToolchainLiteral(...))` instead of a bare
  `Error`, joining the catalogue while preserving the legacy wording.
- `docs/diagnostics.md` — catalogue stub documenting the six codes, triggers,
  and fixes (seeds the consumer/Nx-Console reference).
- Tests: `diagnostics.spec.ts` (builders, codes, error, classifier, redaction),
  `run-process.spec.ts` (integration: ENOENT, classified stderr, unknown
  pass-through, success). Full suite 225 green; e2e confirms cargo's live
  colourised output still surfaces through the teed-stderr path.

**Still deferred** (not in DIAG-002): the tool-missing checks for
`nextest`/`audit`/`deny`/`napi`/`wasm-pack` (promote with modules 09/10), the
workspace-shape / `cargo metadata` / duplicate-package pre-flight rows,
`--json-diagnostics`, and the `verboseDiagnostics` Info tier.

### CACHE-OBS-001 — `nxrust cache-report` cache-observability generator (ISS-004 #7)

- **Status:** Complete (2026-06-21, on main — pending next minor release;
  Anvil's #7 upstream ask; first slice of ISS-004 items 4-7 under D-012.
  Spans modules 04/14. Reconciled 2026-08-10.)
- **Validation:** `pnpm test` (cache-report unit suite on merge commit
  `9a18b79`); generator registered in `generators.json`; code under
  `src/generators/cache-report/`.

- `@eddacraft/nxrust:cache-report` generator (`src/generators/cache-report/`,
  alias `cache-info`) — read-only; resolves the project graph and prints, per
  inferred Rust crate, each nxrust target's effective `inputs`, `outputs`, the
  `CACHE_ENV_ALLOWLIST` entries pinned into the cache key, and the resolved
  target-dir root. Accepts `--project <name>` to filter and `--json` for
  structured output. Pure collection (`collectCacheReport`) is split from the
  generator for unit testing, mirroring `doctor`'s `diagnose.ts`.
- Reads inputs/outputs **straight off the graph nodes' target configs** — it
  never recomputes inference (`graph.ts`/CACHE-004 already did). The only
  derivation is the target-dir root, via `resolveTargetDirRoot`
  (`src/utils/target-dir.ts`), where `resolveEnvTargetDirRoot` was lifted out of
  `graph.ts` (behaviour-preserving — `graph.ts` now imports it) so the report
  and the real cache key share one `CARGO_TARGET_DIR` resolution rule (D-C7).
- Distinct from `doctor`: `doctor` warns about problems; `cache-report` is
  observability — it answers "what is in my cache key and where do artefacts
  land?" without judging it. Ships as a generator for the same reason `doctor`
  does (no synthetic `rust-workspace` executor host yet, module 12).

**Deferred** (not in CACHE-OBS-001; still Ready under D-012, not yet built):
AFFECTED-001 (`explain affected`, module 13 — **next Ready slice**), LIST-001
(`nxrust list`, module 12), WN-003 (first-class JS-backing-crate + NAPI
test-target defect, modules 10/13).

_Further items promote individually per D-007 / D-010. Diagnostics may also be
added as part of other modules' Work Items where the diagnostic is integral to
the feature — note which codes it introduces._

## Risks & Mitigations

| Risk                                                       | Impact | Likelihood | Mitigation                                                                                              |
| ---------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------- |
| Diagnostic catalogue grows out of sync with implementation | medium | high       | Lint test: every diagnostic emitted in code references a documented code; CI fails on undocumented code |
| Secrets leak into `command:` field                         | high   | low        | Allowlist redaction at `formatDiagnostic` boundary; CI test with token-like env exercises the redaction |
| Localised messages diverge from English source of truth    | low    | low        | Out of scope until v1.x; no localisation infrastructure shipped in v0.x                                 |
| JSON schema changes break Nx Console integration           | medium | low        | Schema versioned; minor bump for additions; major for breaking changes                                  |
| Over-eager warnings drown out signal                       | medium | medium     | Severity tiers; `verboseDiagnostics` off by default; warnings only for clear consumer-fixable cases     |

## Decisions

- **D-D1:** Every plugin-detectable failure produces a structured
  diagnostic; raw shell errors only for in-flight cargo output.
  _Accepted (inherits spec §6.14)._
- **D-D2:** Diagnostic codes are stable; additions are minor bumps,
  removals are major bumps. _Accepted._
- **D-D3:** UK English in plan and README, locale-neutral in user-facing
  CLI output. _Accepted (inherits index constraint)._
- **D-D4:** No localisation in v0.x. _Accepted._
- **D-D5:** Diagnostic codes are **slug-based with an `nxrust:` prefix**
  (`nxrust:cargo-not-found`), not numeric. Slugs are more discoverable in
  logs and IDE output; the "do not rename" rule (D-D2: rename = major bump,
  add = minor bump) supplies the stability numeric codes would otherwise
  give. _Accepted 2026-06-24 — resolved via DIAG-002._

## Open Questions

- [x] Should diagnostic codes be numeric (`NXRUST001`) or slug-based
      (`cargo-not-found`)? **Resolved (D-D5):** slug-based with an
      `nxrust:` prefix and a documented "do not rename" rule.
- [ ] Should the catalogue live in `docs/diagnostics.md` or be generated
      from code annotations? Generated is DRY but adds tooling; manual
      Markdown is simpler. Manual for v0.2, generated later.
- [ ] Should warnings escalate to errors via a plugin option (strict
      mode)? Useful for CI. Yes, add `strictDiagnostics: true`.
- [ ] How does the diagnostic surface interact with `nx affected`'s own
      error output? Affected errors are Nx-side; plugin errors emit
      from inside Nx's executor result. Should be additive, not
      conflicting.
