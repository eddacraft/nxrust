import {
  createNodesFromFiles,
  logger,
  normalizePath,
  type CreateDependencies,
  type CreateDependenciesContext,
  type CreateNodesContextV2,
  type CreateNodesResultV2,
  type CreateNodesV2,
  type ProjectConfiguration,
  type RawProjectGraphDependency,
} from "@nx/devkit";
import { DependencyType, type ProjectGraphExternalNode } from "nx/src/config/project-graph";
import { statSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { CargoMetadata, CargoPackage } from "./models/cargo-metadata";
import { cargoMetadata, isExternal } from "./utils/cargo";
import { resolveToolchain, validateChannelLiteral } from "./utils/rust-toolchain";
import {
  buildTargetConfig,
  checkTargetConfig,
  clippyTargetConfig,
  fmtCheckTargetConfig,
  fmtTargetConfig,
  runTargetConfig,
  testTargetConfig,
} from "./utils/target-configs";

/**
 * Glob that matches any Cargo.toml in the workspace. Nx invokes
 * `createNodesV2` with every matching file — the glob is just the filter.
 */
const CARGO_GLOB = "**/Cargo.toml";

interface GraphComputation {
  projects: Record<string, ProjectConfiguration>;
  externalNodes: Record<string, ProjectGraphExternalNode>;
  /** Cached cargo metadata so `createDependencies` reuses it. */
  metadata: CargoMetadata | null;
}

interface NxRustPluginOptions {
  narrowBuildOutputs?: boolean;
}

/**
 * Cache `cargo metadata` per workspace root — Nx calls `createNodesV2` once per
 * matched Cargo.toml, and would otherwise spawn cargo N times per graph
 * recompute.
 *
 * The cache key is a fingerprint over every manifest that affects the result:
 * `Cargo.lock`, the root `Cargo.toml`, and each workspace member's
 * `Cargo.toml` known from the prior metadata snapshot. Lockfile mtime alone
 * is not sufficient — manifest edits (member adds, target/feature changes,
 * package renames) can shift the graph without touching the lockfile, and
 * fresh workspaces have no lockfile at all. Under the Nx daemon a stale cache
 * survives across invocations, so missing those signals corrupts
 * `nx affected`.
 */
const metadataCache = new Map<string, { fingerprint: string; result: GraphComputation }>();

function metadataCacheKey(workspaceRoot: string, options: NxRustPluginOptions): string {
  // `CARGO_TARGET_DIR` feeds the inferred build outputs (D-C7), so a change to
  // it must invalidate the in-process graph cache — otherwise a relocated dir
  // would inherit outputs computed for the previous location under the daemon.
  return (
    `${workspaceRoot}|narrowBuildOutputs:${options.narrowBuildOutputs !== false}` +
    `|targetDir:${process.env.CARGO_TARGET_DIR ?? ""}`
  );
}

/**
 * Resolve the Nx output-token root cargo writes build artefacts under when a
 * `CARGO_TARGET_DIR` relocation is in effect. cargo's `--target-dir` option
 * takes precedence and is handled per-target in `target-configs.ts`; here we
 * cover the env var, which the plugin reads at inference time. A dir inside the
 * workspace is expressed workspace-relative so the token stays portable across
 * machines; an external dir uses its absolute path. Returns `undefined` for the
 * default `target/`, so callers fall back to `{workspaceRoot}/target`. See D-C7.
 */
function resolveEnvTargetDirRoot(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CARGO_TARGET_DIR?.trim();
  if (!raw) return undefined;
  const absRoot = isAbsolute(raw) ? raw : join(workspaceRoot, raw);
  const rel = relative(workspaceRoot, absRoot);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    return `{workspaceRoot}/${normalizePath(rel)}`;
  }
  return normalizePath(absRoot);
}

function fileFingerprint(path: string): string {
  try {
    return `${path}:${statSync(path).mtimeMs}`;
  } catch {
    return `${path}:missing`;
  }
}

