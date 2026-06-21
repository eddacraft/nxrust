import { logger, type CreateDependenciesContext } from "@nx/devkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CargoMetadata } from "./models/cargo-metadata";

// Mock `cargoMetadata` so tests don't invoke the real cargo binary.
vi.mock("./utils/cargo", async () => {
  const actual = await vi.importActual<typeof import("./utils/cargo")>("./utils/cargo");
  return {
    ...actual,
    cargoMetadata: vi.fn(),
  };
});

// Mock `node:fs` statSync so cache-fingerprint tests can drive mtime values
// without touching the real filesystem.
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

async function load() {
  const graph = await import("./graph");
  graph.__resetGraphCacheForTests();
  return graph;
}

async function setMetadata(metadata: CargoMetadata | null) {
  const cargo = await import("./utils/cargo");
  (cargo.cargoMetadata as ReturnType<typeof vi.fn>).mockReturnValue(metadata);
}

async function cargoMetadataMock() {
  const cargo = await import("./utils/cargo");
  return cargo.cargoMetadata as ReturnType<typeof vi.fn>;
}

async function setStatMtimes(mtimes: Record<string, number | "missing">) {
  const fs = await import("node:fs");
  (fs.statSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    const value = mtimes[path];
    if (value === undefined || value === "missing") {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
    return { mtimeMs: value } as ReturnType<typeof import("node:fs").statSync>;
  });
}

const ws = "/ws";

function pkg(over: Partial<CargoMetadata["packages"][0]>): CargoMetadata["packages"][0] {
  return {
    name: "x",
    version: "0.1.0",
    id: `${over.name ?? "x"} 0.1.0`,
    dependencies: [],
    targets: [{ kind: ["lib"], crate_types: ["lib"], name: "x", src_path: "" }],
    features: {},
    manifest_path: `/ws/crates/${over.name ?? "x"}/Cargo.toml`,
    ...over,
  };
}

function md(packages: CargoMetadata["packages"]): CargoMetadata {
  return {
    packages,
    workspace_members: packages.map((p) => p.id),
    workspace_root: ws,
    resolve: null,
    target_directory: `${ws}/target`,
    version: 1,
    metadata: null,
  };
}

