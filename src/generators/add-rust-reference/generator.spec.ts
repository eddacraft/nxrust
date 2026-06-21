import { addProjectConfiguration, logger, readProjectConfiguration, type Tree } from "@nx/devkit";
import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import addRustReferenceGenerator from "./generator";

function seedWorkspace(tree: Tree, jsTestDependsOn: unknown[] | undefined = ["^build"]) {
  addProjectConfiguration(tree, "web", {
    root: "packages/web",
    targets: {
      test: jsTestDependsOn === undefined ? {} : { executor: "@nx/vite:test", dependsOn: jsTestDependsOn },
    },
  });
  addProjectConfiguration(tree, "engine", {
    root: "crates/engine",
    targets: { build: { executor: "@eddacraft/nxrust:build" } },
  });
}

describe("addRustReferenceGenerator", () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("severs the inherited ^build on the JS test target by default", async () => {
    seedWorkspace(tree, ["^build"]);
    await addRustReferenceGenerator(tree, { project: "web", crate: "engine", skipFormat: true });
    expect(readProjectConfiguration(tree, "web").targets?.test?.dependsOn).toEqual([]);
  });

  it("preserves sibling non-^build deps while stripping ^build", async () => {
    seedWorkspace(tree, ["^build", "lint"]);
    await addRustReferenceGenerator(tree, { project: "web", crate: "engine", skipFormat: true });
    expect(readProjectConfiguration(tree, "web").targets?.test?.dependsOn).toEqual(["lint"]);
  });

  it("retains ^build under consumesArtifactAtBuildTime", async () => {
    seedWorkspace(tree, ["^build"]);
    await addRustReferenceGenerator(tree, {
      project: "web",
      crate: "engine",
      consumesArtifactAtBuildTime: true,
      skipFormat: true,
    });
    expect(readProjectConfiguration(tree, "web").targets?.test?.dependsOn).toContain("^build");
  });

  it("materialises a severed test target when the JS project has none", async () => {
    seedWorkspace(tree, undefined);
    await addRustReferenceGenerator(tree, { project: "web", crate: "engine", skipFormat: true });
    expect(readProjectConfiguration(tree, "web").targets?.test?.dependsOn).toEqual([]);
  });

  it("is idempotent", async () => {
    seedWorkspace(tree, ["^build"]);
    await addRustReferenceGenerator(tree, { project: "web", crate: "engine", skipFormat: true });
    await addRustReferenceGenerator(tree, { project: "web", crate: "engine", skipFormat: true });
    expect(readProjectConfiguration(tree, "web").targets?.test?.dependsOn).toEqual([]);
  });

  it("warns when the crate is not an nxrust Rust crate but still applies the seam", async () => {
    addProjectConfiguration(tree, "web", {
      root: "packages/web",
      targets: { test: { executor: "@nx/vite:test", dependsOn: ["^build"] } },
    });
    addProjectConfiguration(tree, "notrust", {
      root: "packages/notrust",
      targets: { build: { executor: "@nx/js:tsc" } },
    });
    await addRustReferenceGenerator(tree, { project: "web", crate: "notrust", skipFormat: true });
    expect(logger.warn).toHaveBeenCalled();
    expect(readProjectConfiguration(tree, "web").targets?.test?.dependsOn).toEqual([]);
  });

  it("throws a clear error when the JS project does not exist", async () => {
    seedWorkspace(tree, ["^build"]);
    await expect(
      addRustReferenceGenerator(tree, { project: "missing", crate: "engine", skipFormat: true }),
    ).rejects.toThrow(/missing/);
  });
});
