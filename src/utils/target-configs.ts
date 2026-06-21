import type { TargetConfiguration } from "@nx/devkit";
import {
  buildCacheInputs,
  buildCacheOutputs,
  type BuildCacheInputsOptions,
  type BuildCacheOutputsOptions,
} from "./cache-inputs";

/**
 * Pre-fabricated `TargetConfiguration` blobs so generators don't duplicate
 * the executor + cache + outputs wiring. Each accepts optional option
 * overrides that get merged into the target's `options`.
 *
 * Only `build` actually produces binary artefacts we want to cache.
 * `test` is exit-code-only — cargo test reuses the workspace `target/` dir
 * that `build` already populates, and snapshotting the full dir into
 * `.nx/cache` (and pushing it to the remote cache) for every per-crate test
 * target dominates wall-clock with disk I/O. `check`, `clippy`, and
 * `fmt-check` are exit-code-only for the same reason.
 */

type AnyOpts = Record<string, unknown>;

type CacheOpts = BuildCacheInputsOptions;
type BuildOutputOpts = Omit<BuildCacheOutputsOptions, "target">;

export function buildTargetConfig(
  options: AnyOpts = {},
  cache: CacheOpts = {},
  outputs: BuildOutputOpts = {},
): TargetConfiguration {
  // A custom target triple (`<root>/<triple>/<profile>/…`) or custom profile
  // (`<root>/<profile-name>/…`) reshapes the artefact path, which the narrow
  // `<root>/{debug,release}/<artefact>` rule cannot express — those fall back
  // to the wide escape hatch. A relocated target *dir* only moves the root, so
  // it stays narrowable (D-C7): root the narrow outputs at `{options.target-dir}`
  // (Nx interpolates the option value), overriding any env-derived root.
  const structureChanged = Boolean(options.target || options.profile);
  const targetDirRoot = options["target-dir"]
    ? "{options.target-dir}"
    : outputs.targetDirRoot;
  return {
    executor: "@eddacraft/nxrust:build",
    cache: true,
    inputs: buildCacheInputs(cache),
    outputs: buildCacheOutputs({
      target: "build",
      ...outputs,
      targetDirRoot,
      narrowBuildOutputs: structureChanged ? false : outputs.narrowBuildOutputs,
    }),
    options,
    configurations: {
      production: { release: true },
    },
  };
}

export function checkTargetConfig(
  options: AnyOpts = {},
  cache: CacheOpts = {},
): TargetConfiguration {
  return {
    executor: "@eddacraft/nxrust:check",
    cache: true,
    inputs: buildCacheInputs(cache),
    outputs: [],
    options,
  };
}

export function clippyTargetConfig(
  options: AnyOpts = {},
  cache: CacheOpts = {},
): TargetConfiguration {
  return {
    executor: "@eddacraft/nxrust:clippy",
    cache: true,
    inputs: buildCacheInputs(cache),
    outputs: [],
    options,
  };
}

/**
 * Reformatting target — rewrites source files in place, so it is NOT safely
 * cacheable. Pair with `fmtCheckTargetConfig` for CI lint runs.
 */
export function fmtTargetConfig(options: AnyOpts = {}): TargetConfiguration {
  return {
    executor: "@eddacraft/nxrust:fmt",
    options,
  };
}

/**
 * Lint-only formatter target — runs `cargo fmt --check`, safe to cache by
 * exit code. Use this in `nx run-many --target=fmt-check` CI gates.
 */
export function fmtCheckTargetConfig(
  options: AnyOpts = {},
  cache: CacheOpts = {},
): TargetConfiguration {
  return {
    executor: "@eddacraft/nxrust:fmt",
    cache: true,
    inputs: buildCacheInputs(cache),
    outputs: [],
    options: { check: true, ...options },
  };
}

export function testTargetConfig(
  options: AnyOpts = {},
  cache: CacheOpts = {},
): TargetConfiguration {
  return {
    executor: "@eddacraft/nxrust:test",
    cache: true,
    inputs: buildCacheInputs(cache),
    outputs: [],
    options,
    configurations: {
      production: { release: true },
    },
  };
}

export function runTargetConfig(options: AnyOpts = {}): TargetConfiguration {
  return {
    executor: "@eddacraft/nxrust:run",
    options,
    configurations: {
      production: { release: true },
    },
  };
}
