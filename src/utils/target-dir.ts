import { normalizePath } from "@nx/devkit";
import { isAbsolute, join, relative } from "node:path";
import { DEFAULT_TARGET_DIR_ROOT } from "./cache-inputs";

/**
 * Resolve the Nx output-token root cargo writes build artefacts under when a
 * `CARGO_TARGET_DIR` relocation is in effect. cargo's `--target-dir` option
 * takes precedence and is handled per-target in `target-configs.ts`; here we
 * cover the env var, which the plugin reads at inference time. A dir inside the
 * workspace is expressed workspace-relative so the token stays portable across
 * machines; an external dir uses its absolute path. Returns `undefined` for the
 * default `target/`, so callers fall back to `{workspaceRoot}/target`. See D-C7.
 *
 * Lifted out of `graph.ts` (CACHE-004) so the cache-observability report
 * (`cache-report`) can describe the same resolution rule without duplicating it.
 */
export function resolveEnvTargetDirRoot(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CARGO_TARGET_DIR?.trim();
  if (!raw) return undefined;
  const absRoot = isAbsolute(raw) ? raw : join(workspaceRoot, raw);
  const rel = relative(workspaceRoot, absRoot);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    return `{workspaceRoot}/${normalizePath(rel)}`;
  }
  return normalizePath(absRoot);
}

/**
 * The resolved target-dir root, including the default `target/` fallback. Used
 * for human-facing reporting where the effective root (never `undefined`) is
 * what matters.
 */
export function resolveTargetDirRoot(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveEnvTargetDirRoot(workspaceRoot, env) ?? DEFAULT_TARGET_DIR_ROOT;
}
