import type { CreateDependenciesContext } from '@nx/devkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CargoMetadata } from './models/cargo-metadata';

// Mock `cargoMetadata` so tests don't invoke the real cargo binary.
vi.mock('./utils/cargo', async () => {
  const actual = await vi.importActual<typeof import('./utils/cargo')>(
    './utils/cargo',
  );
  return {
    ...actual,
    cargoMetadata: vi.fn(),
  };
});

// Mock `node:fs` statSync so cache-fingerprint tests can drive mtime values
// without touching the real filesystem.
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

async function load() {
  const graph = await import('./graph');
  graph.__resetGraphCacheForTests();
  return graph;
}

async function setMetadata(metadata: CargoMetadata | null) {
  const cargo = await import('./utils/cargo');
  (cargo.cargoMetadata as ReturnType<typeof vi.fn>).mockReturnValue(metadata);
}

async function cargoMetadataMock() {
  const cargo = await import('./utils/cargo');
  return cargo.cargoMetadata as ReturnType<typeof vi.fn>;
}

async function setStatMtimes(mtimes: Record<string, number | 'missing'>) {
  const fs = await import('node:fs');
  (fs.statSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    const value = mtimes[path];
    if (value === undefined || value === 'missing') {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }
    return { mtimeMs: value } as ReturnType<typeof import('node:fs').statSync>;
  });
}

const ws = '/ws';

function pkg(over: Partial<CargoMetadata['packages'][0]>): CargoMetadata['packages'][0] {
  return {
    name: 'x',
    version: '0.1.0',
    id: `${over.name ?? 'x'} 0.1.0`,
    dependencies: [],
    targets: [{ kind: ['lib'], crate_types: ['lib'], name: 'x', src_path: '' }],
    features: {},
    manifest_path: `/ws/crates/${over.name ?? 'x'}/Cargo.toml`,
    ...over,
  };
}

