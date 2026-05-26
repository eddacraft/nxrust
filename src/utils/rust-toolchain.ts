import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import TOML from '@ltd/j-toml';

/**
 * Sentinel returned when no `rust-toolchain.toml` or legacy `rust-toolchain`
 * file is found between the project root and the workspace root. Callers
 * (notably `cache-inputs.ts` when CACHE-001 lands) treat this as "emit bare
 * `rustc -Vv` / `cargo -V` runtime commands" rather than `rustup run
 * <channel> ...`.
 */
export const DEFAULT_TOOLCHAIN_SENTINEL = 'default';

/**
 * Allowed character set for a resolved channel literal. Mirrors the values
 * rustup accepts as a channel argument — stable / nightly / beta /
 * `<major>.<minor>.<patch>` / fully-qualified triples / custom linked
 * toolchain names. Anything outside this set is a configuration bug; the
 * literal is about to be embedded in a `rustup run <channel> ...` runtime
 * command, so whitespace or shell-meta is rejected at the validation layer
 * rather than silently quoted.
 *
 * See `designs/2026-05-22-cache-and-toolchain.design.md` § C
 * (Channel-literal sanitisation) for the contract.
 */
const CHANNEL_LITERAL_PATTERN = /^[A-Za-z0-9._+-]+$/;

export type ToolchainSource =
  | 'project.json'
  | 'package.metadata.nxrust.targets'
  | 'package.metadata.nxrust'
  | 'rust-toolchain.toml'
  | 'rust-toolchain'
  | 'default';

export interface ToolchainResolution {
  channel: string;
  source: ToolchainSource;
  origin?: string;
}

export interface ResolveToolchainOptions {
  projectRoot: string;
  workspaceRoot: string;
  /**
   * D-TC2 step 2 — toolchain literal taken from the Nx target's
   * `project.json` option (e.g. `target.options.toolchain`). When set,
   * overrides every lower-priority source. Callers (executors,
   * `cache-inputs.ts` wiring) read this from the resolved Nx target
   * configuration; this function only consumes the value.
   */
  projectJsonToolchain?: string;
  /**
   * D-TC2 step 3 — toolchain literal taken from
   * `package.metadata.nxrust.targets.<name>.toolchain` in `Cargo.toml`.
   * Higher priority than the crate-default but lower than `project.json`.
   * Callers read from `cargo metadata` and pass the resolved value here.
   */
  cargoMetadataTargetToolchain?: string;
  /**
   * D-TC2 step 4 — toolchain literal taken from
   * `package.metadata.nxrust.toolchain` in `Cargo.toml` (per-crate
   * default). Higher priority than `rust-toolchain.toml` but lower than
   * per-target overrides.
   */
  cargoMetadataPackageToolchain?: string;
}

/**
 * Validate that a channel literal is safe to embed in a `rustup run
 * <channel> ...` runtime command. Throws on whitespace or shell-meta.
 *
 * Exported for unit-testing and for future callers (TOOLCHAIN-002's
 * `project.json` / `package.metadata.nxrust.toolchain` branches need the
 * same validation before extending the resolution surface).
 */
export function validateChannelLiteral(channel: string): void {
  if (!CHANNEL_LITERAL_PATTERN.test(channel)) {
    throw new Error(
      `invalid toolchain literal: ${JSON.stringify(channel)} — channel must match ${CHANNEL_LITERAL_PATTERN}`,
    );
  }
}

/**
 * Resolve the Rust toolchain channel for a project, applying the full
 * D-TC2 override hierarchy at target-emission time:
 *
 * 1. (executor-time, not handled here) per-invocation `--toolchain` flag.
 * 2. `project.json` target option (`projectJsonToolchain`).
 * 3. `package.metadata.nxrust.targets.<name>.toolchain`
 *    (`cargoMetadataTargetToolchain`).
 * 4. `package.metadata.nxrust.toolchain` (`cargoMetadataPackageToolchain`).
 * 5. `rust-toolchain.toml` or legacy `rust-toolchain`, found by walking
 *    upward from `projectRoot` to `workspaceRoot` (deepest wins).
 * 6. The `"default"` sentinel — callers emit bare `rustc -Vv` runtime
 *    commands rather than `rustup run <channel> ...`.
 *
 * Each non-undefined override is validated against the channel-literal
 * pattern so a downstream `rustup run <channel> ...` runtime command is
 * always shell-safe.
 *
 * Step 1 (per-invocation flag) is intentionally not consumed by this
 * function — it is hashed by Nx as a task option at executor time rather
 * than baked into the runtime string at emission time.
 */
