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
 * Warnings and info prefix the severity on the first line. Diagnostic *codes*
 * (D-D2) are not modelled yet — this is the formatter, not the catalogue.
 */

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  what: string;
  why: string;
  /** Exact command attempted, when safe to print. Secrets are redacted. */
  command?: string;
  fix: string;
  /** Defaults to `error`. */
  severity?: DiagnosticSeverity;
}

// Env assignments whose *name* implies a secret. We keep the name (so the
// reader knows which var) but replace the value — never print the secret
// itself (module 14 constraint: redact `TOKEN`/`SECRET`/`KEY`/`PASSWORD`).
const SECRET_ASSIGNMENT = /\b([A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Z0-9_]*)=(\S+)/gi;

export function redactSecrets(command: string): string {
  return command.replace(SECRET_ASSIGNMENT, (_match, name: string) => `${name}=<redacted>`);
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const { what, why, command, fix, severity = "error" } = diagnostic;
  const heading = severity === "error" ? `[nxrust] ${what}` : `[nxrust] ${severity}: ${what}`;
  const lines = [heading, `  why: ${why}`];
  if (command !== undefined) lines.push(`  command: ${redactSecrets(command)}`);
  lines.push(`  fix: ${fix}`);
  return lines.join("\n");
}
