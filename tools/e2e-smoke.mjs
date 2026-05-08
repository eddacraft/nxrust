import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const packDir = join(root, '.e2e-pack');
const fixtureDir = join(root, 'e2e', 'fixture');
const fixturePackage = join(fixtureDir, 'package.json');

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
    process.exit(result.status ?? 1);
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
run('pnpm', ['exec', 'nx', 'run', 'smoke:check', '--skip-nx-cache'], {
  cwd: fixtureDir,
});
