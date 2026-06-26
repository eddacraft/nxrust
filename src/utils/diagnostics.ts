/**
 * Structured diagnostic formatter (APS module 14, spec §6.14). Every
 * plugin-detectable problem surfaces through this one helper so output is
 * consistent across executors and generators: what failed, why it matters, the
 * exact command attempted (when safe to quote), and the suggested fix.
 *
 * Output shape:
 *
 *   [nxrust] <what>
 *     why: <why>
 *     command: <command, if provided — secrets redacted>
 *     fix: <fix>
 *
 * Warnings and info prefix the severity on the first line.
 *
 * Diagnostic *codes* (D-D2/D-D5) are slug-based with an `nxrust:` prefix
 * (`nxrust:cargo-not-found`). Codes are stable: renaming one is a major bump,
 * adding one is a minor bump (D-008). The code lives on the {@link Diagnostic}
 * and {@link NxrustDiagnosticError} for programmatic handling and the docs
 * catalogue; it is intentionally *not* rendered into the human envelope.
 */

export type DiagnosticSeverity = "error" | "warning" | "info";

/**
 * Stable, slug-based diagnostic codes (D-D5). Prefixed with `nxrust:` so they
 * are unambiguous in logs and IDE output. Do not rename an existing code — add
 * a new one (minor bump) and deprecate the old.
 */
export const DIAGNOSTIC_CODES = {
  cargoNotFound: "nxrust:cargo-not-found",
  toolchainNotInstalled: "nxrust:toolchain-not-installed",
  targetNotInstalled: "nxrust:target-not-installed",
  nightlyRequired: "nxrust:nightly-required",
  invalidToolchainLiteral: "nxrust:invalid-toolchain-literal",
  spawnFailed: "nxrust:spawn-failed",
} as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES];

export interface Diagnostic {
  what: string;
  why: string;
  /** Exact command attempted, when safe to print. Secrets are redacted. */
  command?: string;
  fix: string;
  /** Defaults to `error`. */
  severity?: DiagnosticSeverity;
  /** Stable slug code (D-D5); omitted for ad-hoc/un-catalogued diagnostics. */
  code?: DiagnosticCode;
}

/**
 * A diagnostic that carries a catalogued code. Every builder below returns one,
 * and {@link NxrustDiagnosticError} only accepts these — so a thrown diagnostic
 * always has a `.code` a `catch` clause can branch on (no silent fallback).
 */
export type CataloguedDiagnostic = Diagnostic & { code: DiagnosticCode };

// Env assignments whose *name* implies a secret. We keep the name (so the
// reader knows which var) but replace the value — never print the secret
// itself (module 14 constraint: redact `TOKEN`/`SECRET`/`KEY`/`PASSWORD`).
const SECRET_ASSIGNMENT = /\b([A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Z0-9_]*)=(\S+)/gi;

// Flags whose following value is a secret (cargo publish/login take `--token`).
// Covers both `--token sekret` and `--token=sekret`; the separator is captured
// so it round-trips. The env-style pass above also happens to catch the `=`
// form, but SECRET_FLAG owns it explicitly so future non-secret-named flags
// (e.g. `--registry-token`) are still redacted.
const SECRET_FLAG = /(--(?:token|registry-token|password))(=|\s+)(\S+)/gi;

export function redactSecrets(command: string): string {
  return command
    .replace(SECRET_ASSIGNMENT, (_match, name: string) => `${name}=<redacted>`)
    .replace(SECRET_FLAG, (_match, flag: string, sep: string) => `${flag}${sep}<redacted>`);
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const { what, why, command, fix, severity = "error" } = diagnostic;
  const heading = severity === "error" ? `[nxrust] ${what}` : `[nxrust] ${severity}: ${what}`;
  const lines = [heading, `  why: ${why}`];
  if (command !== undefined) lines.push(`  command: ${redactSecrets(command)}`);
  lines.push(`  fix: ${fix}`);
  return lines.join("\n");
}

/**
 * Error type that every nxrust pre-flight/post-mortem diagnostic throws so
 * callers can branch on `.code`. The `message` is the fully-formatted envelope,
 * so an uncaught one still prints the structured diagnostic.
 */
export class NxrustDiagnosticError extends Error {
  readonly code: DiagnosticCode;
  readonly diagnostic: CataloguedDiagnostic;

  constructor(diagnostic: CataloguedDiagnostic) {
    super(formatDiagnostic(diagnostic));
    this.name = "NxrustDiagnosticError";
    this.diagnostic = diagnostic;
    this.code = diagnostic.code;
  }
}

// ── Toolchain / cargo diagnostic builders (the catalogue) ──────────────────

/** `cargo` (or `rustup`) is not on PATH. */
export function cargoNotFound(command?: string): CataloguedDiagnostic {
  return {
    code: DIAGNOSTIC_CODES.cargoNotFound,
    what: "cargo not found on PATH",
    why: "nxrust shells out to cargo to build, test, and resolve the Cargo workspace",
    command,
    fix: "install the Rust toolchain via https://rustup.rs (it provides cargo and rustup)",
  };
}

/** The resolved toolchain channel is not installed. */
export function toolchainNotInstalled(channel: string, command?: string): CataloguedDiagnostic {
  return {
    code: DIAGNOSTIC_CODES.toolchainNotInstalled,
    what: `Rust toolchain \`${channel}\` is not installed`,
    why: "the resolved rust-toolchain channel must be installed before cargo can run",
    command,
    fix: `run \`rustup install ${channel}\``,
  };
}

