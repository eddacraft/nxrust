import { execFileSync } from 'node:child_process';

const expected = 'main';

function currentBranch() {
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const actual = currentBranch();

if (actual !== expected) {
  console.error(
    `Refusing to publish @eddacraft/nxrust from "${actual || 'unknown'}". ` +
      `Release publishes must run from "${expected}".`,
  );
  process.exit(1);
}
