import { logger, type ProjectGraph, type Tree } from "@nx/devkit";
import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCacheInputs, buildCacheOutputs } from "../../utils/cache-inputs";
import cacheReportGenerator from "./generator";

function rustGraph(): ProjectGraph {
  return {
    nodes: {
      engine: {
        name: "engine",
        type: "lib",
        data: {
          root: "crates/engine",
          targets: {
            build: {
              executor: "@eddacraft/nxrust:build",
              cache: true,
              inputs: buildCacheInputs(),
              outputs: buildCacheOutputs({ target: "build", libraries: ["engine"] }),
              options: {},
            },
          },
        },
      },
    },
    dependencies: { engine: [] },
    externalNodes: {},
  } as unknown as ProjectGraph;
}

describe("cacheReportGenerator", () => {
  let tree: Tree;

  afterEach(() => vi.restoreAllMocks());

  it("logs the effective cache contract for each inferred crate (read-only)", async () => {
    tree = createTreeWithEmptyWorkspace();
    const treeWrite = vi.spyOn(tree, "write");
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await cacheReportGenerator(tree, { projectGraph: rustGraph() });

    const output = info.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("cache-report: engine (crates/engine)");
    expect(output).toContain("target-dir:");
    expect(output).toContain("build [cacheable]");
    expect(output).toContain("env allowlist:");
    expect(output).toContain("RUSTFLAGS");
    // Read-only: makes no edits to the tree.
    expect(treeWrite).not.toHaveBeenCalled();
  });

  it("emits structured JSON when --json is set", async () => {
    tree = createTreeWithEmptyWorkspace();
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await cacheReportGenerator(tree, { projectGraph: rustGraph(), json: true });

    const payload = JSON.parse(String(info.mock.calls[0][0]));
    expect(payload).toHaveLength(1);
    expect(payload[0].project).toBe("engine");
    expect(payload[0].targets[0].target).toBe("build");
    expect(payload[0].targets[0].envAllowlist).toContain("RUSTFLAGS");
  });

  it("reports nothing-found when no inferred crate matches the filter", async () => {
    tree = createTreeWithEmptyWorkspace();
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await cacheReportGenerator(tree, { projectGraph: rustGraph(), project: "missing" });

    expect(info.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "no inferred Rust crates found for project `missing`",
    );
  });
});
