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
  ];
  for (const manifest of knownManifests) {
    parts.push(fileFingerprint(manifest));
  }
  return parts.join('|');
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

function computeCached(workspaceRoot: string): GraphComputation {
  const cached = metadataCache.get(workspaceRoot);
  const knownManifests = cached
    ? workspaceManifests(cached.result.metadata, workspaceRoot)
    : [];
  const current = workspaceFingerprint(workspaceRoot, knownManifests);
  if (cached && cached.fingerprint === current) {
    return cached.result;
  }

  const result = computeGraph(workspaceRoot);
  // Re-fingerprint with the freshly discovered manifests so subsequent
  // calls invalidate when *any* of them changes.
  const nextFingerprint = workspaceFingerprint(
    workspaceRoot,
    workspaceManifests(result.metadata, workspaceRoot),
  );
  metadataCache.set(workspaceRoot, {
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
    const computed = computeCached(context.workspaceRoot);
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
  const { metadata } = computeCached(workspaceRoot);
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

function computeGraph(workspaceRoot: string): GraphComputation {
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
    projects[root] = inferProjectConfig(pkg, root);

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
): ProjectConfiguration {
  const hasBin = pkg.targets.some((t) => t.kind.includes('bin'));
  const isPrivate = pkg.publish?.length === 0;

  const targets: ProjectConfiguration['targets'] = {
    build: buildTargetConfig(),
    check: checkTargetConfig(),
    clippy: clippyTargetConfig(),
    // `fmt` rewrites files (uncached); `fmt-check` is the lint mode that
    // caches safely because its output is just an exit status.
    fmt: fmtTargetConfig(),
    'fmt-check': fmtCheckTargetConfig(),
    test: testTargetConfig(),
  };

  if (hasBin) {
    targets.run = runTargetConfig();
  }

  if (!isPrivate) {
    targets['nx-release-publish'] = {
      dependsOn: ['^nx-release-publish'],
      executor: '@eddacraft/nxrust:release-publish',
      options: {},
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