function md(packages: CargoMetadata['packages']): CargoMetadata {
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

describe('createDependencies', () => {
  beforeEach(async () => {
    const { __resetGraphCacheForTests } = await load();
    __resetGraphCacheForTests();
    await setStatMtimes({
      '/ws/Cargo.lock': 1,
      '/ws/Cargo.toml': 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a static edge between two workspace members with a path dep', async () => {
    await setMetadata(
      md([
        pkg({
          name: 'app',
          targets: [{ kind: ['bin'], crate_types: ['bin'], name: 'app', src_path: '' }],
          dependencies: [
            {
              name: 'lib',
              req: '*',
              path: '/ws/crates/lib',
              source: null,
              optional: false,
              uses_default_features: true,
              features: [],
              kind: null,
            },
          ],
        }),
        pkg({ name: 'lib' }),
      ]),
    );
    const { createDependencies } = await load();

    const ctx: CreateDependenciesContext = {
      workspaceRoot: ws,
      projects: {
        app: { root: 'crates/app', name: 'app' },
        lib: { root: 'crates/lib', name: 'lib' },
      } as never,
      externalNodes: {},
      fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
      nxJsonConfiguration: {},
    };

    const edges = createDependencies({}, ctx);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'app', target: 'lib' });
  });

  it('skips dev-dependencies so they do not trigger downstream rebuilds', async () => {
    await setMetadata(
      md([
        pkg({
          name: 'app',
          dependencies: [
            {
              name: 'lib',
              req: '*',
              path: '/ws/crates/lib',
              source: null,
              optional: false,
              uses_default_features: true,
              features: [],
              kind: 'dev',
            },
          ],
        }),
        pkg({ name: 'lib' }),
      ]),
    );
    const { createDependencies } = await load();

    const ctx: CreateDependenciesContext = {
      workspaceRoot: ws,
      projects: {
        app: { root: 'crates/app', name: 'app' },
        lib: { root: 'crates/lib', name: 'lib' },
      } as never,
      externalNodes: {},
      fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
      nxJsonConfiguration: {},
    };

    expect(createDependencies({}, ctx)).toHaveLength(0);
  });

  it('emits external edges for registry deps', async () => {
    await setMetadata(
      md([
        pkg({
          name: 'app',
          dependencies: [
            {
              name: 'serde',
              req: '^1',
              source: 'registry+https://crates.io',
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
      projects: { app: { root: 'crates/app', name: 'app' } } as never,
      externalNodes: {
        'cargo:serde': {
          type: 'cargo' as never,
          name: 'cargo:serde' as never,
          data: { packageName: 'serde', version: '1.0.0' },
        },
      },
      fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
      nxJsonConfiguration: {},
    };

    const edges = createDependencies({}, ctx);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'app', target: 'cargo:serde' });
  });

  it('returns no edges when cargo metadata is unavailable', async () => {
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

  it('does not emit edges from a registry package that shares a workspace name', async () => {
    // Workspace `lib` (path) + a registry crate also called `lib`, with a
    // dep on `serde`. Without the workspace-membership filter the registry
    // package's deps would be attributed to the workspace `lib` project.
    await setMetadata(
      md([
        pkg({ name: 'lib' }),
        {
          name: 'lib',
          version: '9.9.9',
          id: 'lib 9.9.9 (registry)',
          source: 'registry+https://crates.io',
          manifest_path: '/home/cache/lib-9.9.9/Cargo.toml',
          features: {},
          targets: [
            { kind: ['lib'], crate_types: ['lib'], name: 'lib', src_path: '' },
          ],
          dependencies: [
            {
              name: 'serde',
              req: '^1',
              source: 'registry+https://crates.io',
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
      projects: { lib: { root: 'crates/lib', name: 'lib' } } as never,
      externalNodes: {
        'cargo:serde': {
          type: 'cargo' as never,
          name: 'cargo:serde' as never,
          data: { packageName: 'serde', version: '1.0.0' },
        },
      },
      fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
      nxJsonConfiguration: {},
    };

    expect(createDependencies({}, ctx)).toHaveLength(0);
  });
});

describe('inferred project targets', () => {
  beforeEach(async () => {
    const { __resetGraphCacheForTests } = await load();
    __resetGraphCacheForTests();
    await setStatMtimes({
      '/ws/Cargo.lock': 1,
      '/ws/Cargo.toml': 1,
      '/ws/crates/foo/Cargo.toml': 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pins the cargo package name on every cargo-backed target', async () => {
    // Without an explicit `package` option, the executor falls back to the Nx
    // project name. When `@nx/js` claims the project name from a sibling
    // package.json (e.g. napi-rs bindings) the Nx name becomes `@scope/foo`,
    // which cargo rejects when handed to `-p`. Pinning here keeps the cargo
    // package decoupled from whatever Nx ends up calling the project.
    const publishablePkg = pkg({
      name: 'foo',
      targets: [
        { kind: ['bin'], crate_types: ['bin'], name: 'foo', src_path: '' },
      ],
    });
    await setMetadata(md([publishablePkg]));

    const { createNodesV2 } = await load();
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<
      Array<[string, { projects: Record<string, { targets: Record<string, { options?: { package?: string } }> }> }]>
    >;

    const result = await fn(['crates/foo/Cargo.toml'], {}, {
      workspaceRoot: ws,
      nxJsonConfiguration: {},
    });

    const [, payload] = result[0];
    const project = payload.projects['crates/foo'];
    const expected = ['build', 'check', 'clippy', 'fmt', 'fmt-check', 'test', 'run', 'nx-release-publish'];
    for (const target of expected) {
      expect(
        project.targets[target]?.options?.package,
        `target ${target} should pin the cargo package name`,
      ).toBe('foo');
    }
  });

  it('bakes the resolved rust-toolchain channel into cacheable target runtime inputs', async () => {
    const fs = await import('node:fs');
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      path === '/ws/rust-toolchain.toml',
    );
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      '[toolchain]\nchannel = "stable"\n',
    );
    await setMetadata(md([pkg({ name: 'foo' })]));

    const { createNodesV2 } = await load();
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<
      Array<[
        string,
        { projects: Record<string, { targets: Record<string, { inputs?: unknown[] }> }> },
      ]>
    >;

    const result = await fn(['crates/foo/Cargo.toml'], {}, {
      workspaceRoot: ws,
      nxJsonConfiguration: {},
    });

    const [, payload] = result[0];
    expect(payload.projects['crates/foo'].targets.build.inputs).toContainEqual({
      runtime: 'rustup run stable rustc -Vv',
    });
    expect(payload.projects['crates/foo'].targets.build.inputs).toContainEqual({
      runtime: 'rustup run stable cargo -V',
    });
  });
});

describe('graph cache invalidation', () => {
  beforeEach(async () => {
    const { __resetGraphCacheForTests } = await load();
    __resetGraphCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runCreateNodes(
    graph: Awaited<ReturnType<typeof load>>,
    paths: readonly string[] = ['crates/foo/Cargo.toml'],
  ) {
    const { createNodesV2 } = graph;
    const fn = createNodesV2[1] as (
      paths: readonly string[],
      opts: unknown,
      ctx: { workspaceRoot: string; nxJsonConfiguration: object },
    ) => Promise<unknown>;
    await fn(paths, {}, {
      workspaceRoot: ws,
      nxJsonConfiguration: {},
    });
  }

  it('reuses the cargo metadata cache when no manifest changes', async () => {
    await setStatMtimes({
      '/ws/Cargo.lock': 1,
      '/ws/Cargo.toml': 1,
      '/ws/crates/foo/Cargo.toml': 1,
    });
    await setMetadata(md([pkg({ name: 'foo' })]));
    const cargoFn = await cargoMetadataMock();
    const graph = await load();

    await runCreateNodes(graph);
    await runCreateNodes(graph);

    expect(cargoFn).toHaveBeenCalledTimes(1);
  });

  it('invalidates when the root Cargo.toml changes without a lockfile bump', async () => {
    await setStatMtimes({
      '/ws/Cargo.lock': 1,
      '/ws/Cargo.toml': 1,
      '/ws/crates/foo/Cargo.toml': 1,
    });
    await setMetadata(md([pkg({ name: 'foo' })]));
    const cargoFn = await cargoMetadataMock();
    const graph = await load();

    await runCreateNodes(graph);
    await setStatMtimes({
      '/ws/Cargo.lock': 1,
      '/ws/Cargo.toml': 2, // workspace member added — lockfile not yet refreshed
      '/ws/crates/foo/Cargo.toml': 1,
    });
    await runCreateNodes(graph);

    expect(cargoFn).toHaveBeenCalledTimes(2);
  });

  it("invalidates when a member's Cargo.toml changes without a lockfile bump", async () => {
    await setStatMtimes({
      '/ws/Cargo.lock': 1,
      '/ws/Cargo.toml': 1,
      '/ws/crates/foo/Cargo.toml': 1,
    });
    await setMetadata(md([pkg({ name: 'foo' })]));
    const cargoFn = await cargoMetadataMock();
    const graph = await load();

    await runCreateNodes(graph);
    await setStatMtimes({
      '/ws/Cargo.lock': 1,
      '/ws/Cargo.toml': 1,
      '/ws/crates/foo/Cargo.toml': 5, // crate manifest edited (e.g. target/feature change)
    });
    await runCreateNodes(graph);

    expect(cargoFn).toHaveBeenCalledTimes(2);
  });

  it('invalidates when the workspace rust-toolchain.toml changes', async () => {
    await setStatMtimes({
      '/ws/Cargo.lock': 1,
      '/ws/Cargo.toml': 1,
      '/ws/rust-toolchain.toml': 1,
      '/ws/crates/foo/Cargo.toml': 1,
    });
    await setMetadata(md([pkg({ name: 'foo' })]));
    const cargoFn = await cargoMetadataMock();
    const graph = await load();

    await runCreateNodes(graph);
    await setStatMtimes({
      '/ws/Cargo.lock': 1,
      '/ws/Cargo.toml': 1,
      '/ws/rust-toolchain.toml': 2,
      '/ws/crates/foo/Cargo.toml': 1,
    });
    await runCreateNodes(graph);

    expect(cargoFn).toHaveBeenCalledTimes(2);
  });

  it('invalidates when an intermediate rust-toolchain.toml changes', async () => {
    await setStatMtimes({
      '/ws/Cargo.lock': 1,
      '/ws/Cargo.toml': 1,
      '/ws/crates/rust-toolchain.toml': 1,
      '/ws/crates/foo/Cargo.toml': 1,
    });
    await setMetadata(md([pkg({ name: 'foo' })]));
    const cargoFn = await cargoMetadataMock();
    const graph = await load();

    await runCreateNodes(graph);
    await setStatMtimes({
      '/ws/Cargo.lock': 1,
      '/ws/Cargo.toml': 1,
      '/ws/crates/rust-toolchain.toml': 2,
      '/ws/crates/foo/Cargo.toml': 1,
    });
    await runCreateNodes(graph);

    expect(cargoFn).toHaveBeenCalledTimes(2);
  });

  it('recomputes when Nx asks for a newly added wildcard workspace member', async () => {
    await setStatMtimes({
      '/ws/Cargo.lock': 1,
      '/ws/Cargo.toml': 1,
      '/ws/crates/foo/Cargo.toml': 1,
      '/ws/crates/bar/Cargo.toml': 1,
    });
    await setMetadata(md([pkg({ name: 'foo' })]));
    const cargoFn = await cargoMetadataMock();
    const graph = await load();

    await runCreateNodes(graph, ['crates/foo/Cargo.toml']);
    await setMetadata(md([pkg({ name: 'foo' }), pkg({ name: 'bar' })]));
    await runCreateNodes(graph, ['crates/foo/Cargo.toml', 'crates/bar/Cargo.toml']);

    expect(cargoFn).toHaveBeenCalledTimes(2);
  });

  it('still recomputes when no Cargo.lock exists yet', async () => {
    // Fresh workspace: the lockfile has not been generated yet, so cache
    // must not pin to "missing-lockfile" forever.
    await setStatMtimes({
      '/ws/Cargo.toml': 1,
      '/ws/crates/foo/Cargo.toml': 1,
    });
    await setMetadata(md([pkg({ name: 'foo' })]));
    const cargoFn = await cargoMetadataMock();
    const graph = await load();

    await runCreateNodes(graph);
    await setStatMtimes({
      '/ws/Cargo.toml': 2, // workspace edited; still no lockfile
      '/ws/crates/foo/Cargo.toml': 1,
    });
    await runCreateNodes(graph);

    expect(cargoFn).toHaveBeenCalledTimes(2);
  });
});
