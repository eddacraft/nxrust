import { describe, expect, it } from 'vitest';
import {
  CACHE_ENV_ALLOWLIST,
  RUST_SOURCES_PATTERNS,
  RUST_WORKSPACE_PATTERNS,
  buildCacheInputs,
  buildCacheOutputs,
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

  it('builds narrow binary outputs for debug and release profiles', () => {
    expect(buildCacheOutputs({ target: 'build', binaries: ['cli'] })).toEqual([
      '{workspaceRoot}/target/debug/cli',
      '{workspaceRoot}/target/release/cli',
    ]);
  });

  it('builds narrow library outputs using cargo artifact names', () => {
    expect(buildCacheOutputs({ target: 'build', libraries: ['my-crate'] })).toEqual([
      '{workspaceRoot}/target/debug/libmy_crate.rlib',
      '{workspaceRoot}/target/release/libmy_crate.rlib',
    ]);
  });

  it('keeps the wide v0.1 build outputs when narrowBuildOutputs is false', () => {
    expect(
      buildCacheOutputs({
        target: 'build',
        binaries: ['cli'],
        narrowBuildOutputs: false,
      }),
    ).toEqual(['{options.target-dir}', '{workspaceRoot}/target']);
  });
});
