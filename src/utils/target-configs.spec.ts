import { describe, expect, it } from "vitest";
import { buildCacheInputs } from "./cache-inputs";
import {
  buildTargetConfig,
  checkTargetConfig,
  clippyTargetConfig,
  fmtCheckTargetConfig,
  fmtTargetConfig,
  runTargetConfig,
  testTargetConfig,
} from "./target-configs";

describe("target cache inputs", () => {
  it("attaches the cache input contract to every cacheable target", () => {
    const cache = { resolvedToolchain: "stable" };
    const expectedInputs = buildCacheInputs(cache);

    expect(buildTargetConfig({}, cache, { binaries: ["app"] }).inputs).toEqual(expectedInputs);
    expect(checkTargetConfig({}, cache).inputs).toEqual(expectedInputs);
    expect(clippyTargetConfig({}, cache).inputs).toEqual(expectedInputs);
    expect(fmtCheckTargetConfig({}, cache).inputs).toEqual(expectedInputs);
    expect(testTargetConfig({}, cache).inputs).toEqual(expectedInputs);
  });

  it("does not attach cache inputs to mutating or uncached targets", () => {
    expect(fmtTargetConfig().inputs).toBeUndefined();
    expect(runTargetConfig().inputs).toBeUndefined();
  });

  it("narrows build outputs to cargo artefact paths", () => {
    expect(buildTargetConfig({}, {}, { binaries: ["app"] }).outputs).toEqual([
      "{workspaceRoot}/target/debug/app",
      "{workspaceRoot}/target/release/app",
    ]);
  });

  it("can keep the old wide build outputs as an escape hatch", () => {
    expect(
      buildTargetConfig({}, {}, { binaries: ["app"], narrowBuildOutputs: false }).outputs,
    ).toEqual(["{options.target-dir}", "{workspaceRoot}/target"]);
  });

  it("uses wide outputs when a static target triple changes the cargo output directory", () => {
    expect(
      buildTargetConfig({ target: "wasm32-unknown-unknown" }, {}, { binaries: ["app"] }).outputs,
    ).toEqual(["{options.target-dir}", "{workspaceRoot}/target"]);
  });

  it("narrows outputs rooted at a relocated --target-dir (D-C7)", () => {
    expect(
      buildTargetConfig({ "target-dir": "tmp/target" }, {}, { binaries: ["app"] }).outputs,
    ).toEqual(["{options.target-dir}/debug/app", "{options.target-dir}/release/app"]);
  });

  it("roots narrow outputs at an env-derived targetDirRoot when no --target-dir option", () => {
    expect(
      buildTargetConfig({}, {}, { binaries: ["app"], targetDirRoot: "{workspaceRoot}/.cargo-target" })
        .outputs,
    ).toEqual([
      "{workspaceRoot}/.cargo-target/debug/app",
      "{workspaceRoot}/.cargo-target/release/app",
    ]);
  });

  it("a --target-dir option overrides an env-derived targetDirRoot (cargo precedence)", () => {
    expect(
      buildTargetConfig(
        { "target-dir": "tmp/target" },
        {},
        { binaries: ["app"], targetDirRoot: "{workspaceRoot}/.cargo-target" },
      ).outputs,
    ).toEqual(["{options.target-dir}/debug/app", "{options.target-dir}/release/app"]);
  });

  it("uses wide outputs when a static custom profile changes the output directory", () => {
    expect(buildTargetConfig({ profile: "dist" }, {}, { binaries: ["app"] }).outputs).toEqual([
      "{options.target-dir}",
      "{workspaceRoot}/target",
    ]);
  });
});
