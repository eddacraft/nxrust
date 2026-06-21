import type { ProjectGraph, ProjectGraphProjectNode, TargetConfiguration } from "@nx/devkit";
import { CACHE_ENV_ALLOWLIST } from "../../utils/cache-inputs";
import { resolveTargetDirRoot } from "../../utils/target-dir";

/**
 * Pure cache-observability collector. Kept separate from the generator (which
 * wires `createProjectGraphAsync` + logging) so the report shape is unit-testable
 * against synthetic graphs without a real workspace.
 *
 * It reads the effective `inputs`/`outputs` *straight off the graph nodes' target
 * configs* — `graph.ts` already computed inference (CACHE-004) — and never
 * recomputes it. The only thing it derives is the resolved target-dir root, which
 * it borrows from the same `resolveTargetDirRoot` rule the inference path uses, so
 * the report and the real cache key never drift. (Anvil ISS-004 #7, D-012.)
 */

const NXRUST_EXECUTOR_PREFIX = "@eddacraft/nxrust:";

/** A cache input that pins an environment variable into the cache key. */
type EnvInput = { env: string };

function isEnvInput(input: unknown): input is EnvInput {
  return typeof input === "object" && input !== null && typeof (input as EnvInput).env === "string";
}

/** A project is an inferred Rust crate when any target runs an nxrust executor. */
function isRustProject(node: ProjectGraphProjectNode | undefined): boolean {
  const targets = node?.data?.targets ?? {};
  return Object.values(targets).some(
    (target) =>
      typeof target?.executor === "string" && target.executor.startsWith(NXRUST_EXECUTOR_PREFIX),
  );
}

/** The cache-relevant facts for a single inferred Rust target. */
export interface CacheTargetReport {
  /** Target name (e.g. `build`, `check`, `test`). */
  target: string;
  executor: string;
  /** Whether Nx caches this target. Non-cacheable targets (`fmt`, `run`) report `false`. */
  cache: boolean;
  /** Effective inputs straight off the graph node (env entries rendered as `env:NAME`). */
  inputs: string[];
  /** Effective outputs straight off the graph node. */
  outputs: string[];
  /** The subset of {@link CACHE_ENV_ALLOWLIST} actually pinned into this target's key. */
  envAllowlist: string[];
}

/** The cache-observability report for a single inferred Rust crate. */
export interface CacheProjectReport {
  project: string;
  root: string;
  /** Resolved target-dir root honouring `CARGO_TARGET_DIR` (D-C7); the same rule inference uses. */
  targetDirRoot: string;
  targets: CacheTargetReport[];
}

export interface CollectCacheReportOptions {
  /** Restrict the report to a single project by name. */
  project?: string;
  /** Workspace root for target-dir resolution. Defaults to `process.cwd()`. */
  workspaceRoot?: string;
  /** Environment for `CARGO_TARGET_DIR` resolution. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** Render a single cache input into a flat, human-readable string. */
function renderInput(input: unknown): string {
  if (isEnvInput(input)) return `env:${input.env}`;
  if (typeof input === "object" && input !== null) {
    const runtime = (input as { runtime?: unknown }).runtime;
    if (typeof runtime === "string") return `runtime:${runtime}`;
    return JSON.stringify(input);
  }
  return String(input);
}

function targetReport(name: string, target: TargetConfiguration): CacheTargetReport {
  const rawInputs = (target.inputs ?? []) as unknown[];
  const envAllowlist = rawInputs
    .filter(isEnvInput)
    .map((input) => input.env)
    .filter((env) => CACHE_ENV_ALLOWLIST.includes(env));

  return {
    target: name,
    executor: target.executor ?? "",
    cache: target.cache === true,
    inputs: rawInputs.map(renderInput),
    outputs: (target.outputs ?? []) as string[],
    envAllowlist,
  };
}

/**
 * Collect the cache-observability report for every inferred Rust crate in the
 * graph (or a single `project` when filtered). Targets are reported in a stable
 * alphabetical order for deterministic output. Returns an empty array when no
 * inferred Rust crate matches.
 */
export function collectCacheReport(
  graph: ProjectGraph,
  options: CollectCacheReportOptions = {},
): CacheProjectReport[] {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const targetDirRoot = resolveTargetDirRoot(workspaceRoot, options.env ?? process.env);

  const reports: CacheProjectReport[] = [];
  for (const [name, node] of Object.entries(graph.nodes)) {
    if (options.project && name !== options.project) continue;
    if (!isRustProject(node)) continue;

    const targets = node.data?.targets ?? {};
    const targetReports = Object.keys(targets)
      .filter((targetName) => {
        const executor = targets[targetName]?.executor;
        return typeof executor === "string" && executor.startsWith(NXRUST_EXECUTOR_PREFIX);
      })
      .sort()
      .map((targetName) => targetReport(targetName, targets[targetName]));

    reports.push({
      project: name,
      root: node.data?.root ?? "",
      targetDirRoot,
      targets: targetReports,
    });
  }

  return reports.sort((a, b) => a.project.localeCompare(b.project));
}
