import { describe, expect, it } from 'vitest';
import {
  CACHE_ENV_ALLOWLIST,
  RUST_SOURCES_PATTERNS,
  RUST_WORKSPACE_PATTERNS,
  buildCacheInputs,
} from './cache-inputs';

describe('cache input contract', () => {
  it('exports the canonical named input bodies', () => {
    expect(RUST_SOURCES_PATTERNS).toEqual([
      '{projectRoot}/src/**/*.rs',
      '{projectRoot}/tests/**/*.rs',
      '{projectRoot}/benches/**/*.rs',
      '{projectRoot}/examples/**/*.rs',
      '{projectRoot}/build.rs',
      '{projectRoot}/Cargo.toml',
      '{projectRoot}/rust-toolchain.toml',
      '{projectRoot}/rust-toolchain',
      '{projectRoot}/.cargo/config',
      '{projectRoot}/.cargo/config.toml',
    ]);
    expect(RUST_WORKSPACE_PATTERNS).toEqual([
      '{workspaceRoot}/Cargo.toml',
      '{workspaceRoot}/Cargo.lock',
      '{workspaceRoot}/rust-toolchain.toml',
      '{workspaceRoot}/rust-toolchain',
      '{workspaceRoot}/.cargo/config',
      '{workspaceRoot}/.cargo/config.toml',
    ]);
  });

  it('builds named inputs, env allowlist entries, and bare runtime entries by default', () => {
    expect(buildCacheInputs()).toEqual([
      'rustSources',
      'rustWorkspace',
      '^rustSources',
      ...CACHE_ENV_ALLOWLIST.map((env) => ({ env })),
      { runtime: 'rustc -Vv' },
      { runtime: 'cargo -V' },
    ]);
  });

  it('bakes a resolved rustup channel into runtime entries', () => {
    expect(buildCacheInputs({ resolvedToolchain: 'nightly' })).toContainEqual({
      runtime: 'rustup run nightly rustc -Vv',
    });
    expect(buildCacheInputs({ resolvedToolchain: 'nightly' })).toContainEqual({
      runtime: 'rustup run nightly cargo -V',
    });
  });
});
