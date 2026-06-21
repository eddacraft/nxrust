import { logger, type ProjectGraph, type Tree } from "@nx/devkit";
import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import doctorGenerator from "./generator";

function graphWithSeam(): ProjectGraph {
  return {
    nodes: {
      web: {
        name: "web",
        type: "lib",
        data: { root: "packages/web", targets: { test: { executor: "@nx/vite:test", dependsOn: ["^build"] } } },
      },
      engine: {
        name: "engine",
        type: "lib",
        data: { root: "crates/engine", targets: { build: { executor: "@eddacraft/nxrust:build" } } },
      },
    },
    dependencies: { web: [{ source: "web", target: "engine", type: "static" }], engine: [] },
    externalNodes: {},
  } as unknown as ProjectGraph;
}

describe("doctorGenerator", () => {
  let tree: Tree;

  afterEach(() => vi.restoreAllMocks());

  it("warns with the ISS-001 diagnostic when a cross-language ^build seam exists", async () => {
    tree = createTreeWithEmptyWorkspace();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await doctorGenerator(tree, { projectGraph: graphWithSeam() });

    const output = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("JS project `web`");
    expect(output).toContain("Rust crate `engine`");
    expect(output).toContain("1 cross-language `^build` test seam(s) found");
  });

  it("reports a clean bill of health when there are no seams", async () => {
    tree = createTreeWithEmptyWorkspace();
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await doctorGenerator(tree, {
      projectGraph: {
        nodes: {
          engine: {
            name: "engine",
            type: "lib",
            data: { root: "crates/engine", targets: { build: { executor: "@eddacraft/nxrust:build" } } },
          },
        },
        dependencies: { engine: [] },
        externalNodes: {},
      } as unknown as ProjectGraph,
    });

    expect(warn).not.toHaveBeenCalled();
    expect(info.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "no cross-language `^build` test seams detected",
    );
  });
});
