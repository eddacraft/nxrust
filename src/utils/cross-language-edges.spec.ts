import { describe, expect, it } from "vitest";
import type { ProjectConfiguration, TargetConfiguration } from "@nx/devkit";
import { applyCrossLanguageTestSeam, severCrossLanguageTestEdge } from "./cross-language-edges";

describe("applyCrossLanguageTestSeam (D-WN4)", () => {
  it("strips an inherited `^build` from the JS test target", () => {
    const test: TargetConfiguration = { dependsOn: ["^build"] };
    expect(applyCrossLanguageTestSeam(test).dependsOn).toEqual([]);
  });

  it("writes an explicit empty dependsOn even when the test target had none", () => {
    // The workspace default `test.dependsOn: ["^build"]` is only overridden by
    // an *explicit* dependsOn on the project. An undefined dependsOn must
    // become `[]`, not stay undefined.
    expect(applyCrossLanguageTestSeam({}).dependsOn).toEqual([]);
  });

  it("preserves sibling non-build dependencies", () => {
    const test: TargetConfiguration = { dependsOn: ["^build", "prebuild"] };
    expect(applyCrossLanguageTestSeam(test).dependsOn).toEqual(["prebuild"]);
  });

  it("strips the object long-form of `^build`", () => {
    const test: TargetConfiguration = {
      dependsOn: [{ target: "build", projects: "dependencies" }],
    };
    expect(applyCrossLanguageTestSeam(test).dependsOn).toEqual([]);
  });

  it("strips the legacy `{ target, dependencies: true }` long-form", () => {
    const test: TargetConfiguration = {
      dependsOn: [{ target: "build", dependencies: true } as never],
    };
    expect(applyCrossLanguageTestSeam(test).dependsOn).toEqual([]);
  });

  it("does not touch a same-project `build` dependency", () => {
    // `build` (no caret) is a self-edge, not the cross-language one D-WN4 targets.
    const test: TargetConfiguration = { dependsOn: ["build"] };
    expect(applyCrossLanguageTestSeam(test).dependsOn).toEqual(["build"]);
  });

  it("does not strip a named-project build dependency", () => {
    // `{ target: 'build', projects: 'my-crate' }` is a specific edge, not the
    // "build all dependencies" sentinel — it must survive.
    const test: TargetConfiguration = {
      dependsOn: [{ target: "build", projects: "my-rust-crate" }],
    };
    expect(applyCrossLanguageTestSeam(test).dependsOn).toEqual([
      { target: "build", projects: "my-rust-crate" },
    ]);
  });

  it("strips the long-form even with a `params` field set", () => {
    const test: TargetConfiguration = {
      dependsOn: [{ target: "build", dependencies: true, params: "forward" } as never],
    };
    expect(applyCrossLanguageTestSeam(test).dependsOn).toEqual([]);
  });

  it("strips every occurrence when `^build` appears more than once", () => {
    const test: TargetConfiguration = { dependsOn: ["^build", "^build"] };
    expect(applyCrossLanguageTestSeam(test).dependsOn).toEqual([]);
  });

  it("does not mutate the input target or its dependsOn array", () => {
    const dependsOn = ["^build"];
    const test: TargetConfiguration = { options: { foo: 1 }, dependsOn };
    applyCrossLanguageTestSeam(test);
    expect(test.dependsOn).toEqual(["^build"]);
    expect(dependsOn).toEqual(["^build"]);
  });

  it("is idempotent under the default (strip) behaviour", () => {
    const once = applyCrossLanguageTestSeam({ dependsOn: ["^build", "prebuild"] });
    const twice = applyCrossLanguageTestSeam(once);
    expect(twice.dependsOn).toEqual(["prebuild"]);
  });

  it("preserves other target fields when rewriting dependsOn", () => {
    const test: TargetConfiguration = {
      executor: "@nx/vite:test",
      dependsOn: ["^build"],
      options: { passWithNoTests: true },
    };
    const result = applyCrossLanguageTestSeam(test);
    expect(result.executor).toBe("@nx/vite:test");
    expect(result.options).toEqual({ passWithNoTests: true });
  });

  describe("opt-in: consumesArtifactAtBuildTime", () => {
    it("retains an existing `^build`", () => {
      const test: TargetConfiguration = { dependsOn: ["^build"] };
      expect(
        applyCrossLanguageTestSeam(test, { consumesArtifactAtBuildTime: true }).dependsOn,
      ).toEqual(["^build"]);
    });

    it("ensures `^build` is present when the build genuinely consumes the artefact", () => {
      expect(
        applyCrossLanguageTestSeam({}, { consumesArtifactAtBuildTime: true }).dependsOn,
      ).toEqual(["^build"]);
    });

    it("does not duplicate an already-present `^build`", () => {
      const test: TargetConfiguration = { dependsOn: ["prebuild", "^build"] };
      expect(
        applyCrossLanguageTestSeam(test, { consumesArtifactAtBuildTime: true }).dependsOn,
      ).toEqual(["prebuild", "^build"]);
    });

    it("returns a fresh array — does not alias the input when retaining `^build`", () => {
      const dependsOn = ["^build"];
      const test: TargetConfiguration = { dependsOn };
      const result = applyCrossLanguageTestSeam(test, {
        consumesArtifactAtBuildTime: true,
      });
      expect(result.dependsOn).not.toBe(dependsOn);
      (result.dependsOn as string[]).push("mutated");
      expect(dependsOn).toEqual(["^build"]);
    });
  });
});

describe("severCrossLanguageTestEdge (project-level)", () => {
  it("adds a partial `test` override when the JS project has no explicit test target", () => {
    // @nx/js infers the `test` target; project.json carries no `test`. The
    // override must still materialise so the inherited `^build` is severed.
    const project: ProjectConfiguration = { root: "apps/web" };
    const result = severCrossLanguageTestEdge(project);
    expect(result.targets?.test).toEqual({ dependsOn: [] });
  });

  it("severs `^build` on an existing explicit test target", () => {
    const project: ProjectConfiguration = {
      root: "apps/web",
      targets: { test: { executor: "@nx/vite:test", dependsOn: ["^build"] } },
    };
    const result = severCrossLanguageTestEdge(project);
    expect(result.targets?.test).toEqual({
      executor: "@nx/vite:test",
      dependsOn: [],
    });
  });

  it("leaves sibling targets untouched", () => {
    const project: ProjectConfiguration = {
      root: "apps/web",
      targets: {
        build: { executor: "@nx/vite:build" },
        test: { dependsOn: ["^build"] },
      },
    };
    const result = severCrossLanguageTestEdge(project);
    expect(result.targets?.build).toEqual({ executor: "@nx/vite:build" });
  });

  it("does not mutate the input project", () => {
    const project: ProjectConfiguration = {
      root: "apps/web",
      targets: { test: { dependsOn: ["^build"] } },
    };
    severCrossLanguageTestEdge(project);
    expect(project.targets?.test.dependsOn).toEqual(["^build"]);
  });
});
