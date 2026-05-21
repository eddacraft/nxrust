# JavaScript / Rust Test Seams

*A recipe for mixed-stack Nx workspaces where JS/TS projects reference
sibling Rust crates.*

> **Canonical reference.** This document is the authoritative source on
> the cross-language `^build` failure mode and its remediation.
> Ratified upstream as `D-009` in [`plans/index.aps.md`](../../plans/index.aps.md#decisions);
> implementing decision `D-WN4` in
> [`plans/modules/10-wasm-napi.aps.md`](../../plans/modules/10-wasm-napi.aps.md).
> Downstream consumers (Anvil, future adopters) should link here from
> their own decision records rather than maintaining parallel writeups.

## When this recipe applies

You have an Nx workspace with both JS/TS projects and Rust crates.
At least one of the following is true:

- A JS `package.json` declares a dependency on a napi-rs crate's sibling
  JS package (the Rust→JS interop pattern).
- A JS project consumes a `wasm-pack`-built crate via the generated
  `pkg/` directory (the WASM→JS interop pattern).
- Your `nx.json` has a workspace-level
  `targetDefaults.test.dependsOn: ["^build"]` (the Nx default for many
  presets).

If all three line up, you may have already hit the symptom below.

## The symptom

`pnpm test` or `nx run-many -t test` takes far longer than the work
warrants. Real test execution finishes in seconds; the wallclock is
dominated by cargo invocations. Multiple `nx` workers report blocking on
`cargo build`, and the workspace's `target/` directory shows lock
contention if you watch with `lsof` or `fuser`.

Concrete data point: in eddacraft/anvil-001 PR #1729, `pnpm test` was
**40m03s**. After applying the fix below, it ran in **31-52s** — a
**46× speedup**. Direct measurement showed the actual test work was ~52s;
the remaining 39 minutes were lock-serialised cargo builds.

## Why it happens

Three components combine to produce the failure:

1. **The cross-language edge.** `@nx/js`'s automatic dependency
   detection follows the napi-rs / WASM crate reference in the JS
   `package.json` and emits a graph edge from the JS project to the
   Rust crate. The edge is real and correct — the JS package *does*
   depend on the Rust artefact at runtime.

2. **The `^build` test default.** Workspaces with
   `targetDefaults.test.dependsOn: ["^build"]` in `nx.json` apply that
   rule to every project's `test` target, including JS projects. With
   the edge in place, the rule says "before running any JS test, build
   every upstream project" — and the Rust crate is upstream.

3. **Cargo's workspace-level `target/` lock.** Cargo serialises builds
   within a single workspace. Concurrent `cargo build -p A` and
   `cargo build -p B` cannot run in parallel against the same `target/`
   directory; the second invocation blocks on the first. Under
   `nx run-many` with multiple parallel workers, the JS test tasks each
   spawn a cargo build, and the builds queue.

Each piece is reasonable in isolation. The combination is the failure
mode.

## The fix — split scripts at the entry point

The cleanest workaround at the consumer layer is to split the
top-level test script so JS and Rust suites run consecutively, not
concurrently. Each phase gets dedicated cargo / node parallelism without
fighting the other.

```json
// package.json (root)
{
  "scripts": {
    "test": "pnpm test:js && pnpm test:rust",
    "test:js":   "nx run-many -t test --projects=tag:npm:public,tag:npm:private",
    "test:rust": "nx run-many -t test --projects=tag:cargo"
  }
}
```

Tagging conventions:

- **JS/TS side:** `@nx/js` auto-synthesises the `npm:public` and
  `npm:private` tags from each project's `package.json#private` field —
  no `project.json` editing required. `private: true` ⇒ `npm:private`;
  absent or `false` ⇒ `npm:public`. The filter above works against
  whatever your existing JS workspace already has, untouched.
- **Rust side (today):** tag each crate via `project.json`. New crates
  created through nxrust's `crate` / `library` / `binary` generators
  accept a `--tags=cargo[,...]` option and write the tags into the
  emitted `project.json`. Existing crates need a `project.json`
  containing `"tags": ["cargo"]`. This is the current shipped behaviour
  in the v0.1 line.
- **Rust side (planned, module 02):** the nxrust graph plugin will read
  `package.metadata.nxrust.tags = ["cargo"]` from `Cargo.toml` and lift
  the values into the Nx project's `tags` array, so pure Cargo crates
  acquire tags with no `project.json` at all. Tracked under
  [`02-workspace-inference-and-graph`](../../plans/modules/02-workspace-inference-and-graph.aps.md)
  — see the "Tag convention" note. The parser does not exist yet; the
  Cargo-metadata path becomes available when that work promotes. Adopt
  the `project.json` path now and migrate later — the metadata key
  shape is fixed by the planning contract, so prep-writing
  `package.metadata.nxrust.tags = ["cargo"]` in your `Cargo.toml` now
  is safe (currently a no-op; lifted automatically once the parser
  ships).

The split means: JS suite runs first with full Nx parallelism, building
its handful of legitimately-needed Rust artefacts once each; Rust suite
then runs with cargo's own parallelism, with the `target/` directory
already warm from the build phase.

## The fix — pin `test.dependsOn` on the JS side

If you control the JS project's `project.json` (and want to drop the
script split entirely), narrow the `test.dependsOn` so it does not
inherit the workspace `^build` default:

