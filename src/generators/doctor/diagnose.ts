import type { ProjectGraph, ProjectGraphProjectNode } from "@nx/devkit";
import { isInheritedBuildDep } from "../../utils/cross-language-edges";

/**
 * Pure diagnostic analysis over a resolved project graph. Kept separate from the
 * generator (which wires `createProjectGraphAsync` + logging) so the detection
 * rules are unit-testable against synthetic graphs without a real workspace.
 */

const NXRUST_EXECUTOR_PREFIX = "@eddacraft/nxrust:";

/**
 * A JS project whose `test` target inherits the workspace `^build` default
 * across a dependency edge to a Rust crate — the ISS-001 failure mode that
 * serialises JS tests on the cargo `target/` lock.
 */
export interface CrossLanguageBuildSeam {
  jsProject: string;
  rustCrate: string;
}

/** A project is a Rust crate when any of its targets runs an nxrust executor. */
function isRustProject(node: ProjectGraphProjectNode | undefined): boolean {
  const targets = node?.data?.targets ?? {};
  return Object.values(targets).some(
    (target) =>
      typeof target?.executor === "string" && target.executor.startsWith(NXRUST_EXECUTOR_PREFIX),
  );
}

/**
 * Find cross-language `^build` test seams: JS projects whose *merged* `test`
 * target still depends on the inherited `^build` (the workspace default that Nx
 * folds into the graph node) and that depend on at least one Rust crate. The
 * fix is to sever that edge (D-WN4); see {@link applyCrossLanguageTestSeam}.
 *
 * Reads the merged `dependsOn` straight off the graph node, so a project that
 * has already severed the edge (explicit `test.dependsOn` without `^build`) is
 * correctly *not* reported.
 */
export function findCrossLanguageBuildSeams(graph: ProjectGraph): CrossLanguageBuildSeam[] {
  const rustProjects = new Set<string>();
  for (const [name, node] of Object.entries(graph.nodes)) {
    if (isRustProject(node)) rustProjects.add(name);
  }

  const seams: CrossLanguageBuildSeam[] = [];
  for (const [name, node] of Object.entries(graph.nodes)) {
    if (rustProjects.has(name)) continue; // only the JS side of an edge

    const dependsOn = node.data?.targets?.test?.dependsOn ?? [];
    if (!dependsOn.some((entry) => isInheritedBuildDep(entry))) continue;

    const seen = new Set<string>();
    for (const dependency of graph.dependencies[name] ?? []) {
      if (rustProjects.has(dependency.target) && !seen.has(dependency.target)) {
        seen.add(dependency.target);
        seams.push({ jsProject: name, rustCrate: dependency.target });
      }
    }
  }
  return seams;
}
