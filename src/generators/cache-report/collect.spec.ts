import type { ProjectGraph, ProjectGraphProjectNode } from "@nx/devkit";
import { describe, expect, it } from "vitest";
import { buildCacheInputs, buildCacheOutputs, CACHE_ENV_ALLOWLIST } from "../../utils/cache-inputs";
import { collectCacheReport } from "./collect";

type Targets = NonNullable<ProjectGraphProjectNode["data"]["targets"]>;

function node(name: string, targets: Targets): ProjectGraphProjectNode {
  return { name, type: "lib", data: { root: `crates/${name}`, targets } };
}

/** A crate whose targets carry the real inferred inputs/outputs (CACHE-004). */
function rustCrate(name: string): ProjectGraphProjectNode {
  return node(name, {
    build: {
      executor: "@eddacraft/nxrust:build",
      cache: true,
      inputs: buildCacheInputs(),
      outputs: buildCacheOutputs({ target: "build", libraries: [name] }),
      options: {},
    },
    check: {
      executor: "@eddacraft/nxrust:check",
      cache: true,
      inputs: buildCacheInputs(),
      outputs: [],
      options: {},
    },
    fmt: { executor: "@eddacraft/nxrust:fmt", options: {} },
  });
}

function graph(nodes: ProjectGraphProjectNode[]): ProjectGraph {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.name, n])),
    dependencies: Object.fromEntries(nodes.map((n) => [n.name, []])),
    externalNodes: {},
  } as unknown as ProjectGraph;
}

const WS = "/ws";

describe("collectCacheReport", () => {
  it("reports every nxrust target of an inferred crate, alphabetised", () => {
    const reports = collectCacheReport(graph([rustCrate("engine")]), { workspaceRoot: WS, env: {} });

    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(report.project).toBe("engine");
    expect(report.root).toBe("crates/engine");
    expect(report.targets.map((t) => t.target)).toEqual(["build", "check", "fmt"]);
  });

  it("surfaces the env allowlist participating in the cache key", () => {
    const [report] = collectCacheReport(graph([rustCrate("engine")]), {
      workspaceRoot: WS,
      env: {},
    });

    const build = report.targets.find((t) => t.target === "build")!;
    expect(build.cache).toBe(true);
    // Every allowlisted env var that inference pinned should be reported, in order.
    expect(build.envAllowlist).toEqual([...CACHE_ENV_ALLOWLIST]);
    expect(build.inputs).toContain("rustSources");
    expect(build.inputs).toContain("env:RUSTFLAGS");
    expect(build.outputs).toContain("{workspaceRoot}/target/debug/libengine.rlib");
  });

  it("marks non-cacheable targets (fmt) as not cached", () => {
    const [report] = collectCacheReport(graph([rustCrate("engine")]), {
      workspaceRoot: WS,
      env: {},
    });
    const fmt = report.targets.find((t) => t.target === "fmt")!;
    expect(fmt.cache).toBe(false);
    expect(fmt.envAllowlist).toEqual([]);
  });

  it("resolves the default target-dir root when CARGO_TARGET_DIR is unset", () => {
    const [report] = collectCacheReport(graph([rustCrate("engine")]), {
      workspaceRoot: WS,
      env: {},
    });
    expect(report.targetDirRoot).toBe("{workspaceRoot}/target");
  });

  it("relocates the target-dir root for an in-workspace CARGO_TARGET_DIR", () => {
    const [report] = collectCacheReport(graph([rustCrate("engine")]), {
      workspaceRoot: WS,
      env: { CARGO_TARGET_DIR: "build-out/target" },
    });
    expect(report.targetDirRoot).toBe("{workspaceRoot}/build-out/target");
  });

  it("uses the absolute path for an external CARGO_TARGET_DIR", () => {
    const [report] = collectCacheReport(graph([rustCrate("engine")]), {
      workspaceRoot: WS,
      env: { CARGO_TARGET_DIR: "/tmp/shared-target" },
    });
    expect(report.targetDirRoot).toBe("/tmp/shared-target");
  });

  it("filters to a single project by name", () => {
    const reports = collectCacheReport(graph([rustCrate("engine"), rustCrate("codec")]), {
      workspaceRoot: WS,
      env: {},
      project: "codec",
    });
    expect(reports.map((r) => r.project)).toEqual(["codec"]);
  });

  it("ignores non-Rust projects and sorts crates", () => {
    const reports = collectCacheReport(
      graph([
        node("web", { test: { executor: "@nx/vite:test" } }),
        rustCrate("zeta"),
        rustCrate("alpha"),
      ]),
      { workspaceRoot: WS, env: {} },
    );
    expect(reports.map((r) => r.project)).toEqual(["alpha", "zeta"]);
  });
});