function workspaceFingerprint(workspaceRoot: string, knownManifests: readonly string[]): string {
  const parts = [
    fileFingerprint(join(workspaceRoot, "Cargo.lock")),
    fileFingerprint(join(workspaceRoot, "Cargo.toml")),
    fileFingerprint(join(workspaceRoot, "rust-toolchain.toml")),
    fileFingerprint(join(workspaceRoot, "rust-toolchain")),
  ];
  for (const manifest of knownManifests) {
    parts.push(fileFingerprint(manifest));
    for (const dir of toolchainSearchDirs(dirname(manifest), workspaceRoot)) {
      parts.push(fileFingerprint(join(dir, "rust-toolchain.toml")));
      parts.push(fileFingerprint(join(dir, "rust-toolchain")));
    }
  }
  return parts.join("|");
}

function toolchainSearchDirs(projectRoot: string, workspaceRoot: string): string[] {
  const dirs: string[] = [];
  let dir = projectRoot;

  while (true) {
    dirs.push(dir);
    if (dir === workspaceRoot) break;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return dirs;
}

function workspaceManifests(metadata: CargoMetadata | null, workspaceRoot: string): string[] {
  if (!metadata) return [];
  return metadata.packages.filter((p) => !isExternal(p, workspaceRoot)).map((p) => p.manifest_path);
}

function computeCached(
  workspaceRoot: string,
  requestedConfigFiles: readonly string[] = [],
  options: NxRustPluginOptions = {},
): GraphComputation {
  const cacheKey = metadataCacheKey(workspaceRoot, options);
  const cached = metadataCache.get(cacheKey);
  const knownManifests = cached ? workspaceManifests(cached.result.metadata, workspaceRoot) : [];
  const current = workspaceFingerprint(workspaceRoot, knownManifests);
  if (
    cached &&
    cached.fingerprint === current &&
    requestedConfigFiles.every((path) => pickProjectForConfigFile(cached.result.projects, path))
  ) {
    return cached.result;
  }

  const result = computeGraph(workspaceRoot, options);
  // Re-fingerprint with the freshly discovered manifests so subsequent
  // calls invalidate when *any* of them changes.
  const nextFingerprint = workspaceFingerprint(
    workspaceRoot,
    workspaceManifests(result.metadata, workspaceRoot),
  );
  metadataCache.set(cacheKey, {
    fingerprint: nextFingerprint,
    result,
  });
  return result;
}

/**
 * Project-graph plugin: for every Cargo.toml in the workspace, materialise a
 * project with cargo-backed targets (build/check/clippy/fmt/test, plus `run`
 * for binary crates). Dependencies between workspace members and external
 * registry/git crates are published via `createDependencies`.
 *
 * Invariant: the Nx project name of a crate must equal its Cargo package
 * name. `inferProjectConfig` sets `name: pkg.name`, and `createDependencies`
 * assumes Nx has re-keyed the graph by that name. Workspaces that override
 * the name via a `project.json` will lose dependency edges from that project.
 */
export const createNodesV2: CreateNodesV2 = [
  CARGO_GLOB,
  async (configFilePaths, options, context) => {
    const pluginOptions = options as NxRustPluginOptions | undefined;
    const computed = computeCached(context.workspaceRoot, configFilePaths, pluginOptions ?? {});
    // `externalNodes` is a single graph-wide payload — attaching the same map
    // to every file result works (Nx dedupes by key) but wastes IPC. Emit it
    // with the first file we actually produce and blank on the rest.
    let externalsEmitted = false;

    return createNodesFromFiles(
      async (configFile) => {
        const projects = pickProjectForConfigFile(computed.projects, configFile);
        if (!projects) {
          return { projects: {}, externalNodes: {} };
        }
        const externalNodes = externalsEmitted ? {} : computed.externalNodes;
        externalsEmitted = true;
        return { projects, externalNodes };
      },
      configFilePaths,
      options,
      context as CreateNodesContextV2,
    ) as Promise<CreateNodesResultV2>;
  },
];

export const createDependencies: CreateDependencies = (_opts, ctx: CreateDependenciesContext) => {
  const { projects, externalNodes, workspaceRoot } = ctx;
  const { metadata } = computeCached(workspaceRoot, [], _opts as NxRustPluginOptions);
  if (!metadata) return [];

  const out: RawProjectGraphDependency[] = [];

  for (const pkg of metadata.packages) {
    // Skip registry/git/out-of-tree packages so a transitive crate that
    // happens to share a workspace member's name cannot inject false edges
    // into the workspace project's dependency list.
    if (isExternal(pkg, workspaceRoot)) continue;
    // Nx re-keys projects by `name` after `createNodesV2` emits them keyed by
    // root; the lookup below relies on that transform.
    if (!projects[pkg.name]) continue;

    for (const dep of pkg.dependencies) {
      // Dev deps shouldn't retrigger rebuilds of downstream projects.
      if (dep.kind === "dev") continue;

      if (projects[dep.name]) {
        out.push(makeDependency(pkg, dep.name, workspaceRoot));
        continue;
      }
      const externalName = `cargo:${dep.name}`;
      if (externalNodes?.[externalName]) {
        out.push(makeDependency(pkg, externalName, workspaceRoot));
      }
    }
  }

  return out;
};

function computeGraph(workspaceRoot: string, options: NxRustPluginOptions): GraphComputation {
  const metadata = cargoMetadata(workspaceRoot);
  if (!metadata) {
    return { projects: {}, externalNodes: {}, metadata: null };
  }

  const projects: Record<string, ProjectConfiguration> = {};
  const externalNodes: Record<string, ProjectGraphExternalNode> = {};

  const versionByPackage = indexVersions(metadata);

  for (const pkg of metadata.packages) {
    if (isExternal(pkg, workspaceRoot)) continue;

    const root = normalizePath(dirname(relative(workspaceRoot, pkg.manifest_path)));
    projects[root] = inferProjectConfig(pkg, root, workspaceRoot, options);

    // Only create external nodes for DIRECT deps of workspace members. If we
    // scanned every package's deps, transitive registry crates would show up
    // as graph nodes the workspace doesn't actually depend on.
    for (const dep of pkg.dependencies) {
      if (dep.kind === "dev") continue;
      if (!isExternal(dep, workspaceRoot)) continue;
      const name = `cargo:${dep.name}`;
      if (externalNodes[name]) continue;
      externalNodes[name] = {
        type: "cargo" as ProjectGraphExternalNode["type"],
        name: name as ProjectGraphExternalNode["name"],
        data: {
          packageName: dep.name,
          version: versionByPackage.get(dep.name) ?? dep.req ?? "0.0.0",
        },
      };
    }
  }

  return { projects, externalNodes, metadata };
}

/**
 * Build a default project configuration from a cargo package. We infer
 * library vs. application from the crate's targets — a package with any
 * `bin` target is treated as an application and gets a `run` target wired
 * up. Consumers can still override everything via project.json.
 */
function inferProjectConfig(
  pkg: CargoPackage,
  root: string,
  workspaceRoot: string,
  pluginOptions: NxRustPluginOptions,
): ProjectConfiguration {
  const hasBin = pkg.targets.some((t) => t.kind.includes("bin"));
  const isPrivate = pkg.publish?.length === 0;

  // Pin the cargo package name on every target. When another Nx plugin (e.g.
  // `@nx/js` for napi-rs bindings) claims the project name from package.json,
  // Nx renames the inferred project to the JS package name and the cargo
  // executor would otherwise feed that scoped/prerelease string to
  // `cargo -p`, which cargo rejects.
  const pkgOpts = { package: pkg.name };
  const buildOutputs = buildOutputsForPackage(pkg);
  // A `CARGO_TARGET_DIR` relocation moves the artefact root for every crate;
  // narrow outputs follow it instead of falling back to a safe cache miss
  // (D-C7). A per-target `--target-dir` option still wins over this in
  // `target-configs.ts`.
  const envTargetDirRoot = resolveEnvTargetDirRoot(workspaceRoot);
  if (envTargetDirRoot) buildOutputs.targetDirRoot = envTargetDirRoot;
  if (pluginOptions.narrowBuildOutputs === false) {
    buildOutputs.narrowBuildOutputs = false;
  }
  // File-walk resolution happens once per crate; metadata toolchain overrides
  // (D-TC2 steps 3-4) are validated literals layered on top per target, so no
  // extra filesystem walks are needed.
  const baseToolchain = resolveToolchain({
    projectRoot: join(workspaceRoot, root),
    workspaceRoot,
  }).channel;

  const inferredNames = [
    "build",
    "check",
    "clippy",
    "fmt",
    "fmt-check",
    "test",
    ...(hasBin ? ["run"] : []),
    ...(isPrivate ? [] : ["nx-release-publish"]),
  ];
  const overrides = inferTargetOverrides(pkg, inferredNames);
  const packageToolchain = packageLevelToolchain(pkg);

  // Merged executor options for one inferred target: sanitised metadata
  // defaults first, the package pin last so it can never be overridden
  // (D-T3). An explicitly overridden toolchain (target > package, D-TC2)
  // lands in the options so the executor invokes `cargo +<channel>`; the
  // file-walk channel does not — rustup applies it natively at run time.
  function optsFor(name: string): Record<string, unknown> {
    const table = { ...(overrides[name] ?? {}) };
    const effective = (table.toolchain as string | undefined) ?? packageToolchain;
    if (effective !== undefined) table.toolchain = effective;
    return { ...table, ...pkgOpts };
  }

  // Cache inputs for one inferred target. The overridden channel must also
  // drive the `rustup run <channel> rustc -Vv` runtime input — hashing the
  // default toolchain's version while running another channel would let
  // toolchain updates slip past the cache key (D-TC3).
  function cacheFor(name: string): { resolvedToolchain: string } {
    const effective = (overrides[name]?.toolchain as string | undefined) ?? packageToolchain;
    return { resolvedToolchain: effective ?? baseToolchain };
  }

  const targets: ProjectConfiguration["targets"] = {
    build: buildTargetConfig(optsFor("build"), cacheFor("build"), buildOutputs),
    check: checkTargetConfig(optsFor("check"), cacheFor("check")),
    clippy: clippyTargetConfig(optsFor("clippy"), cacheFor("clippy")),
    // `lint` is an exact alias of `clippy` (D-T4) so ecosystem-wide
    // invocations like `nx run-many -t lint` include Rust crates alongside
    // JS projects. `clippy` stays the canonical name; its metadata table
    // drives both targets so the alias never diverges.
    lint: clippyTargetConfig(optsFor("clippy"), cacheFor("clippy")),
    // `fmt` rewrites files (uncached); `fmt-check` is the lint mode that
    // caches safely because its output is just an exit status.
    fmt: fmtTargetConfig(optsFor("fmt")),
    "fmt-check": fmtCheckTargetConfig(optsFor("fmt-check"), cacheFor("fmt-check")),
    test: testTargetConfig(optsFor("test"), cacheFor("test")),
  };

  if (hasBin) {
    targets.run = runTargetConfig(optsFor("run"));
  }

  if (!isPrivate) {
    targets["nx-release-publish"] = {
      dependsOn: ["^nx-release-publish"],
      executor: "@eddacraft/nxrust:release-publish",
      options: optsFor("nx-release-publish"),
    };
  }

  const tags = inferTags(pkg);

  return {
    root,
    name: pkg.name,
    projectType: hasBin ? "application" : "library",
    sourceRoot: `${root}/src`,
    // Only attach `tags` when the crate actually declares them, so crates
    // without the metadata key keep emitting an untagged config and Nx's
    // project.json merge is untouched.
    ...(tags ? { tags } : {}),
    targets,
  };
}

/**
 * The `[package.metadata.nxrust]` table, as surfaced by `cargo metadata`
 * (Cargo serialises `[package.metadata]` straight into the package JSON).
 * Reading it from the metadata we already have keeps `cargo metadata` the
 * single authoritative source (D-G1) — no second TOML read of the manifest.
 */
function nxrustMetadata(pkg: CargoPackage): Record<string, unknown> | undefined {
  const metadata = pkg.metadata;
  // `typeof [] === 'object'`, so arrays must be excluded explicitly — a TOML
  // `metadata = [...]` or `nxrust = [...]` must not be treated as a table.
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const nxrust = (metadata as Record<string, unknown>).nxrust;
  if (!nxrust || typeof nxrust !== "object" || Array.isArray(nxrust)) {
    return undefined;
  }
  return nxrust as Record<string, unknown>;
}

/**
 * Lift `package.metadata.nxrust.tags` into the inferred project's Nx tags so a
 * pure-Cargo crate acquires tags with no `project.json` (GRAPH-001, D-G4). Nx
 * then merges these with any `project.json` tags via its own
 * `mergeProjectConfigurations` (which unions and de-duplicates across sources)
 * — that cross-source merge is Nx's behaviour, not this plugin's, and is
 * covered by the e2e rather than these unit tests.
 *
 * A malformed `tags` value (not an array of strings) warns and is ignored
 * rather than throwing — one bad manifest must not break graph construction
 * for the whole workspace. Unknown sibling keys (e.g. `project`,
 * `test-runner`) are left untouched here; warning on them is deferred to the
 * 14-diagnostics work, which owns the diagnostic channel and the finalised
 * known-key set defined by modules 03/05.
 */
function inferTags(pkg: CargoPackage): string[] | undefined {
  const nxrust = nxrustMetadata(pkg);
  if (!nxrust || !("tags" in nxrust)) return undefined;

  const tags = nxrust.tags;
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
    logger.warn(
      `[nxrust] ${pkg.name}: ignoring \`package.metadata.nxrust.tags\` — ` +
        `expected an array of strings.`,
    );
    return undefined;
  }

  const unique = [...new Set(tags as string[])];
  return unique.length > 0 ? unique : undefined;
}

