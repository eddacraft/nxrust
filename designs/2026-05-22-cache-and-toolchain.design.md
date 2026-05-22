# Cache Semantics + Toolchain Awareness

Architectural design for the paired implementation of cache correctness
and toolchain participation in nxrust. Targets modules 04 and 06.

| Field | Value |
|-------|-------|
| Status | Council-approved; awaiting user review |
| Owner | eddacraft |
| Created | 2026-05-22 |
| Revised | 2026-05-22 (council round 2 — APPROVE / ACCEPT_FOR_USER_REVIEW) |
| Modules | [04-cache-semantics](../plans/modules/04-cache-semantics.aps.md), [06-toolchain-awareness](../plans/modules/06-toolchain-awareness.aps.md) |
| Related | spec §6.4, §6.6; D-007 (consumer-driven promotion); D-009 (cross-language contract) |

## Council Review Changelog

**v2 (2026-05-22)** — Incorporates architect + adversarial-reviewer findings:

- § A: per-project `rust-toolchain.toml`, legacy `rust-toolchain`, and
  per-project `.cargo/config.toml` added to `rustSources`. Build-script
  and nested-config gaps documented.
- § B: allowlist expanded with `CARGO_ENCODED_RUSTFLAGS`, `RUSTC`,
  `RUSTC_WRAPPER`, `OPENSSL_STATIC`, `OPENSSL_NO_PKG_CONFIG`. Documented
  gaps section added (build-script env, cross-compile vars, sccache
  coherence).
- § C: corrected the `runtime` input contract — `rustc -Vv` is
  session-global in Nx, so per-target toolchains require explicitly
  parameterised runtime commands (`rustup run <channel> rustc -Vv`).
  `RUSTC` env var participation added. Performance budget revised for
  per-target runtime strings.
- § D: new Task-option participation subsection — `release`, `features`,
  `no-default-features`, `all-features`, target-triple argv must
  contribute to the cache key.
- § E: single-source-of-truth helper specified; `init` merge semantics
  tightened (warn loudly on incomplete consumer override);
  `narrowBuildOutputs` clarified to control output width only, not
  inputs.
- § F: unconditional cold cache on v0.1 → v0.2 clarified; CI-fleet
  upgrade-window guidance added.
- Module boundary: `RUSTUP_TOOLCHAIN` ownership clarified — module 06
  owns the toolchain selector; module 04's allowlist references rather
  than re-declares.
- Promotion plan: re-sequenced so TOOLCHAIN-001 precedes TOOLCHAIN-002;
  CACHE-001 and TOOLCHAIN-002 collapsed into one work item or
  explicitly sequenced (they edit the same `target-configs.ts`
  functions).
- Open questions: item 9 (Anvil migration) resolved as "absorb at
  work-item drafting time."

**v2.1 (2026-05-22, council round 2)** — Addresses adversarial round 2
findings:

- Promotion plan re-sequenced: **TOOLCHAIN-002 now precedes CACHE-001**.
  Round 1's ordering risked an interim window where CACHE-001 baked
  channel literals using only TOOLCHAIN-001's file-only resolution,
  silently dropping `package.metadata.nxrust.toolchain` overrides.
- § C bare-vs-rustup-run detection rule made explicit
  (`resolvedToolchain === "default"` sentinel emits bare commands).
- § C channel-literal sanitisation specified: validated against
  `[A-Za-z0-9._+-]+`; shell-meta is a hard error via module 14
  diagnostic, not silent quoting.
- § C same-path patched `$RUSTC` limitation acknowledged with
  `additionalCacheRuntime` mitigation (`sha256sum "$RUSTC"`).
- § D `package` option clarified as per-target literal baked at
  emission time (inherits v0.1.1 pin fix), not a consumer-overrideable
  invocation flag.
- § F: S3 / Azure Blob remote-cache PUT-surge note added with
  pre-warm and concurrency-cap recommendations.

## Problem

Three pressures converge:

1. **Consumer DX**. The active consumer (anvil + eddacraft engineering)
   wants shorter CI and shorter local rebuild cycles. v0.1's cache
   contract is conservative-by-omission: most targets have `cache: true`
   but no explicit `inputs`, no env-var participation, no toolchain
   participation. Nx fills the gap with project-root-default inputs,
   which means *any* file change under the project busts the cache —
   including unrelated edits — and `rustc` upgrades silently keep
   returning stale hits. The first half (false misses) wastes time; the
   second half (false hits) is a correctness bug waiting to fire.
2. **Foundational risk**. The index's "Cache-key gaps cause silent
   miscompiles" risk is HIGH-impact. Toolchain + env hashing is the
   ground floor for every other cache-aware module (05 features, 09
   supply-chain, 10 wasm/napi, 11 nextest, 12 workspace-synthetic, 13
   affected). Until cache + toolchain land coherently, downstream
   modules either build on sand or duplicate work.
3. **One contract, two modules**. Splitting cache (04) and toolchain
   (06) into separate modules made promotion-time sense — each can
   absorb its own consumer ask — but the contract is one thing. Inputs,
   outputs, env, and toolchain-version compose into a single cache key.
   Designing them separately invites a future mismatch where module 04
   ships, module 06 lags, and the resulting cache key is wrong on every
   target.

This design captures the shared contract so the two modules promote in
lockstep when the consumer trigger fires, with no negotiation needed at
work-item drafting time.