describe("createDependencies", () => {
  beforeEach(async () => {
    const { __resetGraphCacheForTests } = await load();
    __resetGraphCacheForTests();
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a static edge between two workspace members with a path dep", async () => {
    await setMetadata(
      md([
        pkg({
          name: "app",
          targets: [{ kind: ["bin"], crate_types: ["bin"], name: "app", src_path: "" }],
          dependencies: [
            {
              name: "lib",
              req: "*",
              path: "/ws/crates/lib",
              source: null,
              optional: false,
              uses_default_features: true,
              features: [],
              kind: null,
            },
          ],
        }),
        pkg({ name: "lib" }),
      ]),
    );
    const { createDependencies } = await load();

    const ctx: CreateDependenciesContext = {
      workspaceRoot: ws,
      projects: {
        app: { root: "crates/app", name: "app" },
        lib: { root: "crates/lib", name: "lib" },
      } as never,
      externalNodes: {},
      fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
      nxJsonConfiguration: {},
    };

    const edges = createDependencies({}, ctx);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "app", target: "lib" });
  });

  it("skips dev-dependencies so they do not trigger downstream rebuilds", async () => {
    await setMetadata(
      md([
        pkg({
          name: "app",
          dependencies: [
            {
              name: "lib",
              req: "*",
              path: "/ws/crates/lib",
              source: null,
              optional: false,
              uses_default_features: true,
              features: [],
              kind: "dev",
            },
          ],
        }),
        pkg({ name: "lib" }),
      ]),
    );
    const { createDependencies } = await load();

    const ctx: CreateDependenciesContext = {
      workspaceRoot: ws,
      projects: {
        app: { root: "crates/app", name: "app" },
        lib: { root: "crates/lib", name: "lib" },
      } as never,
      externalNodes: {},
      fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
      nxJsonConfiguration: {},
    };

    expect(createDependencies({}, ctx)).toHaveLength(0);
  });

  it("emits external edges for registry deps", async () => {
    await setMetadata(
      md([
        pkg({
          name: "app",
          dependencies: [
            {
              name: "serde",
              req: "^1",
              source: "registry+https://crates.io",
              optional: false,
              uses_default_features: true,
              features: [],
              kind: null,
            },
          ],
        }),
      ]),
    );
    const { createDependencies } = await load();

    const ctx: CreateDependenciesContext = {
      workspaceRoot: ws,
      projects: { app: { root: "crates/app", name: "app" } } as never,
      externalNodes: {
        "cargo:serde": {
          type: "cargo" as never,
          name: "cargo:serde" as never,
          data: { packageName: "serde", version: "1.0.0" },
        },
      },
      fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
      nxJsonConfiguration: {},
    };

    const edges = createDependencies({}, ctx);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "app", target: "cargo:serde" });
  });

  it("returns no edges when cargo metadata is unavailable", async () => {
    await setMetadata(null);
    const { createDependencies } = await load();
    const ctx: CreateDependenciesContext = {
      workspaceRoot: ws,
      projects: {},
      externalNodes: {},
      fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
      nxJsonConfiguration: {},
    };
    expect(createDependencies({}, ctx)).toEqual([]);
  });

  it("does not emit edges from a registry package that shares a workspace name", async () => {
    // Workspace `lib` (path) + a registry crate also called `lib`, with a
    // dep on `serde`. Without the workspace-membership filter the registry
    // package's deps would be attributed to the workspace `lib` project.
    await setMetadata(
      md([
        pkg({ name: "lib" }),
        {
          name: "lib",
          version: "9.9.9",
          id: "lib 9.9.9 (registry)",
          source: "registry+https://crates.io",
          manifest_path: "/home/cache/lib-9.9.9/Cargo.toml",
          features: {},
          targets: [{ kind: ["lib"], crate_types: ["lib"], name: "lib", src_path: "" }],
          dependencies: [
            {
              name: "serde",
              req: "^1",
              source: "registry+https://crates.io",
              optional: false,
              uses_default_features: true,
              features: [],
              kind: null,
            },
          ],
        },
      ]),
    );
    const { createDependencies } = await load();

    const ctx: CreateDependenciesContext = {
      workspaceRoot: ws,
      projects: { lib: { root: "crates/lib", name: "lib" } } as never,
      externalNodes: {
        "cargo:serde": {
          type: "cargo" as never,
          name: "cargo:serde" as never,
          data: { packageName: "serde", version: "1.0.0" },
        },
      },
      fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
      nxJsonConfiguration: {},
    };

    expect(createDependencies({}, ctx)).toHaveLength(0);
  });
});

