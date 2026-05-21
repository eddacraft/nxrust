# Issues & Questions

Development-time discoveries during APS execution. See `aps-rules.md`
§ "Issues & Questions Tracker" for the logging convention.

## Issues

### ISS-001 — Cross-language `^build` inheritance amplifies cargo lock contention

**Logged:** 2026-05-20
**Source:** Anvil consumer workspace (eddacraft/anvil-001)
**Related modules:** 10-wasm-napi, 14-diagnostics, 16-adoption-and-docs

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

## Questions

*(none yet)*