```json
// apps/my-frontend/project.json
{
  "targets": {
    "test": {
      "executor": "@nx/vite:test",
      "dependsOn": []
    }
  }
}
```

The JS test no longer requires the Rust crate to build first. If your
JS code actually imports the Rust artefact at test time (e.g. a
contract test against a NAPI binding), declare just that one edge
explicitly:

```json
"dependsOn": [{ "projects": ["my-rust-crate"], "target": "build" }]
```

This is the per-edge form — far cheaper than the workspace-default
`^build` because it does not transit through the rest of the graph.

## When `^build` IS the right call

Declare `^build` on a cross-language edge only when the JS build
genuinely consumes the Rust artefact at JS build time. The clearest
cases:

- **WASM modules bundled by webpack/Vite/esbuild.** The bundler imports
  the `pkg/` output as a module and inlines it into the JS bundle. No
  `pkg/`, no JS build.
- **Generated TypeScript types from a Rust schema.** The JS `tsc` step
  reads `.d.ts` files emitted by a Rust codegen step. No types, no
  typecheck.
- **Embedded WASM blobs.** A build script reads the WASM file and
  base64-encodes it into a JS bundle.

In every other common case — NAPI `.node` files loaded at `require`
time, CLI binaries invoked at runtime, HTTP services consumed over the
network — the JS build does *not* need the Rust artefact, and `^build`
is the wrong contract.

## The nxrust position

The plugin will not emit `^build` on cross-language edges that its own
generators create. From [10-wasm-napi.aps.md](../../plans/modules/10-wasm-napi.aps.md)
D-WN4:

> Cross-language edges constructed by `add-wasm-reference` and `add-napi`
> default to **empty** `test.dependsOn` on the JS side, explicitly
> overriding any workspace-default `^build`. The generator exposes an
> opt-in flag for cases where the JS build actually consumes the Rust
> artefact at TS build time (e.g. WASM bundled into webpack/Vite).

If your workspace pre-dates that contract — or if the cross-language
edge was created by `@nx/js` auto-deps rather than an nxrust
generator — you are responsible for narrowing the `dependsOn` yourself.
This recipe is the canonical reference.

A future `nxrust doctor` (tracked in
[14-diagnostics.aps.md](../../plans/modules/14-diagnostics.aps.md)) may
warn when it detects this pattern in your graph.

## Verification

After applying the fix:

```bash
# Confirm the cross-language edge no longer pulls a cargo build
nx graph --file=graph.json --focus=my-frontend
jq '.graph.dependencies."my-frontend"' graph.json

# Time the test scripts before and after
time pnpm test:js
time pnpm test:rust

# Optional: confirm cargo target/ lock contention is gone
# Run two test invocations concurrently and watch:
lsof +D target | grep '\.lock$'
```

You should see your JS tests no longer enumerate Rust crates as
upstream `^build` dependencies, and the test wallclock should drop to
the order of the actual work being done.

## References

- ISS-001 in [`plans/issues.md`](../../plans/issues.md) — full risk
  context.
- D-WN4 in [`plans/modules/10-wasm-napi.aps.md`](../../plans/modules/10-wasm-napi.aps.md)
  — the plugin-side contract.
- eddacraft/anvil-001 PR #1729 — the empirical data point: 40m → 52s,
  46× speedup.
- Nx `dependsOn` documentation — [task pipeline configuration](https://nx.dev/concepts/task-pipeline-configuration).
- Cargo workspace `target/` lock behaviour — Cargo intentionally
  serialises builds within a single workspace to keep the artefact
  directory consistent.