/**
 * Read and sanitise `package.metadata.nxrust.targets.<name>` tables into
 * per-target executor option defaults (TARGETS-002). Inherits GRAPH-001's
 * resilience contract: malformed shapes warn and are ignored — one bad
 * manifest never breaks graph construction for the whole workspace.
 *
 * Sanitisation rules:
 * - A target name that is not inferred for this crate (typo, or `run` on a
 *   library crate) warns and is skipped.
 * - `lint` warns and is skipped: it mirrors `clippy` (D-T4), so the `clippy`
 *   table drives both and the alias can never diverge.
 * - `package` is stripped everywhere: the cargo package pin is a contract
 *   (D-T3), not a default.
 * - `check` is stripped from `fmt-check`: the target is cacheable, and a
 *   `check = false` would turn it into a file-mutating cached target.
 * - A non-string `toolchain` or one that fails channel-literal validation
 *   warns and is stripped (the cache key would otherwise embed an unusable
 *   `rustup run` invocation).
 */
function inferTargetOverrides(
  pkg: CargoPackage,
  inferredNames: readonly string[],
): Record<string, Record<string, unknown>> {
  const nxrust = nxrustMetadata(pkg);
  const targets = nxrust?.targets;
  if (targets === undefined) return {};
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) {
    logger.warn(
      `[nxrust] ${pkg.name}: ignoring \`package.metadata.nxrust.targets\` — ` +
        `expected a table of per-target option tables.`,
    );
    return {};
  }

  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, value] of Object.entries(targets)) {
    if (name === "lint") {
      logger.warn(
        `[nxrust] ${pkg.name}: ignoring \`package.metadata.nxrust.targets.lint\` — ` +
          `\`lint\` mirrors \`clippy\`; customise \`targets.clippy\` instead.`,
      );
      continue;
    }
    if (!inferredNames.includes(name)) {
      logger.warn(
        `[nxrust] ${pkg.name}: ignoring \`package.metadata.nxrust.targets.${name}\` — ` +
          `no inferred target with that name on this crate.`,
      );
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      logger.warn(
        `[nxrust] ${pkg.name}: ignoring \`package.metadata.nxrust.targets.${name}\` — ` +
          `expected a table of option defaults.`,
      );
      continue;
    }

    const table = { ...(value as Record<string, unknown>) };
    if ("package" in table) {
      logger.warn(
        `[nxrust] ${pkg.name}: ignoring \`package\` in ` +
          `\`package.metadata.nxrust.targets.${name}\` — the cargo package ` +
          `name is pinned and cannot be overridden.`,
      );
      delete table.package;
    }
    if (name === "fmt-check" && "check" in table) {
      logger.warn(
        `[nxrust] ${pkg.name}: ignoring \`check\` in ` +
          `\`package.metadata.nxrust.targets.fmt-check\` — the target is ` +
          `cacheable and must not mutate files.`,
      );
      delete table.check;
    }
    if ("toolchain" in table && !validToolchainOverride(pkg, table.toolchain, `targets.${name}`)) {
      delete table.toolchain;
    }
    out[name] = table;
  }
  return out;
}