/** A `--target <triple>` was requested but its std library is not installed. */
export function targetNotInstalled(triple: string, command?: string): CataloguedDiagnostic {
  return {
    code: DIAGNOSTIC_CODES.targetNotInstalled,
    what: `Rust target \`${triple}\` is not installed`,
    why: "cross-compiling to this target needs the target's pre-built standard library",
    command,
    fix: `run \`rustup target add ${triple}\``,
  };
}

/** A nightly-only invocation ran on a non-nightly channel. */
export function nightlyRequired(command?: string): CataloguedDiagnostic {
  return {
    code: DIAGNOSTIC_CODES.nightlyRequired,
    what: "this invocation requires the nightly toolchain",
    why: "a nightly-only cargo or rustc feature was used on a non-nightly channel",
    command,
    fix: 'add `[toolchain] channel = "nightly"` to rust-toolchain.toml, or pass `--toolchain=nightly`',
  };
}

/**
 * A resolved channel literal failed the shell-safety pattern. Keeps the legacy
 * `invalid toolchain literal from <origin>: <literal>` wording so existing
 * call-site assertions keep matching after the throw is re-routed through the
 * envelope.
 */
export function invalidToolchainLiteral(
  channel: string,
  origin?: string,
  pattern?: RegExp,
): CataloguedDiagnostic {
  const from = origin === undefined ? "" : ` from ${origin}`;
  const constraint = pattern === undefined ? "" : ` — channel must match ${pattern}`;
  return {
    code: DIAGNOSTIC_CODES.invalidToolchainLiteral,
    what: `invalid toolchain literal${from}: ${JSON.stringify(channel)}`,
    why: "the channel is embedded into a `rustup run <channel> ...` command, so it must be shell-safe",
    fix: `use a channel like \`stable\`, \`nightly\`, or \`1.81.0\`${constraint}`,
  };
}

/** A spawn failed for a reason other than a known classified shape. */
export function spawnFailed(
  binary: string,
  detail: string,
  command?: string,
): CataloguedDiagnostic {
  return {
    code: DIAGNOSTIC_CODES.spawnFailed,
    what: `failed to spawn \`${binary}\``,
    // `detail` is a raw OS error message (e.g. an EACCES path) — redact it too,
    // since the `why:` field is not run through redactSecrets by the formatter.
    why: redactSecrets(detail),
    command,
    fix: `confirm \`${binary}\` is installed and executable, then retry`,
  };
}

/** Input to {@link runWithDiagnostic} — the outcome of a spawned process. */
export interface RunDiagnosticInput {
  /** A spawn error (e.g. `ENOENT`) thrown when the process failed to start. */
  error?: NodeJS.ErrnoException;
  /** Captured stderr from a process that ran but exited non-zero. */
  stderr?: string;
  /** The executable name (`cargo`, `rustup`) — used to map `ENOENT`. */
  binary?: string;
  /** The full command string for the `command:` field (redacted at format). */
  command?: string;
}

const RUSTUP_TOOLCHAINS = new Set(["cargo", "rustup", "rustc"]);
// Defensive quoting (backtick / single / double) mirrors TARGET_MISSING so a
// rustup phrasing change does not silently fall through to spawn-failed.
const TOOLCHAIN_MISSING = /toolchain [`'"]?([A-Za-z0-9._+-]+)[`'"]? is not installed/i;
const TARGET_MISSING = [
  /the target [`'"]?([A-Za-z0-9_.+-]+)[`'"]? must be installed/i,
  /does not support the target [`'"]?([A-Za-z0-9_.+-]+)/i,
  /target [`'"]?([A-Za-z0-9_.+-]+)[`'"]? is not installed/i,
];
// Anchored to nightly-specific phrasings only. A bare `requires -Z` substring is
// deliberately *not* matched — stable cargo/rustc emit it when advising about
// unstable flags the user never asked to run on nightly (false-positive risk).
const NIGHTLY_REQUIRED =
  /requires nightly|can only be used on the nightly|nightly-only|is only available (?:with|on) the nightly|add `#!\[feature/i;

/**
 * Classify the outcome of a spawned cargo/rustup process and throw a structured
 * {@link NxrustDiagnosticError} for the known failure shapes. Unknown cargo
 * output (rustc compile errors and the like) passes through unchanged — the
 * plugin does not translate arbitrary cargo output (module 14 Out-of-Scope).
 *
 * Used by `run-process.ts` at the single cargo-invocation chokepoint, and
 * unit-tested directly against synthetic inputs.
 */
export function runWithDiagnostic(input: RunDiagnosticInput): void {
  if (input.error?.code === "ENOENT") {
    if (input.binary === undefined || RUSTUP_TOOLCHAINS.has(input.binary)) {
      throw new NxrustDiagnosticError(cargoNotFound(input.command));
    }
    throw new NxrustDiagnosticError(spawnFailed(input.binary, input.error.message, input.command));
  }

  const stderr = input.stderr ?? "";
  if (stderr.length === 0) return;

  const toolchain = stderr.match(TOOLCHAIN_MISSING);
  if (toolchain) {
    throw new NxrustDiagnosticError(toolchainNotInstalled(toolchain[1], input.command));
  }

  for (const pattern of TARGET_MISSING) {
    const target = stderr.match(pattern);
    if (target) {
      throw new NxrustDiagnosticError(targetNotInstalled(target[1], input.command));
    }
  }

  if (NIGHTLY_REQUIRED.test(stderr)) {
    throw new NxrustDiagnosticError(nightlyRequired(input.command));
  }
}
