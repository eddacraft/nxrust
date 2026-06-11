# APS Loop Journal

One entry per loop cycle. Resume point for interrupted runs; audit trail
for the user. See `.claude/skills/fable5-aps-loop` for the cycle format.

## Cycle 1 — 2026-06-10

- Item: none Ready — cycle ran as reconcile/evolve only
- Outcome: replanned (reconciliation; no implementation work existed)
  - Session-start item list was stale: GRAPH-001 (PR #22) and WN-001
    (PR #21) are both merged and released in `@eddacraft/nxrust@0.2.0`
    (tag `v0.2.0`, commit `b8d7f4b`). Verified via git log and module
    files.
  - ISS-003 fix (`release:dry-run` → `npm pack --dry-run`) was sitting
    uncommitted in the tree; verified working (`pnpm release:dry-run`
    lists 80 files / 40.2 kB, writes no tarball). Landed as `3609a3d`
    (committed by the scheduled-tasks automation mid-cycle; content
    verified against the ISS-003 record).
  - GitHub issue #23 (ISS-002) confirmed already closed.
- Plan changes:
  - GRAPH-001 status Merged → Released (0.2.0) in module 02.
  - Module 02 status In Progress → Proposed (only promoted item shipped;
    remaining items stay Proposed per D-007).
  - Index Modules table: rows 02 and 10 updated to "released 0.2.0".
  - New lesson: `lessons/verify-deps-before-diagnosing-regressions.md`
    (from ISS-002).
- Checkpoints raised: none
- Next: stop — no Ready items and no open consumer asks (GitHub issue
  tracker has zero open issues). Per D-007, every remaining item across
  modules 02–16 stays Proposed until a real downstream ask promotes it.
  The plan explicitly contains no justifiable next slice without a
  consumer trigger.

## Cycle 2 — 2026-06-10

- Item: none executed — replan cycle. Plan owner declared consumer
  demand for the fully functioning adapter; the D-007 trigger is met
  plan-wide.
- Outcome: replanned
  - New index decision **D-010** records the demand event and converts
    promotion from ask-gated to dependency/roadmap-ordered (v0.2 →
    v1.0), one Ready slice at a time.
  - Module 03 (target-inference) promoted Proposed → Ready: all stated
    dependencies have shipped (GRAPH-001 parser released in 0.2.0;
    module 04 named inputs Complete). **TARGETS-001** (inferred default
    target set + `fmt`/`fmt-check` split) drafted and Ready;
    **TARGETS-002** (metadata target overrides) drafted Proposed,
    next in line.
  - Index Modules table, promotion-rule note, and the
    speculative-builds risk row updated to reflect D-010.
  - Modules deliberately NOT promoted yet: 02's hardening items (no
    specific failing input on record), 13 (needs 02's dep-kind/feature
    edge metadata first), 14 (cross-cutting; diagnostic codes land with
    the features that need them), 06 (both drafted items Complete;
    remaining surface — `rustc -Vv` session caching, `RUSTUP_TOOLCHAIN`
    — reassess after 03 lands).
- Checkpoints raised: none
- Next: run `fable5-dev-workflow` on TARGETS-001.

## Cycle 3 — 2026-06-11

- Item: TARGETS-001 (03-target-inference)
- Outcome: complete — PR #24 squash-merged as `66a0fa2`
  - Code: inferred `lint` target as an exact alias of `clippy` (D-T4);
    contract tests lock the full inferred default target set, the
    `fmt`/`fmt-check` cache split, no `dependsOn` on `build`/`test`,
    and inference determinism; e2e asserts the exact target set via
    `nx show project smoke --json`; README inferred-targets table;
    CHANGELOG § Unreleased (minor per D-008 — not yet released to npm).
  - Review: Copilot flagged the e2e's subset assertion (extras passed
    silently) — valid; fixed to exact-set equality in `5c57f72`,
    thread resolved.
  - Merge friction: a misconfigured repo ruleset (branch-name pattern
    applying to `main`) blocked all merges; user removed it. Remaining
    ruleset requires PRs + resolved threads on `main`, so direct
    pushes of APS bookkeeping no longer work — bookkeeping now goes
    via PR too.
- Plan changes: TARGETS-001 → Complete; TARGETS-002 → Ready (next
  slice per D-010); module 03 → In Progress; index table updated.
- Lesson: the feature branch was forked from local main carrying
  unpushed docs(aps) commits, so the squash-merge silently bundled
  APS bookkeeping into the feature PR (gate-6 violation) and the
  local main rebase conflicted afterwards. Branch from `origin/main`
  (or land bookkeeping first) when main carries unpushed commits.
- Next: TARGETS-002 is Ready — metadata target-option overrides.

## Cycle 4 — 2026-06-11

- Item: TARGETS-002 (03-target-inference)
- Outcome: complete — PR #26 squash-merged as `cef81ff`
  - Code: `[package.metadata.nxrust.targets.<name>]` tables feed
    inferred target options (13 new contract tests; 171/171 green;
    e2e asserts the metadata default end-to-end). A metadata
    `toolchain` feeds both the executor option and the cache runtime
    input via TOOLCHAIN-002's hierarchy — passing it through as a
    plain option would have let toolchain updates slip past the cache
    key (D-TC3). Guard rails: `package` pin not overridable (D-T3),
    `check` stripped from `fmt-check`, `lint` follows the `clippy`
    table (D-T4), malformed/unknown entries warn-and-ignore.
  - Process: branched from `origin/main` (cycle-3 lesson applied — no
    bookkeeping bundling this time); merge was CLEAN with no review
    threads; no friction.
- Plan changes: TARGETS-002 → Complete; module 03 → Proposed (both
  promoted items shipped; further items promote per D-010); index
  table updated.
- Checkpoints raised: none
- Next: suggest a **0.3.0 release** — two consumer-visible minors'
  worth of target-inference work (lint alias, metadata overrides)
  sits in CHANGELOG § Unreleased. After release, the next D-010 slice
  candidates are module 03's remainder (plugin-option target-name
  coverage, generator `project.json` emission opt-out) or module 02
  hardening; pick at next planning pass.
