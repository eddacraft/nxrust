import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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

export type ToolchainSource = 'rust-toolchain.toml' | 'rust-toolchain' | 'default';

export interface ToolchainResolution {
  channel: string;
  source: ToolchainSource;
  origin?: string;
}

export interface ResolveToolchainOptions {
  projectRoot: string;
  workspaceRoot: string;
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
 * Resolve the Rust toolchain channel for a project by walking up the
 * directory tree from `projectRoot` to `workspaceRoot` (inclusive), looking
 * for `rust-toolchain.toml` first, then the legacy single-line
 * `rust-toolchain` file at the same depth. The deepest match wins so
 * per-crate pins override workspace defaults.
 *
 * Implements step 5 of the D-TC2 hierarchy (file lookup). Steps 1-4 live in
 * TOOLCHAIN-002 and extend `ToolchainResolution` callers rather than this
 * function's signature.
 */
export function resolveToolchain(
  opts: ResolveToolchainOptions,
): ToolchainResolution {
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
 */
function walkUp(start: string, stop: string): string[] {
  const dirs: string[] = [];
  const rel = relative(stop, start);

  // If start === stop, relative returns ''; if start is outside stop,
  // relative starts with '..'. In either of those cases we only want the
  // `stop` directory itself.
  if (rel === '' || rel.startsWith('..')) {
    return [stop];
  }

  const parts = rel.split(sep);
  for (let i = parts.length; i > 0; i--) {
    dirs.push(join(stop, ...parts.slice(0, i)));
  }
  dirs.push(stop);
  return dirs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