## Goals

- **Define the cache-key composition for every cacheable Rust target**
  precisely enough that two reviewers reading this doc independently
  arrive at the same input/output/env/runtime set per target.
- **Pin the toolchain participation contract** — exactly what gets
  hashed, when it's queried, how the result is cached across an Nx
  session.
- **Specify a CI fixture matrix shape** that fails loudly on any of:
  false cache hit across toolchain change, false miss on cosmetic edit,
  silent loss of env-var participation, drift between inferred and
  generator-emitted target shapes.
- **Map a migration path from v0.1** that preserves working caches
  where the v0.1 behaviour was correct, and explicitly invalidates only
  where it was wrong.
- **Surface every trade-off and open question** with a proposed
  position so review can converge in one round.

## Non-Goals

- **Affected-set behaviour after input change** — that's module 13. The
  inputs defined here are the leaves of the affected graph but affected
  composition rules are separate.
- **Cross-compilation matrices** (target-triple selection, multi-target
  builds in one project) — v0.3+ scope, intentionally deferred.
- **Reimplementing Cargo's incremental cache.** `target/`'s internal
  structure is Cargo's. We hash *around* it (cache keys, narrow
  outputs), not *into* it (no fingerprint dissection).
- **Remote-cache backend selection.** Whatever Nx's remote cache uses
  (`@nx/azure-cache`, `@nx/powerpack-cache`, S3, etc.) — the cache key
  is the same shape.
- **Pre-built executor catalogue beyond v0.1's set.** Targets named in
  this doc are the ones v0.1 emits or module 03 will infer. New
  executors (nextest, audit, bench) inherit the contract by reference.

## Design

### A. Named inputs

Two named inputs live in `nx.json` and are referenced by every Rust
target the plugin emits or infers.

```jsonc
{
  "namedInputs": {
    "rustSources": [
      "{projectRoot}/src/**/*.rs",
      "{projectRoot}/tests/**/*.rs",
      "{projectRoot}/benches/**/*.rs",
      "{projectRoot}/examples/**/*.rs",
      "{projectRoot}/build.rs",
      "{projectRoot}/Cargo.toml",
      "{projectRoot}/rust-toolchain.toml",
      "{projectRoot}/rust-toolchain",
      "{projectRoot}/.cargo/config.toml"
    ],
    "rustWorkspace": [
      "{workspaceRoot}/Cargo.toml",
      "{workspaceRoot}/Cargo.lock",
      "{workspaceRoot}/rust-toolchain.toml",
      "{workspaceRoot}/rust-toolchain",
      "{workspaceRoot}/.cargo/config.toml"
    ]
  }
}
```

**Why per-project toolchain and config files participate.** Cargo and
rustup walk the directory tree upward looking for `rust-toolchain.toml`
and `.cargo/config.toml`. A per-crate `rust-toolchain.toml` is a
legitimate rustup pattern (single crate pinned to nightly while the
workspace is stable). A per-crate `.cargo/config.toml` is the
documented mechanism for per-crate linker overrides or
`[target.<triple>]` rules. Hashing only the workspace-root copy lets a
per-crate edit silently produce stale binaries — false hit on remote
cache. The legacy single-line `rust-toolchain` (no `.toml`) file is
included for backwards compatibility with rustup's older format.

**Composition.** Every cacheable Rust target uses both:

```jsonc
{
  "inputs": ["rustSources", "rustWorkspace", "^rustSources"]
}
```

`^rustSources` means "the `rustSources` of every upstream project," so a
crate's cache busts when a dependency crate's source changes.

**Registration.** The `init` generator merges these named inputs into
`nx.json` on plugin install. If the consumer already has `namedInputs`
with the same key, the plugin warns and leaves them alone (consumer
wins; documented in module 14 diagnostics).

**Why this set.**

- `src/**/*.rs`, `tests/**/*.rs`, `benches/**/*.rs`, `examples/**/*.rs`
  — every `.rs` Cargo will read. `examples/` participates because
  changing an example file shouldn't bust the cache on a `cargo check`
  for the crate's library, but `cargo test` may compile examples
  depending on profile. Conservative: include them. Trade-off
  acknowledged in § Open questions.
- `build.rs` — explicit; build scripts mutate compilation.
- `Cargo.toml` per project — features, deps, profile inherits.
- `Cargo.lock` workspace-wide — version pinning.
- `rust-toolchain.toml` workspace-wide — pinned channel.
- `.cargo/config.toml` workspace-wide — `[build]` target, `[net]`
  proxy, `[alias]`, `[env]` injected env vars. All of these affect
  output.

**What's intentionally NOT in the named inputs.**

- `target/` — Cargo's own cache. Including it would invalidate every
  cache hit on every successful build, which is wrong.
- `.git/`, `.nx/`, `node_modules/` — irrelevant; Nx's default
  exclusions cover these.
- Top-level `README.md`, `LICENSE`, `CHANGELOG.md` — cosmetic; would
  bust on doc edits.
- `package.json` — JS side; Rust targets don't read it. (The
  cross-language seam is handled by module 02's edge metadata and
  D-009.)

**Documented gaps (acknowledged, not fixed in v0.2).**

