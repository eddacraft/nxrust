# Issues & Questions

Development-time discoveries during APS execution. See `aps-rules.md`
§ "Issues & Questions Tracker" for the logging convention.

## Issues

### ISS-001: Cross-language `^build` inheritance amplifies cargo lock contention

| Field           | Value                                              |
| --------------- | -------------------------------------------------- |
| Status          | Resolved                                           |
| Discovered      | 2026-05-20                                         |
| Severity        | High                                               |
| Source          | Anvil consumer workspace (eddacraft/anvil-001)     |
| Related modules | 10-wasm-napi, 14-diagnostics, 16-adoption-and-docs |

A mixed TS+Rust Nx workspace where JS `package.json`s reference a sibling
napi-rs crate inherits Nx's workspace-default `test.dependsOn: ["^build"]`
across the cross-language edge. The cross-language edge is created by
`@nx/js` auto-deps (it follows the napi-rs crate reference in the JS
`package.json`); nxrust does not itself declare the edge today.

Result: every JS `test` task transitively pulls a cargo build of every
referenced Rust crate. Concurrent `nx run-many` invocations then serialise
on the workspace `target/` lock.

**Empirical reference.** eddacraft/anvil-001 PR #1729 measured a 46×
speedup on `pnpm test` after splitting the consumer-side script into
`test:js && test:rust` at the entry point: 40m03s → 31-52s. The actual
useful work was ~52s; the rest was lock-serialised cargo builds.

**Risk to nxrust:** the only place nxrust currently constructs a
cross-language edge is `add-wasm-reference` (module 10). The generator
does not pin a `dependsOn` shape on the JS side. Whichever shape the first
promotion settles on becomes the precedent for every downstream adopter,
and `^build` is the natural Nx default. If we ratify that default, every
adopter with a workspace-level `^build` test dependency inherits the
40-minute failure mode.

**Required actions** (tracked via promotion of the listed work items):

1. Module 10 — pin the `add-wasm-reference` `dependsOn` contract as
   empty-by-default with an explicit opt-in flag for the cases where the
   JS build genuinely imports the Rust artefact at TS build time.
2. Module 16 — publish a recipe at `docs/recipes/javascript-rust-test-seams.md`
   so adopters who already inherit the failure mode (e.g. via `@nx/js`
   auto-deps) can find the script-split workaround.
3. Module 14 — optional `nxrust doctor` diagnostic that warns when it
   detects a cross-language graph edge inheriting workspace `^build`.
   Lower priority than 1 and 2.

### ISS-002: `graph.spec.ts` cache-invalidation suite failing on `main`

