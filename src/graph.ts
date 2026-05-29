import {
  createNodesFromFiles,
  normalizePath,
  type CreateDependencies,
  type CreateDependenciesContext,
  type CreateNodesContextV2,
  type CreateNodesResultV2,
  type CreateNodesV2,
  type ProjectConfiguration,
  type RawProjectGraphDependency,
} from '@nx/devkit';
import {
  DependencyType,
  type ProjectGraphExternalNode,
} from 'nx/src/config/project-graph';
import { statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type {
  CargoMetadata,
  CargoPackage,
} from './models/cargo-metadata';
import { cargoMetadata, isExternal } from './utils/cargo';
import { resolveToolchain } from './utils/rust-toolchain';
import {
  buildTargetConfig,
  checkTargetConfig,
  clippyTargetConfig,
  fmtCheckTargetConfig,
  fmtTargetConfig,
  runTargetConfig,
  testTargetConfig,
} from './utils/target-configs';

/**
 * Glob that matches any Cargo.toml in the workspace. Nx invokes
 * `createNodesV2` with every matching file — the glob is just the filter.
 */
const CARGO_GLOB = '**/Cargo.toml';

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
const metadataCache = new Map<
  string,
  { fingerprint: string; result: GraphComputation }
>();

function metadataCacheKey(
  workspaceRoot: string,
  options: NxRustPluginOptions,
): string {
  return `${workspaceRoot}|narrowBuildOutputs:${options.narrowBuildOutputs !== false}`;
}

function fileFingerprint(path: string): string {
  try {
    return `${path}:${statSync(path).mtimeMs}`;
  } catch {
    return `${path}:missing`;
  }
}

function workspaceFingerprint(
  workspaceRoot: string,
  knownManifests: readonly string[],
): string {
  const parts = [
    fileFingerprint(join(workspaceRoot, 'Cargo.lock')),
    fileFingerprint(join(workspaceRoot, 'Cargo.toml')),
    fileFingerprint(join(workspaceRoot, 'rust-toolchain.toml')),
    fileFingerprint(join(workspaceRoot, 'rust-toolchain')),
  ];
  for (const manifest of knownManifests) {
    parts.push(fileFingerprint(manifest));
    for (const dir of toolchainSearchDirs(dirname(manifest), workspaceRoot)) {
      parts.push(fileFingerprint(join(dir, 'rust-toolchain.toml')));
      parts.push(fileFingerprint(join(dir, 'rust-toolchain')));
    }
  }
  return parts.join('|');
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

function workspaceManifests(
  metadata: CargoMetadata | null,
  workspaceRoot: string,
): string[] {
  if (!metadata) return [];
  return metadata.packages
    .filter((p) => !isExternal(p, workspaceRoot))
    .map((p) => p.manifest_path);
}

function computeCached(
  workspaceRoot: string,
  requestedConfigFiles: readonly string[] = [],
  options: NxRustPluginOptions = {},
): GraphComputation {
  const cacheKey = metadataCacheKey(workspaceRoot, options);
  const cached = metadataCache.get(cacheKey);
  const knownManifests = cached
    ? workspaceManifests(cached.result.metadata, workspaceRoot)
    : [];
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
    const computed = computeCached(
      context.workspaceRoot,
      configFilePaths,
      pluginOptions ?? {},
    );
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

export const createDependencies: CreateDependencies = (
  _opts,
  ctx: CreateDependenciesContext,
) => {
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
      if (dep.kind === 'dev') continue;

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

function computeGraph(
  workspaceRoot: string,
  options: NxRustPluginOptions,
): GraphComputation {
  const metadata = cargoMetadata(workspaceRoot);
  if (!metadata) {
    return { projects: {}, externalNodes: {}, metadata: null };
  }

  const projects: Record<string, ProjectConfiguration> = {};
  const externalNodes: Record<string, ProjectGraphExternalNode> = {};

  const versionByPackage = indexVersions(metadata);

  for (const pkg of metadata.packages) {
    if (isExternal(pkg, workspaceRoot)) continue;

    const root = normalizePath(
      dirname(relative(workspaceRoot, pkg.manifest_path)),
    );
    projects[root] = inferProjectConfig(pkg, root, workspaceRoot, options);

    // Only create external nodes for DIRECT deps of workspace members. If we
    // scanned every package's deps, transitive registry crates would show up
    // as graph nodes the workspace doesn't actually depend on.
    for (const dep of pkg.dependencies) {
      if (dep.kind === 'dev') continue;
      if (!isExternal(dep, workspaceRoot)) continue;
      const name = `cargo:${dep.name}`;
      if (externalNodes[name]) continue;
      externalNodes[name] = {
        type: 'cargo' as ProjectGraphExternalNode['type'],
        name: name as ProjectGraphExternalNode['name'],
        data: {
          packageName: dep.name,
          version: versionByPackage.get(dep.name) ?? dep.req ?? '0.0.0',
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
  const hasBin = pkg.targets.some((t) => t.kind.includes('bin'));
  const isPrivate = pkg.publish?.length === 0;

  // Pin the cargo package name on every target. When another Nx plugin (e.g.
  // `@nx/js` for napi-rs bindings) claims the project name from package.json,
  // Nx renames the inferred project to the JS package name and the cargo
  // executor would otherwise feed that scoped/prerelease string to
  // `cargo -p`, which cargo rejects.
  const pkgOpts = { package: pkg.name };
  const buildOutputs = buildOutputsForPackage(pkg);
  if (pluginOptions.narrowBuildOutputs === false) {
    buildOutputs.narrowBuildOutputs = false;
  }
  const cache = {
    resolvedToolchain: resolveToolchain({
      projectRoot: join(workspaceRoot, root),
      workspaceRoot,
    }).channel,
  };

  const targets: ProjectConfiguration['targets'] = {
    build: buildTargetConfig(pkgOpts, cache, buildOutputs),
    check: checkTargetConfig(pkgOpts, cache),
    clippy: clippyTargetConfig(pkgOpts, cache),
    // `fmt` rewrites files (uncached); `fmt-check` is the lint mode that
    // caches safely because its output is just an exit status.
    fmt: fmtTargetConfig(pkgOpts),
    'fmt-check': fmtCheckTargetConfig(pkgOpts, cache),
    test: testTargetConfig(pkgOpts, cache),
  };

  if (hasBin) {
    targets.run = runTargetConfig(pkgOpts);
  }

  if (!isPrivate) {
    targets['nx-release-publish'] = {
      dependsOn: ['^nx-release-publish'],
      executor: '@eddacraft/nxrust:release-publish',
      options: { ...pkgOpts },
    };
  }

  return {
    root,
    name: pkg.name,
    projectType: hasBin ? 'application' : 'library',
    sourceRoot: `${root}/src`,
    targets,
  };
}

function buildOutputsForPackage(pkg: CargoPackage): {
  binaries?: string[];
  libraries?: string[];
  narrowBuildOutputs?: boolean;
} {
  const unsupportedLibrary = pkg.targets.some(
    (target) =>
      !target.kind.includes('bin') &&
      target.crate_types.some((crateType) => !['lib', 'rlib'].includes(crateType)),
  );
  if (unsupportedLibrary) return { narrowBuildOutputs: false };

  const binaries = pkg.targets
    .filter((target) => target.kind.includes('bin'))
    .map((target) => target.name);
  const libraries = pkg.targets
    .filter((target) => target.kind.includes('lib'))
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