describe("inferred project targets", () => {
  beforeEach(async () => {
    const { __resetGraphCacheForTests } = await load();
    __resetGraphCacheForTests();
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
      "/ws/crates/foo/Cargo.toml": 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pins the cargo package name on every cargo-backed target", async () => {
    // Without an explicit `package` option, the executor falls back to the Nx
    // project name. When `@nx/js` claims the project name from a sibling
    // package.json (e.g. napi-rs bindings) the Nx name becomes `@scope/foo`,
    // which cargo rejects when handed to `-p`. Pinning here keeps the cargo
    // package decoupled from whatever Nx ends up calling the project.
    const publishablePkg = pkg({
      name: "foo",
      targets: [{ kind: ["bin"], crate_types: ["bin"], name: "foo", src_path: "" }],
    });
    await setMetadata(md([publishablePkg]));

    const { createNodesV2 } = await load();
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<
      Array<
        [
          string,
          {
            projects: Record<
              string,
              { targets: Record<string, { options?: { package?: string } }> }
            >;
          },
        ]
      >
    >;

    const result = await fn(
      ["crates/foo/Cargo.toml"],
      {},
      {
        workspaceRoot: ws,
        nxJsonConfiguration: {},
      },
    );

    const [, payload] = result[0];
    const project = payload.projects["crates/foo"];
    const expected = [
      "build",
      "check",
      "clippy",
      "lint",
      "fmt",
      "fmt-check",
      "test",
      "run",
      "nx-release-publish",
    ];
    for (const target of expected) {
      expect(
        project.targets[target]?.options?.package,
        `target ${target} should pin the cargo package name`,
      ).toBe("foo");
    }
  });

  it("bakes the resolved rust-toolchain channel into cacheable target runtime inputs", async () => {
    const fs = await import("node:fs");
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string) => path === "/ws/rust-toolchain.toml",
    );
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      '[toolchain]\nchannel = "stable"\n',
    );
    await setMetadata(md([pkg({ name: "foo" })]));

    const { createNodesV2 } = await load();
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<
      Array<
        [string, { projects: Record<string, { targets: Record<string, { inputs?: unknown[] }> }> }]
      >
    >;

    const result = await fn(
      ["crates/foo/Cargo.toml"],
      {},
      {
        workspaceRoot: ws,
        nxJsonConfiguration: {},
      },
    );

    const [, payload] = result[0];
    expect(payload.projects["crates/foo"].targets.build.inputs).toContainEqual({
      runtime: "rustup run stable rustc -Vv",
    });
    expect(payload.projects["crates/foo"].targets.build.inputs).toContainEqual({
      runtime: "rustup run stable cargo -V",
    });
  });

  it("narrows inferred build outputs from cargo metadata targets", async () => {
    await setMetadata(
      md([
        pkg({
          name: "foo-cli",
          targets: [
            { kind: ["lib"], crate_types: ["lib"], name: "foo-cli", src_path: "" },
            { kind: ["bin"], crate_types: ["bin"], name: "foo", src_path: "" },
          ],
        }),
      ]),
    );

    const { createNodesV2 } = await load();
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<
      Array<
        [string, { projects: Record<string, { targets: Record<string, { outputs?: string[] }> }> }]
      >
    >;

    const result = await fn(
      ["crates/foo-cli/Cargo.toml"],
      {},
      {
        workspaceRoot: ws,
        nxJsonConfiguration: {},
      },
    );

    const [, payload] = result[0];
    expect(payload.projects["crates/foo-cli"].targets.build.outputs).toEqual([
      "{workspaceRoot}/target/debug/foo",
      "{workspaceRoot}/target/debug/libfoo_cli.rlib",
      "{workspaceRoot}/target/release/foo",
      "{workspaceRoot}/target/release/libfoo_cli.rlib",
    ]);
  });

  it("roots narrow build outputs at a relocated CARGO_TARGET_DIR (D-C7)", async () => {
    await setMetadata(
      md([
        pkg({
          name: "relocated-cli",
          targets: [
            { kind: ["lib"], crate_types: ["lib"], name: "relocated-cli", src_path: "" },
            { kind: ["bin"], crate_types: ["bin"], name: "reloc", src_path: "" },
          ],
        }),
      ]),
    );

    const { createNodesV2 } = await load();
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<
      Array<
        [string, { projects: Record<string, { targets: Record<string, { outputs?: string[] }> }> }]
      >
    >;

    const prev = process.env.CARGO_TARGET_DIR;
    process.env.CARGO_TARGET_DIR = ".cargo-target";
    try {
      const result = await fn(
        ["crates/relocated-cli/Cargo.toml"],
        {},
        { workspaceRoot: ws, nxJsonConfiguration: {} },
      );
      const [, payload] = result[0];
      expect(payload.projects["crates/relocated-cli"].targets.build.outputs).toEqual([
        "{workspaceRoot}/.cargo-target/debug/reloc",
        "{workspaceRoot}/.cargo-target/debug/librelocated_cli.rlib",
        "{workspaceRoot}/.cargo-target/release/reloc",
        "{workspaceRoot}/.cargo-target/release/librelocated_cli.rlib",
      ]);
    } finally {
      if (prev === undefined) delete process.env.CARGO_TARGET_DIR;
      else process.env.CARGO_TARGET_DIR = prev;
    }
  });

  it("keeps narrow outputs for crates with build.rs, examples, tests, and benches", async () => {
    // `cargo metadata` reports these auxiliary targets with a non-`bin` kind
    // but `crate_types: ['bin']`. They must NOT trip the unsupported-library
    // fallback, or every real crate with a build script loses narrowing.
    await setMetadata(
      md([
        pkg({
          name: "foo-lib",
          targets: [
            { kind: ["lib"], crate_types: ["lib"], name: "foo-lib", src_path: "" },
            {
              kind: ["custom-build"],
              crate_types: ["bin"],
              name: "build-script-build",
              src_path: "",
            },
            { kind: ["example"], crate_types: ["bin"], name: "demo", src_path: "" },
            { kind: ["test"], crate_types: ["bin"], name: "it", src_path: "" },
            { kind: ["bench"], crate_types: ["bin"], name: "perf", src_path: "" },
          ],
        }),
      ]),
    );

    const { createNodesV2 } = await load();
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<
      Array<
        [string, { projects: Record<string, { targets: Record<string, { outputs?: string[] }> }> }]
      >
    >;

    const result = await fn(
      ["crates/foo-lib/Cargo.toml"],
      {},
      {
        workspaceRoot: ws,
        nxJsonConfiguration: {},
      },
    );

    const [, payload] = result[0];
    expect(payload.projects["crates/foo-lib"].targets.build.outputs).toEqual([
      "{workspaceRoot}/target/debug/libfoo_lib.rlib",
      "{workspaceRoot}/target/release/libfoo_lib.rlib",
    ]);
  });

  it("honours the narrowBuildOutputs false plugin option for inferred targets", async () => {
    await setMetadata(md([pkg({ name: "foo" })]));

    const { createNodesV2 } = await load();
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: { narrowBuildOutputs?: boolean },
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<
      Array<
        [string, { projects: Record<string, { targets: Record<string, { outputs?: string[] }> }> }]
      >
    >;

    const result = await fn(
      ["crates/foo/Cargo.toml"],
      { narrowBuildOutputs: false },
      {
        workspaceRoot: ws,
        nxJsonConfiguration: {},
      },
    );

    const [, payload] = result[0];
    expect(payload.projects["crates/foo"].targets.build.outputs).toEqual([
      "{options.target-dir}",
      "{workspaceRoot}/target",
    ]);
  });

  it("uses wide outputs for unsupported library crate types", async () => {
    await setMetadata(
      md([
        pkg({
          name: "native",
          targets: [{ kind: ["lib"], crate_types: ["cdylib"], name: "native", src_path: "" }],
        }),
      ]),
    );

    const { createNodesV2 } = await load();
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<
      Array<
        [string, { projects: Record<string, { targets: Record<string, { outputs?: string[] }> }> }]
      >
    >;

    const result = await fn(
      ["crates/native/Cargo.toml"],
      {},
      {
        workspaceRoot: ws,
        nxJsonConfiguration: {},
      },
    );

    const [, payload] = result[0];
    expect(payload.projects["crates/native"].targets.build.outputs).toEqual([
      "{options.target-dir}",
      "{workspaceRoot}/target",
    ]);
  });

  it("uses wide outputs for proc-macro targets", async () => {
    await setMetadata(
      md([
        pkg({
          name: "macros",
          targets: [
            {
              kind: ["proc-macro"],
              crate_types: ["proc-macro"],
              name: "macros",
              src_path: "",
            },
          ],
        }),
      ]),
    );

    const { createNodesV2 } = await load();
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<
      Array<
        [string, { projects: Record<string, { targets: Record<string, { outputs?: string[] }> }> }]
      >
    >;

    const result = await fn(
      ["crates/macros/Cargo.toml"],
      {},
      {
        workspaceRoot: ws,
        nxJsonConfiguration: {},
      },
    );

    const [, payload] = result[0];
    expect(payload.projects["crates/macros"].targets.build.outputs).toEqual([
      "{options.target-dir}",
      "{workspaceRoot}/target",
    ]);
  });
});