export function resolveToolchain(
  opts: ResolveToolchainOptions,
): ToolchainResolution {
  if (opts.projectJsonToolchain !== undefined) {
    validateChannelLiteral(opts.projectJsonToolchain);
    return { channel: opts.projectJsonToolchain, source: 'project.json' };
  }

  if (opts.cargoMetadataTargetToolchain !== undefined) {
    validateChannelLiteral(opts.cargoMetadataTargetToolchain);
    return {
      channel: opts.cargoMetadataTargetToolchain,
      source: 'package.metadata.nxrust.targets',
    };
  }

  if (opts.cargoMetadataPackageToolchain !== undefined) {
    validateChannelLiteral(opts.cargoMetadataPackageToolchain);
    return {
      channel: opts.cargoMetadataPackageToolchain,
      source: 'package.metadata.nxrust',
    };
  }

  const dirs = walkUp(opts.projectRoot, opts.workspaceRoot);

  for (const dir of dirs) {
    const tomlPath = join(dir, 'rust-toolchain.toml');
    if (existsSync(tomlPath)) {
      const channel = parseRustToolchainToml(readFileSync(tomlPath, 'utf-8'), tomlPath);
      validateChannelLiteral(channel);
      return { channel, source: 'rust-toolchain.toml', origin: tomlPath };
    }

    const legacyPath = join(dir, 'rust-toolchain');
    if (existsSync(legacyPath)) {
      const channel = parseRustToolchainLegacy(readFileSync(legacyPath, 'utf-8'), legacyPath);
      validateChannelLiteral(channel);
      return { channel, source: 'rust-toolchain', origin: legacyPath };
    }
  }

  return { channel: DEFAULT_TOOLCHAIN_SENTINEL, source: 'default' };
}

/**
 * Parse a `rust-toolchain.toml` body and extract the `[toolchain] channel`
 * field. Throws with a path-bearing message on any failure so the caller's
 * stack trace is actionable.
 */
function parseRustToolchainToml(source: string, path: string): string {
  let parsed: unknown;
  try {
    parsed = TOML.parse(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Malformed ${path}: ${message}`);
  }

  if (!isRecord(parsed) || !isRecord(parsed.toolchain)) {
    throw new Error(`${path}: missing [toolchain] table`);
  }

  const channel = parsed.toolchain.channel;
  if (typeof channel !== 'string' || channel.length === 0) {
    throw new Error(`${path}: [toolchain] is missing a non-empty channel field`);
  }

  return channel;
}

/**
 * Parse a legacy single-line `rust-toolchain` file. Format predates the TOML
 * version: just a channel name on the first non-empty line.
 */
function parseRustToolchainLegacy(source: string, path: string): string {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    throw new Error(`${path}: legacy rust-toolchain file is empty`);
  }
  return trimmed.split(/\r?\n/, 1)[0].trim();
}

/**
 * Yield each ancestor directory from `start` up to and including `stop`,
 * deepest first. Stops if `start` is not under `stop` — callers should pass
 * a `projectRoot` that lives beneath `workspaceRoot`; the safety stop keeps
 * a misconfigured pair from walking up to the filesystem root.
 *
 * Mirrors the `relative()` + `isAbsolute()` outside-check pattern from
 * `cargo.ts` so the cross-drive Windows case (where `relative()` returns an
 * absolute path rather than a `..`-prefixed one) is handled correctly.
 */
function walkUp(start: string, stop: string): string[] {
  const absStart = isAbsolute(start) ? start : resolve(start);
  const absStop = isAbsolute(stop) ? stop : resolve(stop);
  const rel = relative(absStop, absStart);

  // If absStart === absStop, relative returns ''; if absStart is outside
  // absStop, relative either starts with '..' (same root, parent path) or
  // is absolute (different root / different drive on Windows). In any of
  // those cases we only want the `absStop` directory itself.
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return [absStop];
  }

  const dirs: string[] = [];
  const parts = rel.split(sep);
  for (let i = parts.length; i > 0; i--) {
    dirs.push(join(absStop, ...parts.slice(0, i)));
  }
  dirs.push(absStop);
  return dirs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
