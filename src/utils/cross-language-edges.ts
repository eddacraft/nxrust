import type { ProjectConfiguration, TargetConfiguration, TargetDependencyConfig } from "@nx/devkit";

/**
 * Cross-language test-seam contract (decision D-WN4 / index D-009).
 *
 * In a mixed TS+Rust Nx workspace a JS project that depends on a sibling Rust
 * crate inherits the workspace-default `test.dependsOn: ["^build"]`. That edge
 * makes every JS `test` task pull a transitive cargo build of the referenced
 * crate; concurrent `nx run-many` invocations then serialise on the workspace
 * `target/` lock. anvil-001#1729 measured this as 40m03s → 31-52s once the
 * `^build` edge was severed — a 46× speedup (ISS-001).
 *
 * These helpers produce the JS-side override that severs `^build` from the
 * `test` target. The override is *explicit* — Nx only lets a project override a
 * workspace `targetDefaults` entry by declaring its own `dependsOn`, so the
 * result is always an explicit array (possibly empty), never `undefined`.
 *
 * Future `add-wasm-reference` / `add-napi` generators (module 10, still
 * Proposed) consume this helper rather than re-deriving the shape; until then a
 * consumer wiring a cross-language edge by hand can call it directly.
 */

export interface CrossLanguageTestSeamOptions {
  /**
   * Retain the inherited `^build` dependency. Only correct when the JS build
   * genuinely imports the Rust artefact at TS build time — WASM bundled into
   * webpack/Vite, a generated `.d.ts` consumed by `tsc`, or an embedded blob.
   * Defaults to `false` per D-WN4: the common case is a runtime-only edge where
   * the cargo build must not gate JS tests.
   */
  consumesArtifactAtBuildTime?: boolean;
}

type DependsOnEntry = string | TargetDependencyConfig;

const INHERITED_BUILD = "^build";

/**
 * True when `entry` is the "build every dependency first" edge — either the
 * `"^build"` string shorthand or its two canonical object long-forms,
 * `{ target: 'build', dependencies: true }` and
 * `{ target: 'build', projects: 'dependencies' }` (`params` is irrelevant to
 * the match and so left unchecked). A same-project `"build"` (no caret) is a
 * self-edge, and a named/array `projects` (e.g. `['my-crate']`) is a specific
 * edge — both are left alone. `'dependencies'` is only Nx's sentinel as a bare
 * string, never inside an array, so no array branch is needed.
 */
export function isInheritedBuildDep(entry: DependsOnEntry): boolean {
  if (typeof entry === "string") return entry === INHERITED_BUILD;
  if (entry.target !== "build") return false;
  return entry.dependencies === true || entry.projects === "dependencies";
}

/**
 * Return a copy of a JS `test` target whose `dependsOn` honours D-WN4.
 *
 * Default: strip every inherited-`^build` entry, leaving an explicit array that
 * overrides the workspace default while preserving any sibling dependencies.
 * With `consumesArtifactAtBuildTime`, keep (and, if absent, add) `^build`.
 * Idempotent under both modes.
 */
export function applyCrossLanguageTestSeam(
  testTarget: TargetConfiguration = {},
  options: CrossLanguageTestSeamOptions = {},
): TargetConfiguration {
  const existing: DependsOnEntry[] = testTarget.dependsOn ?? [];
  const withoutBuild = existing.filter((entry) => !isInheritedBuildDep(entry));

  if (options.consumesArtifactAtBuildTime) {
    // Retain an existing build edge in whatever shape it arrived (don't
    // normalise what we didn't create); only when none is present do we add
    // the `"^build"` string form. So a caller must not assert on a literal
    // `"^build"` token — check semantics, not shape.
    const hadBuild = withoutBuild.length !== existing.length;
    return {
      ...testTarget,
      // Always a fresh array — never alias the caller's `testTarget.dependsOn`,
      // so the returned config honours the "return a copy" contract.
      dependsOn: hadBuild ? [...existing] : [...existing, INHERITED_BUILD],
    };
  }

  return { ...testTarget, dependsOn: withoutBuild };
}

/**
 * Apply {@link applyCrossLanguageTestSeam} to a project's `test` target,
 * returning a new `ProjectConfiguration` (the input is not mutated).
 *
 * When the project has no explicit `test` target — the common case, since
 * `@nx/js` infers it — a partial `{ test: { dependsOn: [] } }` override is
 * materialised so the inherited `^build` is still severed. Nx merges the
 * partial override onto the inferred target.
 */
export function severCrossLanguageTestEdge(
  project: ProjectConfiguration,
  options: CrossLanguageTestSeamOptions = {},
): ProjectConfiguration {
  const test = applyCrossLanguageTestSeam(project.targets?.test, options);
  return {
    ...project,
    targets: { ...project.targets, test },
  };
}
