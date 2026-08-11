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
| Status          | Open — 4 Complete on main (pending next minor); 3 Ready unbuilt (D-011, D-012) |
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
   target dir get cache **reuse**, not safe misses. **→ CACHE-004 Complete
   on main (pending next minor). First build slice under D-011.**
2. **`nxrust doctor`** (Anvil's #2; Anvil ADR-049 waits on it) → module 14.
   First slice: detect JS projects pulling Rust `^build` into `test`
   (ISS-001). **→ DIAG-001 Complete on main (pending next minor).** Further
   doctor checks remain deferred (see module 14).
3. **JS/Rust seam generators** (Anvil's #3) → module 10. Seam helper shipped
   (WN-001, 0.2.0); kind-agnostic generator **→ WN-002 Complete on main
   (pending next minor).** Binding-specific `add-napi` / `add-wasm-reference`
   scaffolding stays Proposed.
4. `nxrust explain affected <crate>` → module 13. **→ AFFECTED-001 (Ready,
   D-012); not yet built — next Ready slice after reconciliation 2026-08-10.**
5. `nxrust list` / metadata target → module 12. **→ LIST-001 (Ready, D-012);
   not yet built.**
6. First-class "Rust crate backing a JS package" → modules 10/13. Partly a
   **defect**: NAPI package `test` invoking `@eddacraft/nxrust:test` instead
   of package scripts. **→ WN-003 (Ready, D-012); not yet built.**
7. Cache observability → modules 04/14. **→ CACHE-OBS-001 Complete on main
   (pending next minor); first slice of items 4-7 under D-012.**

Anvil's stated top three: #1, #2, #3 — all Complete on main. Items 4-7
promoted under D-012; #7 built first; next unbuilt Ready is **AFFECTED-001**.
Reconciled 2026-08-10.

## Questions

_(none yet)_
