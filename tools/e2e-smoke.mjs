import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const packDir = join(root, '.e2e-pack');
const fixtureDir = join(root, 'e2e', 'fixture');
const fixturePackage = join(fixtureDir, 'package.json');
const fixtureNxJson = join(fixtureDir, 'nx.json');
const fixtureToolchain = join(fixtureDir, 'rust-toolchain.toml');

// Derive the tarball name from package.json so version bumps don't break the
// e2e smoke. `pnpm pack` writes `<scope-stripped>-<name>-<version>.tgz`.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tarballName = `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`;
const tarball = `../../.e2e-pack/${tarballName}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
}

// Like `run`, but captures stdout so the caller can assert on command output.
function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
  return result.stdout ?? '';
}

rmSync(packDir, { recursive: true, force: true });
rmSync(join(fixtureDir, '.nx'), { recursive: true, force: true });
rmSync(join(fixtureDir, 'node_modules', '@eddacraft', 'nxrust'), {
  recursive: true,
  force: true,
});

run('pnpm', ['pack', '--pack-destination', packDir]);
run('pnpm', ['install', '--frozen-lockfile'], { cwd: fixtureDir });
// Keep registry dependencies frozen, then install the freshly packed local
// tarball without writing it to the lockfile. The tarball integrity is not
// stable across machines because it is generated during the current run.
const fixturePackageBeforeTarballInstall = readFileSync(fixturePackage);
run('pnpm', ['add', '--save-dev', '--lockfile=false', tarball], {
  cwd: fixtureDir,
});
writeFileSync(fixturePackage, fixturePackageBeforeTarballInstall);

// Mirror a real install: `nx add @eddacraft/nxrust` runs the init generator,
// which registers the `rustSources`/`rustWorkspace` named inputs that every
// inferred target references. Without it the graph fails to load with
// "rustSources is an invalid fileset". Snapshot the committed fixture files
// first so a local run leaves no diff behind, restoring them in `finally`.
const fixtureNxJsonBefore = readFileSync(fixtureNxJson);
try {
  run(
    'pnpm',
    ['exec', 'nx', 'g', '@eddacraft/nxrust:init', '--skipFormat', '--no-interactive'],
    { cwd: fixtureDir },
  );
  run('pnpm', ['exec', 'nx', 'run', 'smoke:check', '--skip-nx-cache'], {
    cwd: fixtureDir,
  });

  // GRAPH-001: the smoke crate declares `[package.metadata.nxrust] tags` and
  // has no project.json, so the inferred Nx project must surface those tags
  // end-to-end through `nx show project`.
  const shown = capture(
    'pnpm',
    ['exec', 'nx', 'show', 'project', 'smoke', '--json'],
    { cwd: fixtureDir },
  );
  const project = JSON.parse(shown.slice(shown.indexOf('{'), shown.lastIndexOf('}') + 1));
  const expectedTags = ['cargo', 'scope:smoke'];
  const missing = expectedTags.filter((tag) => !(project.tags ?? []).includes(tag));
  if (missing.length > 0) {
    throw new Error(
      `nx show project smoke is missing inferred tags ${JSON.stringify(missing)}; ` +
        `got ${JSON.stringify(project.tags ?? [])}`,
    );
  }
  console.log(`e2e: inferred tags OK — ${JSON.stringify(project.tags)}`);

  // TARGETS-001: the smoke crate is a publishable library with no
  // project.json, so the inferred target set must surface EXACTLY — no
  // missing targets, and no extras (`run` is binary-only and must NOT
  // appear; an unexpected target is a contract change that needs a
  // deliberate minor bump per D-008).
  const expectedTargets = [
    'build',
    'check',
    'clippy',
    'lint',
    'fmt',
    'fmt-check',
    'test',
    'nx-release-publish',
  ].sort();
  const targetNames = Object.keys(project.targets ?? {}).sort();
  if (JSON.stringify(targetNames) !== JSON.stringify(expectedTargets)) {
    throw new Error(
      `nx show project smoke inferred target set mismatch; ` +
        `expected ${JSON.stringify(expectedTargets)}, got ${JSON.stringify(targetNames)}`,
    );
  }
  console.log(`e2e: inferred target set OK — ${JSON.stringify(targetNames)}`);
} catch (error) {
  console.error(String(error.message ?? error));
  process.exitCode = 1;
} finally {
  writeFileSync(fixtureNxJson, fixtureNxJsonBefore);
  // `init` creates rust-toolchain.toml in the fixture; drop it so the working
  // tree stays clean (the fixture is intentionally toolchain-file-free).
  rmSync(fixtureToolchain, { force: true });
}
