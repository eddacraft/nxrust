import { formatFiles, logger, type Tree } from '@nx/devkit';
import {
  RUST_SOURCES_PATTERNS,
  RUST_WORKSPACE_PATTERNS,
} from '../../utils/cache-inputs';

export interface InitGeneratorSchema {
  skipFormat?: boolean;
}

const DEFAULT_TOOLCHAIN = `[toolchain]
channel = "stable"
profile = "minimal"
components = ["rustfmt", "clippy"]
`;

const DEFAULT_WORKSPACE_CARGO_TOML = `[workspace]
resolver = "2"
members = []

[workspace.package]
edition = "2021"

[profile.release]
lto = true
codegen-units = 1
`;

/**
 * Write a Cargo workspace root if one doesn't exist yet, plus a
 * rust-toolchain.toml pinning a minimal toolchain. Safe to run multiple
 * times — it only writes missing files.
 */
export default async function initGenerator(
  tree: Tree,
  options: InitGeneratorSchema = {},
): Promise<void> {
  if (!tree.exists('Cargo.toml')) {
    tree.write('Cargo.toml', DEFAULT_WORKSPACE_CARGO_TOML);
    logger.info('Created Cargo.toml workspace root.');
  }

  if (!tree.exists('rust-toolchain.toml')) {
    tree.write('rust-toolchain.toml', DEFAULT_TOOLCHAIN);
    logger.info('Created rust-toolchain.toml.');
  }

  mergeRustNamedInputs(tree);

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

function mergeRustNamedInputs(tree: Tree): void {
  const nxJson = readNxJson(tree);
  const namedInputs = nxJson.namedInputs ?? {};

  mergeNamedInput(namedInputs, 'rustSources', RUST_SOURCES_PATTERNS);
  mergeNamedInput(namedInputs, 'rustWorkspace', RUST_WORKSPACE_PATTERNS);

  tree.write('nx.json', `${JSON.stringify({ ...nxJson, namedInputs }, null, 2)}\n`);
}

function readNxJson(tree: Tree): Record<string, unknown> & {
  namedInputs?: Record<string, unknown>;
} {
  if (!tree.exists('nx.json')) return {};
  const raw = tree.read('nx.json')?.toString() ?? '{}';
  return JSON.parse(raw);
}

function mergeNamedInput(
  namedInputs: Record<string, unknown>,
  name: 'rustSources' | 'rustWorkspace',
  patterns: string[],
): void {
  const existing = namedInputs[name];
  if (existing === undefined) {
    namedInputs[name] = patterns;
    return;
  }

  if (Array.isArray(existing) && existing.every((item) => typeof item === 'string')) {
    for (const pattern of patterns) {
      if (!existing.includes(pattern)) existing.push(pattern);
    }
    return;
  }

  logger.warn(
    `nxrust:named-inputs-divergence: nx.json namedInputs.${name} differs from nxrust's cache contract; leaving the consumer value unchanged.`,
  );
}