describe("inferred default target set (TARGETS-001)", () => {
  beforeEach(async () => {
    const { __resetGraphCacheForTests } = await load();
    __resetGraphCacheForTests();
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
      "/ws/crates/foo/Cargo.toml": 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  type InferredProject = {
    targets: Record<
      string,
      {
        executor?: string;
        cache?: boolean;
        inputs?: unknown[];
        outputs?: unknown[];
        options?: Record<string, unknown>;
      }
    >;
  };

  async function inferProject(metadataPkg: CargoMetadata["packages"][0]): Promise<InferredProject> {
    await setMetadata(md([metadataPkg]));
    const { createNodesV2 } = await load();
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<Array<[string, { projects: Record<string, InferredProject> }]>>;
    const result = await fn(
      [`crates/${metadataPkg.name}/Cargo.toml`],
      {},
      {
        workspaceRoot: ws,
        nxJsonConfiguration: {},
      },
    );
    const [, payload] = result[0];
    return payload.projects[`crates/${metadataPkg.name}`];
  }

  const binPkg = () =>
    pkg({
      name: "foo",
      targets: [{ kind: ["bin"], crate_types: ["bin"], name: "foo", src_path: "" }],
    });

  it("infers the full default target set for a publishable binary crate", async () => {
    const project = await inferProject(binPkg());
    expect(Object.keys(project.targets).sort()).toEqual(
      [
        "build",
        "check",
        "clippy",
        "lint",
        "fmt",
        "fmt-check",
        "test",
        "run",
        "nx-release-publish",
      ].sort(),
    );
  });

  it("omits run for library crates and nx-release-publish for private crates", async () => {
    const project = await inferProject(pkg({ name: "foo", publish: [] }));
    expect(project.targets.run).toBeUndefined();
    expect(project.targets["nx-release-publish"]).toBeUndefined();
  });

  it("infers lint as an exact alias of clippy (D-T4)", async () => {
    const project = await inferProject(binPkg());
    expect(project.targets.lint).toBeDefined();
    expect(project.targets.lint).toEqual(project.targets.clippy);
    expect(project.targets.lint.executor).toBe("@eddacraft/nxrust:clippy");
    expect(project.targets.lint.options?.package).toBe("foo");
  });

  it("keeps fmt uncacheable and fmt-check cacheable (D-T2)", async () => {
    const project = await inferProject(binPkg());
    expect(project.targets.fmt.cache).toBeUndefined();
    expect(project.targets.fmt.inputs).toBeUndefined();
    expect(project.targets["fmt-check"].cache).toBe(true);
    expect(project.targets["fmt-check"].options?.check).toBe(true);
    expect(project.targets["fmt-check"].inputs).toContain("rustSources");
  });

  it("emits no dependsOn on build and test (cargo builds deps itself; ISS-001)", async () => {
    const project = await inferProject(binPkg());
    expect(project.targets.build).not.toHaveProperty("dependsOn");
    expect(project.targets.test).not.toHaveProperty("dependsOn");
  });

  it("is deterministic: identical metadata yields identical projects, key order included", async () => {
    const first = await inferProject(binPkg());
    const { __resetGraphCacheForTests } = await load();
    __resetGraphCacheForTests();
    const second = await inferProject(binPkg());
    expect(second).toEqual(first);
    expect(Object.keys(second.targets)).toEqual(Object.keys(first.targets));
  });
});

describe("inferred target option overrides (TARGETS-002)", () => {
  beforeEach(async () => {
    const { __resetGraphCacheForTests } = await load();
    __resetGraphCacheForTests();
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
      "/ws/crates/foo/Cargo.toml": 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  type InferredProject = {
    targets: Record<
      string,
      {
        executor?: string;
        cache?: boolean;
        inputs?: unknown[];
        outputs?: unknown[];
        options?: Record<string, unknown>;
      }
    >;
  };

  async function inferWithMeta(
    nxrust: unknown,
    over: Partial<CargoMetadata["packages"][0]> = {},
  ): Promise<InferredProject> {
    await setMetadata(md([pkg({ name: "foo", metadata: { nxrust }, ...over })]));
    const { createNodesV2 } = await load();
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<Array<[string, { projects: Record<string, InferredProject> }]>>;
    const result = await fn(
      ["crates/foo/Cargo.toml"],
      {},
      {
        workspaceRoot: ws,
        nxJsonConfiguration: {},
      },
    );
    const [, payload] = result[0];
    return payload.projects["crates/foo"];
  }

  it("feeds targets.<name> option defaults into the inferred target", async () => {
    const project = await inferWithMeta({
      targets: { test: { "all-features": true } },
    });
    expect(project.targets.test.options?.["all-features"]).toBe(true);
    expect(project.targets.test.options?.package).toBe("foo");
    // Other targets are untouched.
    expect(project.targets.build.options).toEqual({ package: "foo" });
  });

  it("never lets metadata override the pinned cargo package name (D-T3)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const project = await inferWithMeta({
      targets: { test: { package: "evil", "all-features": true } },
    });
    expect(project.targets.test.options?.package).toBe("foo");
    expect(project.targets.test.options?.["all-features"]).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("warns and skips an unknown target name, applying valid siblings", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const project = await inferWithMeta({
      targets: { tset: { "all-features": true }, check: { locked: true } },
    });
    expect(project.targets.check.options?.locked).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain("tset");
  });

  it("warns and skips run overrides on a library crate (target not inferred)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const project = await inferWithMeta({ targets: { run: { release: true } } });
    expect(project.targets.run).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("warns and ignores a non-table targets value", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const project = await inferWithMeta({ targets: ["test"] });
    expect(project.targets.test.options).toEqual({ package: "foo" });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("warns and ignores a non-table target entry, applying valid siblings", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const project = await inferWithMeta({
      targets: { test: "yes", check: { locked: true } },
    });
    expect(project.targets.test.options).toEqual({ package: "foo" });
    expect(project.targets.check.options?.locked).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("applies the clippy table to both clippy and lint (D-T4 alias fidelity)", async () => {
    const project = await inferWithMeta({
      targets: { clippy: { "all-features": true } },
    });
    expect(project.targets.clippy.options?.["all-features"]).toBe(true);
    expect(project.targets.lint).toEqual(project.targets.clippy);
  });

  it("warns and ignores a targets.lint table, pointing at clippy as canonical", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const project = await inferWithMeta({
      targets: { lint: { "all-features": true } },
    });
    expect(project.targets.lint.options).toEqual({ package: "foo" });
    expect(project.targets.lint).toEqual(project.targets.clippy);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain("clippy");
  });

  it("strips check from fmt-check overrides so the cacheable target cannot mutate", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const project = await inferWithMeta({
      targets: { "fmt-check": { check: false, locked: true } },
    });
    expect(project.targets["fmt-check"].options?.check).toBe(true);
    expect(project.targets["fmt-check"].options?.locked).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("bakes a target-level toolchain into the option and the cache runtime inputs", async () => {
    const project = await inferWithMeta({
      targets: { test: { toolchain: "nightly" } },
    });
    expect(project.targets.test.options?.toolchain).toBe("nightly");
    expect(project.targets.test.inputs).toContainEqual({
      runtime: "rustup run nightly rustc -Vv",
    });
    // Targets without the override keep the default resolution.
    expect(project.targets.build.inputs).toContainEqual({ runtime: "rustc -Vv" });
    expect(project.targets.build.options?.toolchain).toBeUndefined();
  });

  it("applies a package-level toolchain to all targets, with target-level winning", async () => {
    const project = await inferWithMeta({
      toolchain: "beta",
      targets: { test: { toolchain: "nightly" } },
    });
    expect(project.targets.build.options?.toolchain).toBe("beta");
    expect(project.targets.build.inputs).toContainEqual({
      runtime: "rustup run beta rustc -Vv",
    });
    expect(project.targets.test.options?.toolchain).toBe("nightly");
    expect(project.targets.test.inputs).toContainEqual({
      runtime: "rustup run nightly rustc -Vv",
    });
  });

  it("warns and falls back to default resolution on an invalid toolchain literal", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const project = await inferWithMeta({
      targets: { test: { toolchain: "a;b" } },
    });
    expect(project.targets.test.options?.toolchain).toBeUndefined();
    expect(project.targets.test.inputs).toContainEqual({ runtime: "rustc -Vv" });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("widens build outputs when metadata sets a profile (narrowing precondition lost)", async () => {
    const project = await inferWithMeta({
      targets: { build: { profile: "fast" } },
    });
    expect(project.targets.build.options?.profile).toBe("fast");
    expect(project.targets.build.outputs).toEqual([
      "{options.target-dir}",
      "{workspaceRoot}/target",
    ]);
  });
});

describe("graph cache invalidation", () => {
  beforeEach(async () => {
    const { __resetGraphCacheForTests } = await load();
    __resetGraphCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runCreateNodes(
    graph: Awaited<ReturnType<typeof load>>,
    paths: readonly string[] = ["crates/foo/Cargo.toml"],
  ) {
    const { createNodesV2 } = graph;
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<unknown>;
    await fn(
      paths,
      {},
      {
        workspaceRoot: ws,
        nxJsonConfiguration: {},
      },
    );
  }

  it("reuses the cargo metadata cache when no manifest changes", async () => {
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
      "/ws/crates/foo/Cargo.toml": 1,
    });
    await setMetadata(md([pkg({ name: "foo" })]));
    const cargoFn = await cargoMetadataMock();
    const graph = await load();

    await runCreateNodes(graph);
    await runCreateNodes(graph);

    expect(cargoFn).toHaveBeenCalledTimes(1);
  });

  it("invalidates when the root Cargo.toml changes without a lockfile bump", async () => {
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
      "/ws/crates/foo/Cargo.toml": 1,
    });
    await setMetadata(md([pkg({ name: "foo" })]));
    const cargoFn = await cargoMetadataMock();
    const graph = await load();

    await runCreateNodes(graph);
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 2, // workspace member added — lockfile not yet refreshed
      "/ws/crates/foo/Cargo.toml": 1,
    });
    await runCreateNodes(graph);

    expect(cargoFn).toHaveBeenCalledTimes(2);
  });

  it("invalidates when a member's Cargo.toml changes without a lockfile bump", async () => {
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
      "/ws/crates/foo/Cargo.toml": 1,
    });
    await setMetadata(md([pkg({ name: "foo" })]));
    const cargoFn = await cargoMetadataMock();
    const graph = await load();

    await runCreateNodes(graph);
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
      "/ws/crates/foo/Cargo.toml": 5, // crate manifest edited (e.g. target/feature change)
    });
    await runCreateNodes(graph);

    expect(cargoFn).toHaveBeenCalledTimes(2);
  });

  it("invalidates when the workspace rust-toolchain.toml changes", async () => {
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
      "/ws/rust-toolchain.toml": 1,
      "/ws/crates/foo/Cargo.toml": 1,
    });
    await setMetadata(md([pkg({ name: "foo" })]));
    const cargoFn = await cargoMetadataMock();
    const graph = await load();

    await runCreateNodes(graph);
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
      "/ws/rust-toolchain.toml": 2,
      "/ws/crates/foo/Cargo.toml": 1,
    });
    await runCreateNodes(graph);

    expect(cargoFn).toHaveBeenCalledTimes(2);
  });

  it("invalidates when an intermediate rust-toolchain.toml changes", async () => {
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
      "/ws/crates/rust-toolchain.toml": 1,
      "/ws/crates/foo/Cargo.toml": 1,
    });
    await setMetadata(md([pkg({ name: "foo" })]));
    const cargoFn = await cargoMetadataMock();
    const graph = await load();

    await runCreateNodes(graph);
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
      "/ws/crates/rust-toolchain.toml": 2,
      "/ws/crates/foo/Cargo.toml": 1,
    });
    await runCreateNodes(graph);

    expect(cargoFn).toHaveBeenCalledTimes(2);
  });

  it("recomputes when Nx asks for a newly added wildcard workspace member", async () => {
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
      "/ws/crates/foo/Cargo.toml": 1,
      "/ws/crates/bar/Cargo.toml": 1,
    });
    await setMetadata(md([pkg({ name: "foo" })]));
    const cargoFn = await cargoMetadataMock();
    const graph = await load();

    await runCreateNodes(graph, ["crates/foo/Cargo.toml"]);
    await setMetadata(md([pkg({ name: "foo" }), pkg({ name: "bar" })]));
    await runCreateNodes(graph, ["crates/foo/Cargo.toml", "crates/bar/Cargo.toml"]);

    expect(cargoFn).toHaveBeenCalledTimes(2);
  });

  it("still recomputes when no Cargo.lock exists yet", async () => {
    // Fresh workspace: the lockfile has not been generated yet, so cache
    // must not pin to "missing-lockfile" forever.
    await setStatMtimes({
      "/ws/Cargo.toml": 1,
      "/ws/crates/foo/Cargo.toml": 1,
    });
    await setMetadata(md([pkg({ name: "foo" })]));
    const cargoFn = await cargoMetadataMock();
    const graph = await load();

    await runCreateNodes(graph);
    await setStatMtimes({
      "/ws/Cargo.toml": 2, // workspace edited; still no lockfile
      "/ws/crates/foo/Cargo.toml": 1,
    });
    await runCreateNodes(graph);

    expect(cargoFn).toHaveBeenCalledTimes(2);
  });
});