- **Intermediate-directory `.cargo/config.toml`.** Cargo walks every
  parent directory between the crate manifest and `/`, merging every
  `.cargo/config.toml` it finds. We hash the workspace-root and
  project-root copies; configs at intermediate depths (e.g.
  `{workspaceRoot}/crates/.cargo/config.toml`) are invisible. Mitigation:
  document the layout constraint; if a consumer hits this we add the
  intermediate path to `rustWorkspace` as a one-line patch. Logged as
  a known limitation in module 04.
- **`build.rs`-declared inputs.** Cargo build scripts can emit
  `cargo:rerun-if-changed=path` and `cargo:rerun-if-env-changed=VAR`
  to register additional cache-invalidating signals. We hash `build.rs`
  itself but not its declared inputs. Mitigation: consumers with
  codegen build scripts add the extra paths to the project's `inputs`
  manually, and add env vars to `additionalCacheEnv` (§ B). Document
  as a known gap; long-term fix is to parse `cargo metadata`'s
  `build_script_outputs` — deferred to a later module's work item.

### B. Environment-variable allowlist

Cache keys participate the following env vars by default:

| Env var | Why it matters |
|---------|----------------|
| `RUSTFLAGS` | Single biggest cache-affecting var; changes optimisation, linker, codegen |
| `CARGO_ENCODED_RUSTFLAGS` | NUL-delimited form Cargo gives precedence over `RUSTFLAGS` when both are set; injected by some wrapper scripts and Cargo's own re-invocations |
| `RUSTDOCFLAGS` | Affects `doc` target output |
| `RUSTC` | Full compiler-binary replacement; Cargo runs `$RUSTC` instead of `rustc` when set. Without participation, swapping `RUSTC=/path/to/custom-rustc` is invisible |
| `RUSTC_WRAPPER` | Wraps every `rustc` invocation (sccache pattern). Different wrapper binary or wrapper version can change compilation; participation closes the sccache-coherence gap at the env-key level |
| `CARGO_TARGET_DIR` | Redirects `target/`; outputs land elsewhere |
| `CARGO_BUILD_TARGET` | Cross-compilation target triple |
| `CARGO_PROFILE_RELEASE_LTO` | Profile override at env layer |
| `CARGO_PROFILE_RELEASE_CODEGEN_UNITS` | Profile override at env layer |
| `CC`, `CXX`, `AR` | C/C++ compilers used by build scripts and `cc-rs` |
| `PKG_CONFIG_PATH` | Affects `*-sys` crates that find native deps via `pkg-config` |
| `OPENSSL_DIR` | Affects `openssl-sys` builds |
| `OPENSSL_STATIC` | Toggles static vs dynamic OpenSSL linkage; different binary output |
| `OPENSSL_NO_PKG_CONFIG` | Disables pkg-config probe in `openssl-sys`; changes resolution path and resulting binary |
| `RUSTUP_TOOLCHAIN` | Toolchain selector — primarily owned by module 06's hierarchy (see § C); participates here because Nx hashes env at the target level |

Implementation: each cacheable target's `inputs` carries
`{ "env": "VAR_NAME" }` entries. The full env list lives in a shared
helper (see § E) so generator-emitted and inferred-target wiring stay
identical.

**Allowlist semantics.**

- The set above is the default. The plugin exposes a plugin option
  `additionalCacheEnv: string[]` for consumer-specific additions.
- Anything outside the allowlist is intentionally ignored — keeping the
  cache hit rate high on machines with rich env (most of them).
- No subtraction. If `RUSTFLAGS` is in the allowlist, it stays in the
  allowlist. Consumers who don't set it pay nothing; consumers who do
  get correctness.

**Why not "hash all env vars."** Many CI systems inject dozens of
unrelated env vars per job (`GITHUB_*`, `BUILDKITE_*`, `CI_*`). Hashing
them all would mean zero cache hits across CI runs. The allowlist is
the negotiated middle.

**Correctly excluded.**

- `CARGO_INCREMENTAL` — toggles Cargo's incremental compilation. Affects
  layout inside `target/` but not the final binary content; including
  it would force false misses with no correctness benefit.
- `CARGO_NET_*` — network policy (offline mode, git-fetch-with-cli).
  Don't change compilation output.
- `CARGO_HOME` — registry/toolchain path. Theoretically affects which
  registry index resolves a `Cargo.lock` line, but in practice all
  workers in a fleet share the same registry mirror. Excluded by
  default; consumers in heterogeneous registry-mirror setups can add
  via `additionalCacheEnv`.
- `SCCACHE_*` — sccache-internal routing. `RUSTC_WRAPPER=sccache` is
  what we hash; the sccache configuration itself is sccache's problem.

**Documented gaps (acknowledged, not fixed in v0.2).**

- **Build-script env reads.** A `build.rs` that calls
  `env::var("MY_SECRET_KEY")` and emits `cargo:rerun-if-env-changed=MY_SECRET_KEY`
  is invisible to the allowlist. Mitigation: consumers add the env var
  to `additionalCacheEnv`. Long-term fix is to parse `cargo build --build-plan`
  or `cargo metadata`'s declared rerun-if entries; deferred to a
  later work item.
- **Cross-compile-only env vars.** `TARGET_CC`, `TARGET_CXX`,
  `CARGO_TARGET_<TRIPLE>_LINKER`, `CROSS_COMPILE`, `VCPKG_ROOT`
  (Windows) all affect cross-compile output. The plugin's
  cross-compile support is v0.3+ scope; consumers cross-compiling
  today add these via `additionalCacheEnv`. Documented in module 04's
  Open Questions.
