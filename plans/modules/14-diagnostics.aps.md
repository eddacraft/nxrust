<!-- APS Module: 14-diagnostics -->
<!-- Status: Proposed -->

# Diagnostics

Actionable error messages for cargo, toolchain, and tool-missing
failures. Every error names what failed, why it matters, the exact
command attempted, and the suggested fix.

| ID   | Owner     | Status   |
| ---- | --------- | -------- |
| DIAG | eddacraft | Proposed |

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

_No work items yet — module is Proposed. Items promote individually on
real-consumer asks per D-007. Diagnostics may also be added as part of
other modules' Work Items where the diagnostic is integral to the
feature — note in the Work Item which diagnostic codes it introduces._

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

## Open Questions

- [ ] Should diagnostic codes be numeric (`NXRUST001`) or slug-based
      (`cargo-not-found`)? Slug is more discoverable; numeric is more
      stable across renames. Probably slug with a documented "do not
      rename" rule.
- [ ] Should the catalogue live in `docs/diagnostics.md` or be generated
      from code annotations? Generated is DRY but adds tooling; manual
      Markdown is simpler. Manual for v0.2, generated later.
- [ ] Should warnings escalate to errors via a plugin option (strict
      mode)? Useful for CI. Yes, add `strictDiagnostics: true`.
- [ ] How does the diagnostic surface interact with `nx affected`'s own
      error output? Affected errors are Nx-side; plugin errors emit
      from inside Nx's executor result. Should be additive, not
      conflicting.
