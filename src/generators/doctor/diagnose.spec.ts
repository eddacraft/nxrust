import type { ProjectGraph, ProjectGraphProjectNode } from "@nx/devkit";
import { describe, expect, it } from "vitest";
import { findCrossLanguageBuildSeams } from "./diagnose";

type Targets = NonNullable<ProjectGraphProjectNode["data"]["targets"]>;

function node(name: string, targets: Targets): ProjectGraphProjectNode {
  return { name, type: "lib", data: { root: `packages/${name}`, targets } };
}

const rustCrate = (name: string): ProjectGraphProjectNode =>
  node(name, {
    build: { executor: "@eddacraft/nxrust:build" },
    test: { executor: "@eddacraft/nxrust:test", dependsOn: ["^build"] },
  });

function graph(
  nodes: ProjectGraphProjectNode[],
  dependencies: Record<string, string[]> = {},
): ProjectGraph {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.name, n])),
    dependencies: Object.fromEntries(
      Object.entries(dependencies).map(([source, targets]) => [
        source,
        targets.map((target) => ({ source, target, type: "static" })),
      ]),
    ),
    externalNodes: {},
  } as unknown as ProjectGraph;
}

describe("findCrossLanguageBuildSeams", () => {
  it("flags a JS project that inherits ^build across an edge to a Rust crate", () => {
    const g = graph(
      [
        node("web", { test: { executor: "@nx/vite:test", dependsOn: ["^build"] } }),
        rustCrate("engine"),
      ],
      { web: ["engine"] },
    );
    expect(findCrossLanguageBuildSeams(g)).toEqual([{ jsProject: "web", rustCrate: "engine" }]);
  });

  it("does not flag a JS project that has severed the ^build edge", () => {
    const g = graph(
      [node("web", { test: { executor: "@nx/vite:test", dependsOn: [] } }), rustCrate("engine")],
      { web: ["engine"] },
    );
    expect(findCrossLanguageBuildSeams(g)).toEqual([]);
  });

  it("does not flag ^build when the dependency is not a Rust crate", () => {
    const g = graph(
      [
        node("web", { test: { executor: "@nx/vite:test", dependsOn: ["^build"] } }),
        node("ui", { test: { executor: "@nx/vite:test" } }),
      ],
      { web: ["ui"] },
    );
    expect(findCrossLanguageBuildSeams(g)).toEqual([]);
  });

  it("does not flag the Rust crate's own ^build test edge", () => {
    const g = graph([rustCrate("engine"), rustCrate("core")], { engine: ["core"] });
    expect(findCrossLanguageBuildSeams(g)).toEqual([]);
  });

  it("matches the object long-form of ^build", () => {
    const g = graph(
      [
        node("web", {
          test: { executor: "@nx/vite:test", dependsOn: [{ target: "build", dependencies: true }] },
        }),
        rustCrate("engine"),
      ],
      { web: ["engine"] },
    );
    expect(findCrossLanguageBuildSeams(g)).toEqual([{ jsProject: "web", rustCrate: "engine" }]);
  });

  it("reports one seam per distinct Rust crate and de-duplicates repeat edges", () => {
    const g = graph(
      [
        node("web", { test: { executor: "@nx/vite:test", dependsOn: ["^build"] } }),
        rustCrate("engine"),
        rustCrate("codec"),
      ],
      { web: ["engine", "codec", "engine"] },
    );
    expect(findCrossLanguageBuildSeams(g)).toEqual([
      { jsProject: "web", rustCrate: "engine" },
      { jsProject: "web", rustCrate: "codec" },
    ]);
  });

  it("ignores JS projects with no test target", () => {
    const g = graph([node("web", { build: { executor: "@nx/vite:build" } }), rustCrate("engine")], {
      web: ["engine"],
    });
    expect(findCrossLanguageBuildSeams(g)).toEqual([]);
  });
});