- **sccache layered-cache coherence.** `RUSTC_WRAPPER=sccache` is now
  hashed, but if sccache itself returns a hit from a different host
  with a different `RUSTFLAGS` that sccache did not key on, the Nx
  cache reports a hit and the binary returned is sccache's (which may
  be wrong). This is a multi-layer-cache problem outside nxrust's
  surface; consumers running sccache should configure sccache's own
  key correctly. Documented as a known limitation; not a v0.2 fix.

### C. Toolchain hash composition

Toolchain participation is mandatory and non-optional on every
cacheable target (per module 06 D-TC3).

**What's hashed.**

| Element | Source | Cached for session? |
|---------|--------|---------------------|
| `rustc -Vv` full output | Subprocess | Yes — one query per Nx session |
| `cargo -V` full output | Subprocess | Yes — one query per Nx session |
| Resolved toolchain channel | Hierarchy (D-TC2) | Yes — invalidated on any input below |
| `rust-toolchain.toml` content hash | File | Yes — invalidated on file change |
| `RUSTUP_TOOLCHAIN` env var | Process env | No — env always read fresh |
| Per-invocation `--toolchain` flag | Nx argv | No — argv is per-invocation |

**Hierarchy** (already in module 06 D-TC2):

1. Per-invocation: `nx run x:test --toolchain=nightly`
2. `project.json` target option
3. `package.metadata.nxrust.targets.<name>.toolchain`
4. `package.metadata.nxrust.toolchain` (per-crate default)
5. `rust-toolchain.toml` (workspace default)
6. Plain `cargo` (rustup's default)

The resolved channel from this hierarchy is what selects the runtime
command we emit per target.

**Critical: `runtime` inputs are static strings, not parameterised.**
Nx's `{ "runtime": "rustc -Vv" }` runs that literal command against
whatever `rustc` is on PATH, hashes stdout, and caches the result
**per Nx session globally** — not per target. If a single
`nx run-many` invocation exercises two targets with different
resolved toolchains (one crate's `package.metadata.nxrust.toolchain =
"nightly"`, another using the workspace `stable`), a session-global
`rustc -Vv` hashes whichever toolchain answered first. Result: false
hit on the second target.

The fix: emit a **per-target runtime string** that explicitly names
the resolved channel.

```jsonc
{
  "inputs": [
    "rustSources",
    "rustWorkspace",
    "^rustSources",
    { "env": "RUSTFLAGS" },
    { "env": "CARGO_ENCODED_RUSTFLAGS" },
    { "env": "RUSTC" },
    { "env": "RUSTC_WRAPPER" },
    // ... rest of allowlist
    { "env": "RUSTUP_TOOLCHAIN" },
    { "runtime": "rustup run stable rustc -Vv" },  // resolved per target
    { "runtime": "rustup run stable cargo -V" }
  ]
}
```

The channel literal (`stable` here) is baked in at target-emission
time by the target-inference layer, using the resolved toolchain from
the D-TC2 hierarchy. Targets that resolve to `stable` share a runtime
hash; targets that resolve to `nightly` get a distinct hash.

**Bare-rustc fallback when rustup is not in play.** Detection rule:
`resolveToolchain` returns the sentinel `"default"` when no
`rust-toolchain.toml`, no override hierarchy step, and no
`RUSTUP_TOOLCHAIN` env produced a channel literal. In that case the
runtime command emits `rustc -Vv` and `cargo -V` (bare) — Cargo uses
whatever's on PATH, so the runtime hash reflects the same compiler.
Detection lives in `cache-inputs.ts`'s `buildCacheInputs(...)`: if
`resolvedToolchain === "default"` emit bare, else emit
`rustup run <channel> ...`.

**Channel-literal sanitisation.** The resolved channel literal is
embedded into the runtime command string. Cargo / rustup accept
channel names matching `[A-Za-z0-9._+-]+` (e.g. `stable`,
`nightly-2024-01-15-x86_64-unknown-linux-gnu`,
`1.83.0`, custom linked toolchains named via `rustup toolchain link
<name>`). `resolveToolchain` validates the literal against that
character set; anything containing whitespace or shell-meta is a
hard error via module 14 diagnostic
(`nxrust:invalid-toolchain-literal`) rather than being silently
quoted. Shell-meta in a channel literal is a configuration bug, not
a runtime concern.

**`RUSTC` env override is allow-listed (§ B).** When `RUSTC=/path/to/custom`
is set, Cargo runs that binary, but our `rustup run <channel> rustc -Vv`
runtime command runs rustup's `rustc`, not `$RUSTC`. The env-key
participation closes that gap when the path changes: changing
`RUSTC=/a` to `RUSTC=/b` busts the cache key.

**Limitation acknowledged: same-path patched `$RUSTC`.** If `$RUSTC`
points at a path that's been *modified in place* (e.g. a CI runner
silently updated `/usr/local/bin/rustc` to a patched build with the
same version string), neither the env hash (path unchanged) nor the
runtime hash (still queries rustup's `rustc`) detects the change.
The cache returns stale. Documented as a known limitation; consumers
running custom-patched compilers in fleets should hash the binary
content via `additionalCacheRuntime` (e.g.
`sha256sum "$RUSTC"`). Module 14 diagnostic surfaces a hint when
`$RUSTC` is set.

**Why `rustc -Vv` not just `rustc --version`.** The verbose form
includes the commit hash and host triple. Two `rustc 1.83.0` builds
from different commits or different hosts produce different artefacts
in some edge cases (nightly, custom toolchains, distro patches). The
verbose form is the safe default.

**Why not hash `clippy --version` separately.** For stable channels,
`clippy` ships with `rustc` and the version moves together. For
nightly, `clippy-preview` lint definitions can change between nightlies
and produce different lint output for the same `rustc` version.
Documented limitation; consumers needing nightly clippy stability add
a custom runtime input via `additionalCacheRuntime` plugin option (see
§ E).

**Performance budget.** Two subprocess calls per **resolved-channel
variant** per Nx session. Most workspaces have one channel — two
subprocess calls total per session. A workspace mixing stable and
nightly pays four calls (rustc + cargo for each channel). On a
5-second `nx affected` run this is noise. On a sub-second `nx show
project`, ~80ms cold on Linux/macOS, 200-400ms on Windows where the
rustup shim adds overhead; document the Windows cost in user-facing
docs.

**Mise / asdf shim trap.** `mise`/`asdf` shims resolve based on the
current working directory's `.tool-versions` / `.mise.toml`. Nx runs
runtime inputs from the Nx workspace root, which may differ from the
project directory if mise pins are per-crate. Recommendation:
consumers using mise/asdf should rely on `rust-toolchain.toml` (which
the design hashes correctly) rather than tool-version files, or
accept that the runtime hash reflects the workspace-root toolchain
not the per-crate one. Documented limitation.

### D. Per-target output rules

The output contract per target the plugin emits or infers:

| Target | `outputs` | `cache` | Rationale |
|--------|-----------|---------|-----------|
| `check` | `[]` | `true` | Exit-code-only; cargo writes incremental metadata to `target/` we don't trust as our output |
| `clippy` | `[]` | `true` | Same; report-output is opt-in (open question) |
| `fmt` | n/a | `false` | Mutates source files; not cacheable |
| `fmt-check` | `[]` | `true` | Exit-code-only |
| `test` | `[]` | `true` | Per v0.1.2 fix; test reports cached when consumer wires them |
| `build` | `{workspaceRoot}/target/{profile}/<binary>` | `true` | **Narrowed from v0.1** — was `{workspaceRoot}/target` (whole dir) |
| `doc` | `{workspaceRoot}/target/doc` | `true` | Doc output is self-contained |
| `run` | n/a | `false` | Side-effectful by definition |
| `release-publish` | n/a | `false` | Side-effectful; publishes to registry |

**Critical change from v0.1.** `build` outputs narrow from
`['{options.target-dir}', '{workspaceRoot}/target']` to per-binary
paths (`{workspaceRoot}/target/{profile}/<binary>` for binary crates;
`{workspaceRoot}/target/{profile}/lib<crate>.{rlib,so,dylib,dll}` for
library crates). Per D-008, this is a minor bump with a CHANGELOG
entry. The narrow form prevents the cross-binary cache pollution that
the v0.1 wide form risks under remote cache.

**Task-option participation in the cache key.** The following target
options are not files or env vars — they're values on the resolved
Nx task — and must contribute to the cache key. Nx hashes a task's
resolved option set by default; we depend on that behaviour and the
plugin's `schema.json` for each executor lists these as the cacheable
options:

| Option | Cacheable | Why it matters |
|--------|-----------|----------------|
| `release` (`true` / `false`) | Yes | Switches debug vs release profile; different artefacts |
| `features` (string list) | Yes | `--features foo,bar` produces a different binary than no features |
| `noDefaultFeatures` (bool) | Yes | Affects which features compile into the artefact |
| `allFeatures` (bool) | Yes | Same |
| `target` (triple string) | Yes | Cross-compilation target triple; different artefact entirely |
| `profile` (named profile) | Yes | Profile literal (`release`, `bench`, custom name) |
| `package` (string) | Yes (per-target literal) | Cargo `-p <pkg>` selector. Always emitted as the crate's cargo package name at target-emission time (inherits the v0.1.1 pin fix); not consumer-overrideable per invocation. Nx hashes the literal as part of the resolved task options |

CI fixture coverage MUST exercise feature-flag and `release`/non-release
permutations on the same source tree to verify the keys actually
differ — § Open questions item 10.

**Profile mapping.** `{profile}` in the output path resolves via the
target's `release` option: `debug` for `release: false`,
`release` for `release: true`, named-profile literal otherwise. The
inference happens at target-emission time, not as a literal `{profile}`
placeholder Nx would interpolate.

**Binary discovery.** `<binary>` resolves via `cargo metadata`'s
package targets — `cargo metadata` lists every `[[bin]]` and the
library crate by name. No glob, no guess.

### E. Implementation surface

The contract lives in code at three layers, with one helper as the
single source of truth so generator-emitted and inferred wiring stay
byte-identical:

1. **`src/utils/cache-inputs.ts`** (new) — exports:
   - `RUST_SOURCES_PATTERNS` and `RUST_WORKSPACE_PATTERNS` (named-input
     bodies registered in `nx.json` by `init`).
   - `CACHE_ENV_ALLOWLIST` (the env list from § B).
   - `buildCacheInputs({ resolvedToolchain, additionalEnv, additionalRuntime }): InputDefinition[]`
     — the one helper every target uses. It returns the full
     `inputs` array: named-input references, env entries, runtime
     entries with the resolved channel baked into the `rustup run
     <channel> ...` string.
   - `buildCacheOutputs({ target, releaseProfile, binaryName }): string[]`
     — the per-target output paths from § D.
2. **`src/utils/target-configs.ts`** — every `*TargetConfig` function
   calls `buildCacheInputs(...)` and `buildCacheOutputs(...)` rather
   than inlining the arrays. v0.1's `target-configs.ts` does not call
   either today; this is the work in CACHE-001 + TOOLCHAIN-002.
3. **`src/graph.ts`'s `createNodesV2`** — when module 03 (target
   inference) lands, the inferred targets call the same helpers.
   Generator-emitted `project.json` and inferred targets are
   **byte-identical** for the same crate by construction — the helper
   is the single source.

**`init` generator merge semantics.**

- On install, `init` merges `rustSources` / `rustWorkspace` into the
  consumer's `nx.json` `namedInputs`.
- If the keys do not exist → write them.
- If the keys exist with the canonical pattern set → no-op.
- If the keys exist with a **different pattern set**, the plugin
  emits a **module 14 diagnostic warning** loudly: the cache
  correctness contract relies on the full set; consumer overrides may
  leave a gap (e.g. forgot `build.rs`). Documented as
  `nxrust:named-inputs-divergence`. The plugin proceeds with the
  consumer's patterns (consumer wins on intent) but the warning is
  authoritative — the contract holds only when the patterns match.

**Plugin option surface** (lives in plugin schema):

| Option | Default | Purpose |
|--------|---------|---------|
| `additionalCacheEnv` | `[]` | Env vars to add to the cache-key allowlist |
| `additionalCacheRuntime` | `[]` | Runtime commands to add (e.g. `clippy --version` for nightly clippy-drift hashing) |
| `clippyReportOutput` | `false` | When `true`, `clippy` outputs `target/clippy/*.json` |
| `narrowBuildOutputs` | `true` | Controls `build` target's output paths only — see note below |

**`narrowBuildOutputs` precise semantics.** This flag controls **only
the `outputs` field** of the `build` target. Setting it to `false`
restores the v0.1 wide-`target/` outputs path. It does **not** affect
inputs, env participation, or runtime hashes — those are unconditional
under the v0.2 contract. Consumers cannot use this flag to "preserve
v0.1 cache entries"; the v0.1 → v0.2 cache key changes by
construction (new inputs/env/runtime hashes), so a cold cache on
upgrade is unconditional regardless of the flag. Deprecation path:
warning in v0.3, removal in v0.4.

### F. Migration from v0.1

v0.1's emitted `project.json` targets carry `cache: true` and
explicit outputs but no `inputs`. The migration path:

1. **Existing v0.1 generator-emitted `project.json`s stay valid.** Nx
   accepts targets without `inputs` (defaults to the project's
   directory). No breakage on upgrade.
2. **Newly emitted targets carry the full `inputs` set** described in
   § A-C. From v0.2.0 onwards, generators write inputs.
3. **Inferred targets** (when module 03 lands) carry the full set
   automatically.
4. **Cache invalidation on upgrade is unconditional.** Adding
   `inputs` and `outputs` changes the Nx cache key by construction.
   This is independent of the `narrowBuildOutputs` flag (§ E) —
   consumers cannot "keep their v0.1 cache" by toggling the flag.
   Every consumer pays a one-time cold cache on the first post-upgrade
   run. This is the correct loss: the v0.1 cache was unsound
   (toolchain unhashed, env unhashed); preserving it would preserve
   the bugs.
5. **CI-fleet impact.** Local developers pay a single cold rebuild
   (minutes to tens of minutes depending on workspace size).
   Distributed CI fleets sharing a remote cache pay the cold loss
   **concurrently across every worker** on the first post-upgrade
   pipeline. For a 20-worker fleet on a 30-minute typical build, the
   first post-upgrade pipeline can take 30-60 minutes wall-clock
   instead of the cached 3-5. Recommendation in CHANGELOG: schedule
   the v0.2 upgrade during a low-traffic window (overnight, weekend),
   or roll out in a single coordinated "all workers cold-start at
   once" pass rather than letting a long tail of half-warm workers
   thrash.

   **S3-backed remote cache surge.** Consumers on S3-backed Nx caches
   (`@nx/azure-cache` on Azure Blob, equivalent S3 patterns) should be
   aware that the post-upgrade cache-population storm produces a burst
   of PUT operations from every worker. S3 partition-level write
   limits can trigger `503 Slow Down` responses under concurrent
   writes from a large fleet. If the consumer's bucket has aggressive
   lifecycle rules or low per-object size caps, recommend either
   raising the concurrency cap of the cache store temporarily, or
   pre-warming the cache from a single worker before fanning out.
   This is operational guidance, not a design blocker.
6. **A migration generator (`migrate-v0.1-to-v0.2`) is out of scope.**
   The CHANGELOG carries the full note; consumers re-run their
   generators or accept the cold cache.

Documented as a CHANGELOG `0.2.0` entry: "Cache contract: every Rust
target now participates `rustSources` / `rustWorkspace` named inputs,
the documented env-var allowlist, and `rustc -Vv` / `cargo -V` runtime
hashes. `build` outputs narrowed from `target/` to per-binary paths.
First run after upgrade is a cold cache by design. See
`docs/cache-and-toolchain.md` for the full contract."

## Trade-offs and Alternatives

### Trade-off 1: env-var allowlist size

- **Smaller allowlist** (e.g. just `RUSTFLAGS`) maximises cache hits
  but risks silent miscompiles when an exotic var changes.
- **Wider allowlist** (the proposed set, 10 vars) catches the common
  build-affecting cases without ballooning the key.
- **Hash-all** is wrong (zero hits across CI runs).

Going with the wider documented set. The 10 vars in § B cover every
common case I can recall hitting. Additions surface via
`additionalCacheEnv`.

### Trade-off 2: `examples/**/*.rs` in `rustSources`

- **Include** — example changes bust the cache, which is conservative
  but slow for `cargo check` workflows where examples don't compile.
- **Exclude** — faster, but `cargo test` may compile examples
  depending on flags. Excluding loses correctness.

Going with include for v0.2. Open question reserved for narrowing per
target (`check` could skip examples) once a consumer hits the slowness.

### Trade-off 3: `runtime` input vs caching `rustc -Vv` ourselves

- **`runtime` input** — Nx handles the caching; one less thing to
  implement; relies on Nx behaviour staying stable.
- **Cache it ourselves** — full control; less Nx-version coupling.

Going with `runtime`. Nx 22.6.5+ supports it; if Nx changes the
semantics we adapt then. Lower implementation surface today.

### Trade-off 4: `narrowBuildOutputs` migration flag

- **Skip the flag** — every consumer narrows on upgrade, simpler code,
  no deprecation cycle to track.
- **Include the flag** — consumers can validate at their own pace;
  deprecation cycle is the cost.

Going with the flag for the v0.2 line, removal in v0.4. Two-line code
cost; eases adoption.

### Alternative considered and rejected: hash `Cargo.lock` only at workspace level

The spec lists `Cargo.lock` in `rustWorkspace` (workspace-wide).
Alternative: hash it per-crate via `^rustSources`. Rejected because
`Cargo.lock` is genuinely workspace-shared in Cargo's model; per-crate
hashing would be wrong (every crate sees the same lockfile).

### Alternative considered and rejected: include `target/` outputs but with content-hash invalidation

`target/` could be cached with a content-hash key that breaks on any
change to the directory. Rejected because `target/` is touched by
every Cargo invocation (timestamps, incremental metadata), so the hash
would change constantly and the cache would be useless. The narrow
per-binary outputs are the right granularity.

## Open Questions

Resolved at promotion time, but with proposed positions:

1. **Clippy JSON report caching.** Open question in module 04 already.
   *Proposed:* opt-in via `clippyReportOutput: true`. Default off
   because most consumers don't consume the JSON; outputs `[]` keeps
   the cache surface minimal.

2. **`build`'s wide-vs-narrow outputs by default.** Open question in
   module 04 already.
   *Proposed:* narrow by default with `narrowBuildOutputs: true` flag
   as escape hatch. Aligns with § D and § F above.

3. **`RUSTFLAGS` env participation always-on.** Open question in
   module 04 already.
   *Proposed:* yes, on by default. Documented in the allowlist; cost
   is nil if consumer doesn't set it; correctness gain is large if
   they do.

4. **`rustup show` proactive call at workspace-load.** Open question in
   module 06.
   *Proposed:* no, defer to task-invocation time. Workspace-load cost
   matters more than the marginal earlier-feedback gain; module 14
   diagnostics catch missing toolchain on first run.

5. **Legacy `rust-toolchain` (no `.toml`) format.** Open question in
   module 06.
   *Proposed:* yes, read both. Mirror rustup's behaviour to avoid
   silent divergence; cost is ~5 lines of fallback.

6. **`RUSTUP_TOOLCHAIN` env participation.** Open question in
   module 06.
   *Proposed:* include in the env allowlist (as proposed in § B). The
   value is the toolchain selector; including the value handles
   "CI sets `RUSTUP_TOOLCHAIN=nightly` but `rust-toolchain.toml` says
   stable" correctly.

7. **Component versions (`rustfmt`, `clippy`, `miri`) on nightly.**
   Module 06 open question.
   *Proposed:* trust `rustc -Vv` for v0.2. Add a documented limitation
   note ("nightly component drift not hashed; consumers needing it can
   add a custom runtime input via plugin option"). Revisit if a real
   miss surfaces.

8. **CI fixture matrix location** (module 04 open question).
   *Proposed:* `e2e/fixtures/` tree as a separate directory hierarchy
   matching the existing v0.1 e2e shape. Each fixture is a tiny Cargo
   workspace; matrix runs them via the existing CI workflow.

9. **Migration of the existing `RUSTFLAGS`-using consumer (Anvil).**
   *Resolved.* Anvil hasn't surfaced a cache-key gap yet. The migration
   plan in § F covers the cold-restart loss; any consumer-specific
   gap is absorbed at work-item drafting time as the trigger fires.
   No standing nxrust-side action.

10. **CI fixture matrix coverage of feature-flag and profile
    permutations.** Resolved by adding the explicit case list at the
    end of § Promotion plan. CACHE-004 promotion gate requires every
    listed case as a red-light-go-green test.

## Promotion plan

Once this design is approved, the modules promote in lockstep on the
next consumer trigger (or as a paired explicit promotion if the user
decides to short-circuit D-007 given the DX-performance ask).

**Work items the design supports drafting (revised after council review).**

The original `CACHE-001` and `TOOLCHAIN-002` both edited
`target-configs.ts`'s function bodies to extend the `inputs` array —
landing them in parallel guarantees merge conflicts. They are
collapsed into one work item; the resolved-channel-aware runtime
emission (formerly TOOLCHAIN-002 alone) requires the parser
(TOOLCHAIN-001) to land first.

| ID | Module | Scope |
|----|--------|-------|
| TOOLCHAIN-001 | 06 | `rust-toolchain.toml` parser (incl. legacy `rust-toolchain` fallback), exposing `resolveToolchain(projectRoot)` returning the channel literal |
| CACHE-001 | 04 | New `src/utils/cache-inputs.ts` helper (named-input refs + env allowlist + per-target `rustup run <channel> rustc -Vv` runtime entries via `resolveToolchain`); apply through all v0.1 emitted targets in `target-configs.ts`; register named inputs in `nx.json` via `init` generator merge with divergence diagnostic |
| CACHE-002 | 04 | Narrow `build` outputs to per-binary paths via `buildCacheOutputs` helper; add `narrowBuildOutputs` escape-hatch flag |
| CACHE-003 | 04 | `additionalCacheEnv` and `additionalCacheRuntime` plugin options; allowlist extensibility surface |
| TOOLCHAIN-002 | 06 | Resolved-channel hierarchy (D-TC2): per-invocation flag → `project.json` → `package.metadata.nxrust.targets.<name>` → `package.metadata.nxrust` → `rust-toolchain.toml` → rustup default. Feeds into `resolveToolchain` from TOOLCHAIN-001 |
| CACHE-004 | 04 | CI fixture matrix in `e2e/fixtures/` covering: feature-flag permutations, `release` vs debug, toolchain channel swap, env-var change, per-crate `rust-toolchain.toml` |
| TOOLCHAIN-003 | 06 | Diagnostic surface (cross-link to module 14): missing toolchain → `rustup install`; missing target → `rustup target add` |

**Promotion order** (trigger-driven per D-007, but the dependency
graph is binding):

1. **TOOLCHAIN-001** — `rust-toolchain.toml` parser (incl. legacy
   `rust-toolchain`). Exposes the file-only branch of
   `resolveToolchain`.
2. **TOOLCHAIN-002** — the full D-TC2 hierarchy: per-invocation flag
   → `project.json` → `package.metadata.nxrust.targets.<name>` →
   `package.metadata.nxrust` → `rust-toolchain.toml` → rustup default.
   Extends `resolveToolchain` to the full hierarchy.
   **Required before CACHE-001.** If CACHE-001 ships against
   TOOLCHAIN-001 alone, per-target `package.metadata.nxrust.toolchain`
   overrides produce the wrong channel literal in the baked runtime
   string (the file-only parse ignores higher-priority overrides) —
   silent correctness exposure during the interim window.
3. **CACHE-001** — applies `cache-inputs.ts` across
   `target-configs.ts`, registers named inputs in `nx.json` via
   `init` generator merge with divergence diagnostic. Cache key is
   now correct on inputs + env + per-target runtime.
4. **CACHE-002** — narrow `build` outputs via `buildCacheOutputs`
   helper. Minor bump per D-008.
5. **CACHE-003** — env / runtime extensibility surface
   (`additionalCacheEnv`, `additionalCacheRuntime`).
6. **CACHE-004 + TOOLCHAIN-003** — fixtures + diagnostics; can land
   in parallel; they touch different surfaces.

The CI fixture matrix (CACHE-004) MUST include at least these failure
cases as red-light-go-green tests:
- Identical sources, `release: true` vs `false` → keys must differ.
- Identical sources, `features: ["foo"]` vs `features: []` → keys
  must differ.
- Identical sources, workspace `rust-toolchain.toml` swapped from
  `stable` to `nightly` → keys must differ on every Rust target.
- Identical sources, per-crate `rust-toolchain.toml` added in one
  crate only → keys must differ for that crate, must NOT differ for
  the others.
- Identical sources, `RUSTC=/path/to/custom` set vs unset → keys
  must differ.
- Identical sources, unrelated CI env var (`GITHUB_RUN_ID`) changed →
  keys must NOT differ.

## Review checklist for Architecture Council

- [ ] Named-input set covers the files in spec §6.4 plus the additions
      this design makes explicit (per-project `rust-toolchain.toml` /
      legacy `rust-toolchain` / `.cargo/config.toml`), and the
      deliberately-excluded set in § A is justified.
- [ ] Env-var allowlist covers every common build-affecting var without
      ballooning the key.
- [ ] Toolchain hash composition is correct: `rustc -Vv` is enough; no
      false hits, no false misses on toolchain change.
- [ ] Per-target output table is conservative and consistent with v0.1.2's
      `test` narrowing.
- [ ] Migration path from v0.1 is documented and the one-time cold-cache
      cost is acknowledged.
- [ ] Trade-offs section captures the real alternatives, not strawmen.
- [ ] Open questions have proposed positions; no items left as TBD.
- [ ] Promotion plan maps cleanly to module 04 and 06 work items without
      surprise scope.
