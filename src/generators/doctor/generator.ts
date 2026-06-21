import { createProjectGraphAsync, logger, type ProjectGraph, type Tree } from "@nx/devkit";
import { formatDiagnostic } from "../../utils/diagnostics";
import { findCrossLanguageBuildSeams } from "./diagnose";

export interface DoctorGeneratorSchema {
  /** Inject a pre-resolved graph instead of calling Nx (used by tests). */
  projectGraph?: ProjectGraph;
}

/**
 * `nxrust doctor` — report nxrust workspace issues that Nx will not surface on
 * its own. First slice (CACHE/DIAG, D-011 Anvil #2): the ISS-001 cross-language
 * `^build` test seam, which silently serialises JS tests on the cargo `target/`
 * lock. Read-only — it makes no edits, only logs structured diagnostics, so it
 * is safe to run in CI as an advisory check.
 *
 * This is a diagnostics surface, not a mutation, but ships as a generator
 * because that is the Nx entry point with project-graph access and no synthetic
 * `rust-workspace` project to host an executor yet (module 12, Proposed).
 */
export default async function doctorGenerator(
  _tree: Tree,
  options: DoctorGeneratorSchema = {},
): Promise<void> {
  const graph = options.projectGraph ?? (await createProjectGraphAsync());

  const seams = findCrossLanguageBuildSeams(graph);
  if (seams.length === 0) {
    logger.info("[nxrust] doctor: no cross-language `^build` test seams detected.");
    return;
  }

  for (const { jsProject, rustCrate } of seams) {
    logger.warn(
      formatDiagnostic({
        severity: "warning",
        what:
          `JS project \`${jsProject}\` inherits \`test.dependsOn: ["^build"]\` across a ` +
          `cross-language edge to Rust crate \`${rustCrate}\`.`,
        why:
          "every JS test will trigger a transitive cargo build and serialise on the " +
          "workspace `target/` lock (ISS-001; anvil-001#1729 measured 40m03s → ~52s once severed).",
        fix:
          "narrow `test.dependsOn` on the JS project (e.g. via `applyCrossLanguageTestSeam`), " +
          "or split scripts at the entry point (`test:js && test:rust`). " +
          "See docs/recipes/javascript-rust-test-seams.md.",
      }),
    );
  }

  logger.warn(
    `[nxrust] doctor: ${seams.length} cross-language \`^build\` test seam(s) found — see above.`,
  );
}
