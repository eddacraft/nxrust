Sync `node_modules` to the lockfile (`pnpm install --frozen-lockfile`) before treating a local-only test failure as a code regression.

ISS-002 (2026-06) burned a debugging cycle on seven "failing" cache-invalidation
tests in `src/graph.spec.ts`: the tree had `@nx/devkit 22.6.5` installed while
`pnpm-lock.yaml` pinned `22.7.5`. CI was green the whole time because it
installs `--frozen-lockfile`. A "reproduced on clean HEAD" check is worthless
if the reproduction reuses the same stale `node_modules` — clean checkout must
mean clean deps too.

Rule for future cycles: when local tests fail but CI is green, the first
hypothesis is environment drift, not code. Reinstall from the lockfile and
re-run before opening an issue or drafting a work item.