describe("inferred project tags", () => {
  beforeEach(async () => {
    const { __resetGraphCacheForTests } = await load();
    __resetGraphCacheForTests();
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
      "/ws/crates/foo/Cargo.toml": 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Run `createNodesV2` over a metadata set and return the inferred project
  // configs keyed by root, so tests can assert tags per crate.
  async function inferProjects(
    packages: CargoMetadata["packages"],
    paths: readonly string[],
  ): Promise<Record<string, { projectType?: string; tags?: string[] }>> {
    await setMetadata(md(packages));
    const { createNodesV2 } = await load();
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<
      Array<[string, { projects: Record<string, { projectType?: string; tags?: string[] }> }]>
    >;
    const results = await fn(paths, {}, { workspaceRoot: ws, nxJsonConfiguration: {} });
    return Object.fromEntries(results.flatMap(([, payload]) => Object.entries(payload.projects)));
  }

  // Single-crate convenience wrapper around `inferProjects`.
  async function inferTagsFor(
    over: Partial<CargoMetadata["packages"][0]>,
  ): Promise<string[] | undefined> {
    const projects = await inferProjects(
      [pkg({ name: "foo", ...over })],
      ["crates/foo/Cargo.toml"],
    );
    return projects["crates/foo"].tags;
  }

  it("lifts package.metadata.nxrust.tags into the inferred project tags", async () => {
    expect(
      await inferTagsFor({ metadata: { nxrust: { tags: ["cargo", "scope:anvil"] } } }),
    ).toEqual(["cargo", "scope:anvil"]);
  });

  it("lifts tags on a binary crate (projectType application) too", async () => {
    const projects = await inferProjects(
      [
        pkg({
          name: "foo",
          targets: [{ kind: ["bin"], crate_types: ["bin"], name: "foo", src_path: "" }],
          metadata: { nxrust: { tags: ["cargo", "type:bin"] } },
        }),
      ],
      ["crates/foo/Cargo.toml"],
    );
    expect(projects["crates/foo"].projectType).toBe("application");
    expect(projects["crates/foo"].tags).toEqual(["cargo", "type:bin"]);
  });

  it("de-duplicates repeated tags while preserving first-seen order", async () => {
    expect(
      await inferTagsFor({ metadata: { nxrust: { tags: ["cargo", "cargo", "rust"] } } }),
    ).toEqual(["cargo", "rust"]);
  });

  it("omits tags when the crate has no package metadata", async () => {
    expect(await inferTagsFor({})).toBeUndefined();
  });

  it("omits tags when package metadata is explicitly null", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(await inferTagsFor({ metadata: null })).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("omits tags when the nxrust value is an array, not a table", async () => {
    expect(await inferTagsFor({ metadata: { nxrust: ["cargo"] } })).toBeUndefined();
  });

  it("omits tags when the nxrust table has no tags key", async () => {
    expect(await inferTagsFor({ metadata: { nxrust: { project: "foo" } } })).toBeUndefined();
  });

  it("omits tags for an empty tags array", async () => {
    expect(await inferTagsFor({ metadata: { nxrust: { tags: [] } } })).toBeUndefined();
  });

  it("lifts tags even when other reserved nxrust keys are present", async () => {
    expect(
      await inferTagsFor({
        metadata: { nxrust: { tags: ["cargo"], project: "foo", "test-runner": "nextest" } },
      }),
    ).toEqual(["cargo"]);
  });

  it("does not warn on valid input", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    await inferTagsFor({ metadata: { nxrust: { tags: ["cargo"] } } });
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns and ignores a non-array tags value instead of throwing", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(await inferTagsFor({ metadata: { nxrust: { tags: "cargo" } } })).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[nxrust] foo"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("expected an array of strings"));
  });

  it("warns and ignores a tags array containing non-strings (incl. nested arrays)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(
      await inferTagsFor({ metadata: { nxrust: { tags: ["cargo", 42, ["nested"]] } } }),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("expected an array of strings"));
  });

  it("keeps one malformed crate from suppressing a sibling crate's valid tags", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    await setStatMtimes({
      "/ws/Cargo.lock": 1,
      "/ws/Cargo.toml": 1,
      "/ws/crates/foo/Cargo.toml": 1,
      "/ws/crates/bar/Cargo.toml": 1,
    });
    const projects = await inferProjects(
      [
        pkg({ name: "foo", metadata: { nxrust: { tags: "oops" } } }),
        pkg({ name: "bar", metadata: { nxrust: { tags: ["cargo", "ok"] } } }),
      ],
      ["crates/foo/Cargo.toml", "crates/bar/Cargo.toml"],
    );
    // The malformed `foo` warns and gets no tags; `bar` is unaffected.
    expect(projects["crates/foo"].tags).toBeUndefined();
    expect(projects["crates/bar"].tags).toEqual(["cargo", "ok"]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("preserves tags on the cache-hit path (second createNodesV2 call)", async () => {
    await setMetadata(md([pkg({ name: "foo", metadata: { nxrust: { tags: ["cargo"] } } })]));
    const { createNodesV2 } = await load();
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<Array<[string, { projects: Record<string, { tags?: string[] }> }]>>;
    const ctx = { workspaceRoot: ws, nxJsonConfiguration: {} };

    await fn(["crates/foo/Cargo.toml"], {}, ctx);
    // Second call with unchanged mtimes hits the metadata cache.
    const second = await fn(["crates/foo/Cargo.toml"], {}, ctx);
    expect(second[0][1].projects["crates/foo"].tags).toEqual(["cargo"]);
  });
});
