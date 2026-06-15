import { logger } from "@nx/devkit";
import { createTree } from "@nx/devkit/testing";
import { describe, expect, it, vi } from "vitest";
import { RUST_SOURCES_PATTERNS, RUST_WORKSPACE_PATTERNS } from "../../utils/cache-inputs";
import initGenerator from "./generator";

describe("initGenerator cache named inputs", () => {
  it("creates nx.json named inputs when nx.json is missing", async () => {
    const tree = createTree();

    await initGenerator(tree, { skipFormat: true });

    const nxJson = JSON.parse(tree.read("nx.json")?.toString() ?? "{}");
    expect(nxJson.namedInputs.rustSources).toEqual(RUST_SOURCES_PATTERNS);
    expect(nxJson.namedInputs.rustWorkspace).toEqual(RUST_WORKSPACE_PATTERNS);
  });

  it("preserves matching named inputs without warning", async () => {
    const tree = createTree();
    tree.write(
      "nx.json",
      JSON.stringify({
        namedInputs: {
          rustSources: RUST_SOURCES_PATTERNS,
          rustWorkspace: RUST_WORKSPACE_PATTERNS,
        },
      }),
    );
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await initGenerator(tree, { skipFormat: true });

    expect(warn).not.toHaveBeenCalled();
  });

  it("upgrades older array-valued named inputs with missing canonical patterns", async () => {
    const tree = createTree();
    tree.write(
      "nx.json",
      JSON.stringify({ namedInputs: { rustSources: ["{projectRoot}/src/**/*.rs"] } }),
    );
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await initGenerator(tree, { skipFormat: true });

    const nxJson = JSON.parse(tree.read("nx.json")?.toString() ?? "{}");
    expect(nxJson.namedInputs.rustSources).toEqual(RUST_SOURCES_PATTERNS);
    expect(nxJson.namedInputs.rustWorkspace).toEqual(RUST_WORKSPACE_PATTERNS);
    expect(warn).not.toHaveBeenCalled();
  });

  it("parses JSONC nx.json with comments without throwing", async () => {
    const tree = createTree();
    tree.write(
      "nx.json",
      `{
  // consumer workspace defaults
  "namedInputs": { "default": ["{projectRoot}/**/*"] }
}`,
    );

    await initGenerator(tree, { skipFormat: true });

    const nxJson = JSON.parse(tree.read("nx.json")?.toString() ?? "{}");
    expect(nxJson.namedInputs.rustSources).toEqual(RUST_SOURCES_PATTERNS);
    expect(nxJson.namedInputs.rustWorkspace).toEqual(RUST_WORKSPACE_PATTERNS);
    expect(nxJson.namedInputs.default).toEqual(["{projectRoot}/**/*"]);
  });

  it("leaves nx.json byte-for-byte untouched when nothing changes", async () => {
    const tree = createTree();
    const original = `{
  // keep me
  "namedInputs": {
    "rustSources": ${JSON.stringify(RUST_SOURCES_PATTERNS)},
    "rustWorkspace": ${JSON.stringify(RUST_WORKSPACE_PATTERNS)}
  }
}`;
    tree.write("nx.json", original);

    await initGenerator(tree, { skipFormat: true });

    expect(tree.read("nx.json")?.toString()).toBe(original);
  });

  it("warns and leaves non-array named inputs unchanged", async () => {
    const tree = createTree();
    tree.write("nx.json", JSON.stringify({ namedInputs: { rustSources: "default" } }));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await initGenerator(tree, { skipFormat: true });

    const nxJson = JSON.parse(tree.read("nx.json")?.toString() ?? "{}");
    expect(nxJson.namedInputs.rustSources).toBe("default");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nxrust:named-inputs-divergence"));
  });
});
