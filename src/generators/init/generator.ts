import {
  formatFiles,
  logger,
  readNxJson,
  updateNxJson,
  writeJson,
  type NxJsonConfiguration,
  type Tree,
} from "@nx/devkit";
import { RUST_SOURCES_PATTERNS, RUST_WORKSPACE_PATTERNS } from "../../utils/cache-inputs";

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
  if (!tree.exists("Cargo.toml")) {
    tree.write("Cargo.toml", DEFAULT_WORKSPACE_CARGO_TOML);
    logger.info("Created Cargo.toml workspace root.");
  }

  if (!tree.exists("rust-toolchain.toml")) {
    tree.write("rust-toolchain.toml", DEFAULT_TOOLCHAIN);
    logger.info("Created rust-toolchain.toml.");
  }

  mergeRustNamedInputs(tree);

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

function mergeRustNamedInputs(tree: Tree): void {
  // `readNxJson` parses nx.json as JSONC, so a consumer's documented comments
  // don't throw the way raw `JSON.parse` would.
  const nxJson: NxJsonConfiguration = readNxJson(tree) ?? {};
  const namedInputs = nxJson.namedInputs ?? {};

  // Evaluate both merges before combining so the second isn't short-circuited.
  const changedSources = mergeNamedInput(namedInputs, "rustSources", RUST_SOURCES_PATTERNS);
  const changedWorkspace = mergeNamedInput(namedInputs, "rustWorkspace", RUST_WORKSPACE_PATTERNS);

  // Leave nx.json (and its formatting/comments) untouched when nothing merged.
  if (!changedSources && !changedWorkspace) return;

  nxJson.namedInputs = namedInputs;
  // `updateNxJson` no-ops when nx.json is absent, so create it explicitly in
  // that case (real Nx workspaces always have one; bare trees may not).
  if (tree.exists("nx.json")) {
    updateNxJson(tree, nxJson);
  } else {
    writeJson(tree, "nx.json", nxJson);
  }
}

function mergeNamedInput(
  namedInputs: NonNullable<NxJsonConfiguration["namedInputs"]>,
  name: "rustSources" | "rustWorkspace",
  patterns: string[],
): boolean {
  const existing = namedInputs[name];
  if (existing === undefined) {
    namedInputs[name] = [...patterns];
    return true;
  }

  if (Array.isArray(existing) && existing.every((item) => typeof item === "string")) {
    let changed = false;
    for (const pattern of patterns) {
      if (!existing.includes(pattern)) {
        existing.push(pattern);
        changed = true;
      }
    }
    return changed;
  }

  logger.warn(
    `nxrust:named-inputs-divergence: nx.json namedInputs.${name} differs from nxrust's cache contract; leaving the consumer value unchanged.`,
  );
  return false;
}
