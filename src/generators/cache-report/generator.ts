import { createProjectGraphAsync, logger, type ProjectGraph, type Tree } from "@nx/devkit";
import {
  collectCacheReport,
  type CacheProjectReport,
  type CacheTargetReport,
} from "./collect";

export interface CacheReportGeneratorSchema {
  /** Restrict the report to a single project by name. */
  project?: string;
  /** Emit the report as structured JSON instead of the human-readable layout. */
  json?: boolean;
  /** Inject a pre-resolved graph instead of calling Nx (used by tests). */
  projectGraph?: ProjectGraph;
}

/**
 * `nxrust cache-report` — print the effective cache contract per inferred Rust
 * target: `inputs`, `outputs`, the env-allowlist entries pinned into the cache
 * key, and the resolved target-dir root (honouring `CARGO_TARGET_DIR`, D-C7).
 *
 * Read-only — it makes no edits, only reports what `graph.ts` already inferred
 * (CACHE-004), so it is safe in CI. Distinct from `doctor`: `doctor` warns about
 * problems; this is observability — it answers "what is in my cache key and where
 * do artefacts land?" without judging it. (Anvil ISS-004 #7, module 04/14, D-012.)
 *
 * Ships as a generator for the same reason `doctor` does: it is the Nx entry
 * point with project-graph access, and there is no synthetic `rust-workspace`
 * project to host an executor yet (module 12, Proposed).
 */
export default async function cacheReportGenerator(
  _tree: Tree,
  options: CacheReportGeneratorSchema = {},
): Promise<void> {
  const graph = options.projectGraph ?? (await createProjectGraphAsync());

  const reports = collectCacheReport(graph, { project: options.project });

  if (options.json) {
    logger.info(JSON.stringify(reports, null, 2));
    return;
  }

  if (reports.length === 0) {
    const scope = options.project ? ` for project \`${options.project}\`` : "";
    logger.info(`[nxrust] cache-report: no inferred Rust crates found${scope}.`);
    return;
  }

  for (const line of formatReport(reports)) logger.info(line);
}

/** Render the report as a flat list of lines for `logger.info`. */
export function formatReport(reports: CacheProjectReport[]): string[] {
  const lines: string[] = [];
  for (const report of reports) {
    lines.push(`[nxrust] cache-report: ${report.project} (${report.root})`);
    lines.push(`  target-dir: ${report.targetDirRoot}`);
    if (report.targets.length === 0) {
      lines.push("  (no nxrust targets)");
      continue;
    }
    for (const target of report.targets) lines.push(...formatTarget(target));
  }
  return lines;
}

function formatTarget(target: CacheTargetReport): string[] {
  const cacheable = target.cache ? "cacheable" : "not cached";
  const lines = [`  ${target.target} [${cacheable}] (${target.executor})`];
  lines.push(`    inputs: ${list(target.inputs)}`);
  lines.push(`    outputs: ${list(target.outputs)}`);
  lines.push(`    env allowlist: ${list(target.envAllowlist)}`);
  return lines;
}

function list(values: string[]): string {
  return values.length === 0 ? "(none)" : values.join(", ");
}
