import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const packDir = join(root, '.e2e-pack');
const fixtureDir = join(root, 'e2e', 'fixture');

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

run('pnpm', ['pack', '--pack-destination', packDir]);
// The fixture lockfile intentionally includes the local tarball integrity. If
// package contents change, rebuild first and refresh it with:
// `pnpm pack --pack-destination .e2e-pack && pnpm --dir e2e/fixture install --lockfile-only`.
run('pnpm', ['install', '--frozen-lockfile'], { cwd: fixtureDir });
run('pnpm', ['exec', 'nx', 'run', 'smoke:check', '--skip-nx-cache'], {
  cwd: fixtureDir,
});
