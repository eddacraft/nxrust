// Cache-correctness fixture matrix (product-spec §8.1, APS module 04).
//
// Exercises the inferred cacheable targets against representative Cargo
// workspace shapes and asserts the contract that makes remote cache hits
// trustworthy: the SECOND run of any cacheable target on unchanged inputs
// must hit the Nx cache. A cache-key regression (a non-deterministic input,
// a declared output that is never produced, an env var that leaks into the
// key) shows up as a second-run miss, and this harness fails loudly with the
// offending project:target pairs.
//
// Shapes covered (see e2e/cache-matrix/crates):
//   solo            — standalone library (single-crate semantics)
//   engine + app    — multi-crate workspace with a cross-crate normal dep
//   with-dev-dep    — library with a dev-dependency edge
//   with-build-dep  — library with a build.rs + build-dependency edge
//   featured        — feature-gated library (default features on)
//   ts-app          — non-Rust project sharing the workspace (mixed TS+Rust)
//
// All dependencies are intra-workspace path deps so the matrix stays hermetic
// and needs no registry/network access — a cache miss must never become a
// failure (module 04 constraint).

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const packDir = join(root, '.cache-matrix-pack');
const fixtureDir = join(root, 'e2e', 'cache-matrix');
const fixtureNxJson = join(fixtureDir, 'nx.json');
const fixtureToolchain = join(fixtureDir, 'rust-toolchain.toml');

// Cacheable targets nxrust infers today (build, check, clippy, fmt-check,
// test). `fmt` and `run` are intentionally uncached and excluded.
const RUST_CACHEABLE = ['check', 'fmt-check', 'clippy', 'test', 'build'];

// project -> cacheable targets to verify. The Rust crates exercise the full
// inferred cacheable set; ts-app verifies a non-Rust project still caches
// once the Rust named inputs are registered in nx.json.
const MATRIX = {
  solo: RUST_CACHEABLE,
  engine: RUST_CACHEABLE,
  app: RUST_CACHEABLE,
  'with-dev-dep': RUST_CACHEABLE,
  'with-build-dep': RUST_CACHEABLE,
  featured: RUST_CACHEABLE,
  'ts-app': ['build'],
};

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tarballName = `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`;
const tarball = `../../.cache-matrix-pack/${tarballName}`;

const childEnv = { ...process.env, NX_DAEMON: 'false', CI: 'true' };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: childEnv,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
}

// Run an Nx target and report whether the run was served from cache. Output is
// captured (not inherited) so we can inspect the cache markers Nx prints.
function runTarget(project, target) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'nx', 'run', `${project}:${target}`, '--output-style=stream'],
    {
      cwd: fixtureDir,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      env: childEnv,
    },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    process.stdout.write(output);
    throw new Error(`nx run ${project}:${target} exited with ${result.status}`);
  }
  const fromCache =
    output.includes('[local cache]') ||
    output.includes('read the output from the cache') ||
    output.includes('existing outputs match the cache');
  return { fromCache, output };
}

rmSync(packDir, { recursive: true, force: true });
rmSync(join(fixtureDir, '.nx'), { recursive: true, force: true });
rmSync(join(fixtureDir, 'target'), { recursive: true, force: true });
rmSync(join(fixtureDir, 'ts-app', 'dist'), { recursive: true, force: true });
rmSync(join(fixtureDir, 'node_modules', '@eddacraft', 'nxrust'), {
  recursive: true,
  force: true,
});

run('pnpm', ['pack', '--pack-destination', packDir]);
run('pnpm', ['install', '--frozen-lockfile'], { cwd: fixtureDir });
// Install the freshly packed tarball without touching the lockfile — its
// integrity is not stable across machines (it is built during this run).
const fixturePackage = join(fixtureDir, 'package.json');
const fixturePackageBefore = readFileSync(fixturePackage);
run('pnpm', ['add', '--save-dev', '--lockfile=false', tarball], {
  cwd: fixtureDir,
});
writeFileSync(fixturePackage, fixturePackageBefore);

// Mirror `nx add @eddacraft/nxrust`: init registers the rustSources/
// rustWorkspace named inputs every inferred target references (module 04 D-C5).
const fixtureNxJsonBefore = readFileSync(fixtureNxJson);

const misses = [];
const checked = [];

try {
  run(
    'pnpm',
    ['exec', 'nx', 'g', '@eddacraft/nxrust:init', '--skipFormat', '--no-interactive'],
    { cwd: fixtureDir },
  );

  for (const [project, targets] of Object.entries(MATRIX)) {
    for (const target of targets) {
      // First run on a cleared cache must execute the command (a miss). If it
      // is already a hit, the test is meaningless — flag it.
      const first = runTarget(project, target);
      if (first.fromCache) {
        misses.push(`${project}:${target} (unexpected cache hit on first run)`);
        continue;
      }
      // Second run on unchanged inputs MUST hit the cache.
      const second = runTarget(project, target);
      checked.push(`${project}:${target}`);
      if (!second.fromCache) {
        misses.push(`${project}:${target} (cache MISS on second run)`);
        process.stdout.write(second.output);
      } else {
        console.log(`  cache hit: ${project}:${target}`);
      }
    }
  }

  if (misses.length > 0) {
    console.error('\nCache-correctness regression — the following targets did');
    console.error('not behave as cacheable on unchanged inputs:\n');
    for (const miss of misses) console.error(`  - ${miss}`);
    throw new Error(`${misses.length} cache-correctness failure(s)`);
  }

  console.log(
    `\nCache matrix passed: ${checked.length} target(s) hit the cache on re-run across ${Object.keys(MATRIX).length} workspace shapes.`,
  );
} catch (error) {
  console.error(String(error.message ?? error));
  process.exitCode = 1;
} finally {
  // Leave the committed fixture pristine.
  writeFileSync(fixtureNxJson, fixtureNxJsonBefore);
  rmSync(fixtureToolchain, { force: true });
  rmSync(join(fixtureDir, '.nx'), { recursive: true, force: true });
  rmSync(join(fixtureDir, 'target'), { recursive: true, force: true });
  rmSync(join(fixtureDir, 'ts-app', 'dist'), { recursive: true, force: true });
}