| Field           | Value                                                                |
| --------------- | -------------------------------------------------------------------- |
| Status          | Resolved — not a regression (stale local deps)                       |
| Discovered      | 2026-06-08                                                           |
| Resolved        | 2026-06-10                                                           |
| Severity        | High → none (environment artifact)                                   |
| Source          | `pnpm test` on `main` (reproduced on clean HEAD)                     |
| Related modules | 02-workspace-inference-and-graph                                     |
| Tracked         | [eddacraft/nxrust#23](https://github.com/eddacraft/nxrust/issues/23) |

Seven tests under `src/graph.spec.ts > graph cache invalidation` fail on
`main` independently of any feature branch. The `cargo metadata` cache is not
being reused: a test that expects one `cargo metadata` invocation observes 13
(`expected "vi.fn()" to be called 1 times, but got 13 times`). The mtime-keyed
`Cargo.lock` cache in `graph.ts` appears to no longer dedupe across
`createNodesV2` calls.

Bisect candidates: `4b98e3b fix(deps): upgrade nx to 22.7.5` (devkit graph
API drift — a known risk in the index risk table) or `07c12d3 Potential fix
for pull request finding`. Not introduced by the WN-001 branch — verified by
stashing all WN-001 changes and re-running the suite on clean HEAD.

**Resolution (2026-06-10).** Root cause is **stale local `node_modules`, not a
code regression.** The working tree had nx/`@nx/devkit` `22.6.5` installed
while `pnpm-lock.yaml` pins `22.7.5` (the `4b98e3b` upgrade). Under the old
`22.6.5` devkit the mtime-keyed cache did not dedupe across `createNodesV2`
calls (13 invocations vs 1); a `pnpm install --frozen-lockfile` to the locked
`22.7.5` makes all 152 tests pass. CI was always green because
`--frozen-lockfile` installs `22.7.5` there. The earlier "reproduced on clean
HEAD" reproduction was done with the same stale `node_modules`, not clean deps.
No `graph.ts` change required. Follow-up: close nxrust#23 as a stale-deps false
alarm; no work item needed under module 02.

### ISS-003: `release:dry-run` script broken on pnpm 10.x

| Field      | Value                                            |
| ---------- | ------------------------------------------------ |
| Status     | Resolved                                         |
| Discovered | 2026-06-10                                       |
| Resolved   | 2026-06-10                                       |
| Severity   | Low (release tooling)                            |
| Source     | `pnpm release:dry-run` during 0.2.0 release prep |

`release:dry-run` ran `pnpm pack --dry-run`, but pnpm 10.x removed the
`--dry-run` flag from `pnpm pack` (`ERROR Unknown option: 'dry-run'`), so the
release-validation script errored out. Fixed by switching to
`npm pack --dry-run`, which lists publish contents without writing a tarball
and is package-manager-version-stable. Verified: lists 80 files / 40.2 kB,
creates no `.tgz`.

### ISS-004: Anvil consumer wishlist — upstream feature demand

| Field           | Value                                          |
| --------------- | ---------------------------------------------- |
| Status          | Open — all 7 promoted to Ready (D-011, D-012)  |
| Discovered      | 2026-06-21                                     |
| Severity        | n/a (demand intake, not a defect)              |
| Source          | Anvil (eddacraft/anvil), downstream consumer   |
| Related modules | 04, 06, 10, 12, 13, 14                         |

Anvil — the downstream consumer that drives nxrust's roadmap under D-010 —
was asked "what do you wish nxrust could do for you?" and returned seven
concrete asks. This is the D-010 consumer-demand record; the three
Anvil-prioritised items are promoted to Ready per D-011.

1. **Relocation-aware build output caching** (Anvil's #1; tracks Anvil
   DEVENV-003) → module 04. Make narrow build outputs follow a relocated
   `CARGO_TARGET_DIR` / `--target-dir` so local worktrees on a relocated
   target dir get cache **reuse**, not safe misses. Today a relocated
   target-dir forces the wide-output escape hatch (D-C6), and env-var
   relocation isn't seen at all. **Promoted → CACHE-004 (Ready); the first
   build slice (D-011).**
2. **`nxrust doctor`** (Anvil's #2; Anvil ADR-049 waits on it) → module 14.
   Checks: detect JS projects pulling Rust `^build` into `test` (ISS-001);
   explain why a crate is affected; warn when `CARGO_TARGET_DIR`,
   `Cargo.lock`, `rust-toolchain.toml`, or workspace metadata make cache
   behaviour surprising; validate NAPI/WASM edge shape. **Promoted → Ready
   (D-011).**
3. **JS/Rust seam generators** (Anvil's #3) → module 10. `add-napi` /
   `add-wasm-reference` encode the D-009 import-time-vs-runtime distinction
   (WASM bundled at build time may need `^build`; NAPI loaded at runtime
   should not force JS tests through Rust builds). Contract already ratified
   (D-009 / D-WN4); the seam helper shipped (WN-001, 0.2.0); the generators
   that apply it are the next slice. **Promoted → Ready (D-011).**
4. `nxrust explain affected <crate>` → module 13. Show cargo path deps,
   workspace deps, lockfile impact, and why Nx marked a crate/project
   affected. **Promoted → AFFECTED-001 (Ready, D-012); not yet built.**
   Scope: a read-only generator that, for a given crate, reports its cargo
   path/workspace dependency edges and the lockfile/manifest inputs that
   would mark it affected — explaining Nx's affected verdict.
5. `nxrust list` / metadata target → module 12. First-class crate / package
   / target / workspace-membership reporting, instead of Anvil shelling
   `nx show projects --withTarget=check`. **Promoted → LIST-001 (Ready,
   D-012); not yet built.** Scope: a read-only crate/package/target/
   workspace-membership listing surface (human + `--json`) so consumers stop
   shelling `nx show projects --withTarget=check`.
6. First-class "Rust crate backing a JS package" → modules 10/13. Partly a
   **defect**: Anvil's audit found an Nx test target invoking
   `@eddacraft/nxrust:test` for a NAPI package instead of the package's own
   scripts. **Promoted → WN-003 (Ready, D-012); not yet built.** Scope:
   model a Rust crate that backs a JS package as a first-class relationship,
   and fix the inference defect so a NAPI package's `test` runs the package's
   own scripts, not `@eddacraft/nxrust:test`; investigate alongside #3.
7. Cache observability — print the effective inputs, outputs, env allowlist,
   and target-dir per Rust target → modules 04/14. A natural sibling of
   `nxrust doctor` (#2). **Promoted → CACHE-OBS-001 (Ready, D-012); BUILT
   (unreleased) as the first slice of items 4-7.** Scope: a read-only
   `cache-report` generator that prints each inferred Rust target's effective
   `inputs`, `outputs`, the `CACHE_ENV_ALLOWLIST` entries pinned into the key,
   and the resolved target-dir (honouring `CARGO_TARGET_DIR` via the shared
   `resolveTargetDirRoot` rule), reading inference straight off the graph
   nodes. Separate from `doctor` (problems) — this is observability.

Anvil's stated top three: #1, #2, #3. Items 4-7 promoted under D-012; #7
(cache observability) built first as the smallest, lowest-risk slice.

## Questions

_(none yet)_