/** `package.metadata.nxrust.toolchain` — D-TC2 step 4 — if present and valid. */
function packageLevelToolchain(pkg: CargoPackage): string | undefined {
  const nxrust = nxrustMetadata(pkg);
  if (!nxrust || !("toolchain" in nxrust)) return undefined;
  return validToolchainOverride(pkg, nxrust.toolchain, "toolchain")
    ? (nxrust.toolchain as string)
    : undefined;
}

function validToolchainOverride(pkg: CargoPackage, value: unknown, key: string): value is string {
  if (typeof value !== "string") {
    logger.warn(
      `[nxrust] ${pkg.name}: ignoring \`package.metadata.nxrust.${key}\` ` +
        `toolchain — expected a string channel literal.`,
    );
    return false;
  }
  try {
    validateChannelLiteral(value, `package.metadata.nxrust.${key}`);
    return true;
  } catch (error) {
    logger.warn(
      `[nxrust] ${pkg.name}: ignoring \`package.metadata.nxrust.${key}\` ` +
        `toolchain — ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

// Cargo target `kind` values that denote a library artefact (as opposed to
// `bin`, `example`, `test`, `bench`, `custom-build`). Used to decide whether a
// crate's library output can be expressed as a narrow per-rlib path.
const LIBRARY_KINDS = ["lib", "rlib", "dylib", "cdylib", "staticlib", "proc-macro"];

function buildOutputsForPackage(pkg: CargoPackage): {
  binaries?: string[];
  libraries?: string[];
  narrowBuildOutputs?: boolean;
  targetDirRoot?: string;
} {
  // Only genuine library targets gate the narrowing. `cargo metadata` also
  // reports build scripts (`custom-build`), examples, integration tests, and
  // benchmarks as targets whose `kind` lacks `bin` but whose `crate_types` is
  // `["bin"]` — matching those here would wrongly drop any crate with a
  // build.rs / examples / tests / benches back to wide outputs. We fall back
  // to wide outputs only when a library target emits something `cargo build`
  // places at a path the per-rlib rule cannot express (cdylib, staticlib,
  // proc-macro, dylib).
  const unsupportedLibrary = pkg.targets.some(
    (target) =>
      target.kind.some((kind) => LIBRARY_KINDS.includes(kind)) &&
      target.crate_types.some((crateType) => !["lib", "rlib"].includes(crateType)),
  );
  if (unsupportedLibrary) return { narrowBuildOutputs: false };

  const binaries = pkg.targets
    .filter((target) => target.kind.includes("bin"))
    .map((target) => target.name);
  const libraries = pkg.targets
    .filter((target) => target.kind.includes("lib"))
    .map((target) => target.name);

  return { binaries, libraries };
}

function pickProjectForConfigFile(
  projects: Record<string, ProjectConfiguration>,
  configFile: string,
): Record<string, ProjectConfiguration> | null {
  const dir = normalizePath(dirname(configFile));
  const match = projects[dir];
  return match ? { [dir]: match } : null;
}

function indexVersions(metadata: CargoMetadata): Map<string, string> {
  const out = new Map<string, string>();
  for (const pkg of metadata.packages) {
    if (!out.has(pkg.name)) out.set(pkg.name, pkg.version);
  }
  return out;
}

function makeDependency(
  pkg: CargoPackage,
  targetName: string,
  workspaceRoot: string,
): RawProjectGraphDependency {
  const normalizedRoot = normalizePath(workspaceRoot);
  const manifest = normalizePath(pkg.manifest_path);
  const sourceFile = manifest.startsWith(`${normalizedRoot}/`)
    ? manifest.slice(normalizedRoot.length + 1)
    : manifest;
  return {
    type: DependencyType.static,
    source: pkg.name,
    target: targetName,
    sourceFile,
  };
}

/** Exposed for tests to reset the module-level metadata cache. */
export function __resetGraphCacheForTests(): void {
  metadataCache.clear();
}
