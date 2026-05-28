import { DEFAULT_TOOLCHAIN_SENTINEL } from './rust-toolchain';

export const RUST_SOURCES_PATTERNS = [
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
];

export const RUST_WORKSPACE_PATTERNS = [
  '{workspaceRoot}/Cargo.toml',
  '{workspaceRoot}/Cargo.lock',
  '{workspaceRoot}/rust-toolchain.toml',
  '{workspaceRoot}/rust-toolchain',
  '{workspaceRoot}/.cargo/config',
  '{workspaceRoot}/.cargo/config.toml',
];

export const CACHE_ENV_ALLOWLIST = [
  'RUSTFLAGS',
  'CARGO_ENCODED_RUSTFLAGS',
  'RUSTDOCFLAGS',
  'RUSTC',
  'RUSTC_WRAPPER',
  'CARGO_TARGET_DIR',
  'CARGO_BUILD_TARGET',
  'CARGO_PROFILE_RELEASE_LTO',
  'CARGO_PROFILE_RELEASE_CODEGEN_UNITS',
  'CC',
  'CXX',
  'AR',
  'PKG_CONFIG_PATH',
  'OPENSSL_DIR',
  'OPENSSL_STATIC',
  'OPENSSL_NO_PKG_CONFIG',
  'RUSTUP_TOOLCHAIN',
];

export type CacheInput = string | { env: string } | { runtime: string };

export interface BuildCacheInputsOptions {
  resolvedToolchain?: string;
}

export function buildCacheInputs(
  options: BuildCacheInputsOptions = {},
): CacheInput[] {
  const channel = options.resolvedToolchain ?? DEFAULT_TOOLCHAIN_SENTINEL;
  const runtimePrefix =
    channel === DEFAULT_TOOLCHAIN_SENTINEL ? '' : `rustup run ${channel} `;

  return [
    'rustSources',
    'rustWorkspace',
    '^rustSources',
    ...CACHE_ENV_ALLOWLIST.map((env) => ({ env })),
    { runtime: `${runtimePrefix}rustc -Vv` },
    { runtime: `${runtimePrefix}cargo -V` },
  ];
}
