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
} catch (error) {
  console.error(String(error.message ?? error));
  process.exitCode = 1;
} finally {
  writeFileSync(fixtureNxJson, fixtureNxJsonBefore);
  // `init` creates rust-toolchain.toml in the fixture; drop it so the working
  // tree stays clean (the fixture is intentionally toolchain-file-free).
  rmSync(fixtureToolchain, { force: true });
}
