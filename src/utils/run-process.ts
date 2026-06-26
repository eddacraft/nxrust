import { spawn } from "node:child_process";
import {
  NxrustDiagnosticError,
  formatDiagnostic,
  runWithDiagnostic,
  spawnFailed,
} from "./diagnostics";

// Cap the retained stderr tail so a chatty build can't grow this unbounded; the
// rustup/target failure lines we classify against are short and land at the end.
const STDERR_TAIL_LIMIT = 64 * 1024;

/**
 * Emit a structured diagnostic for a failed process. The known cargo/rustup
 * shapes (missing toolchain, missing target, nightly-only, spawn `ENOENT`)
 * surface as an `[nxrust]` envelope on stderr; unknown cargo output is left
 * untouched — cargo already printed its own error inline. A spawn error we
 * cannot classify still gets a structured envelope rather than a bare stack
 * trace (module 14 constraint: no `console.*` output).
 */
function reportFailure(input: {
  error?: NodeJS.ErrnoException;
  stderr?: string;
  binary: string;
  command: string;
}): void {
  try {
    runWithDiagnostic(input);
  } catch (err) {
    if (err instanceof NxrustDiagnosticError) {
      process.stderr.write(`${err.message}\n`);
      return;
    }
    throw err;
  }
  if (input.error) {
    const diagnostic = spawnFailed(input.binary, input.error.message, input.command);
    process.stderr.write(`${formatDiagnostic(diagnostic)}\n`);
  }
}

/**
 * Spawn a process. stdout stays inherited so cargo's colourised output and
 * progress bars surface unchanged; stderr is teed — written through live *and*
 * captured (last {@link STDERR_TAIL_LIMIT} bytes) so a failure can be
 * classified into a structured nxrust diagnostic. Returns `{ success }` with
 * the exit code normalised — 0 is success, anything else is failure.
 *
 * Child is tracked so SIGINT/SIGTERM on the parent propagates to cargo, and
 * the parent-process listeners are removed once the child exits so repeated
 * invocations don't leak handlers.
 */
export function runProcess(command: string, ...args: string[]): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    // Unredacted on purpose — held in plain text for the (short) process
    // lifetime and only sanitised at render time by `formatDiagnostic`.
    const display = [command, ...args].join(" ");
    let stderrTail = "";
    // On a spawn `ENOENT`, Node fires both `error` and `close`; settle once so
    // `cleanup()` (which adjusts `setMaxListeners`) runs exactly one time.
    let settled = false;
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "inherit", "pipe"],
      shell: false,
      windowsHide: true,
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk); // preserve cargo's live, colourised stream
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_LIMIT);
    });

    const kill = () => {
      if (!child.killed) child.kill("SIGTERM");
    };
    // `nx run-many` can spawn many executors in parallel; each one adds three
    // listeners. Bump the cap so Node doesn't emit `MaxListenersExceeded`
    // warnings during the peak before any children exit.
    process.setMaxListeners(process.getMaxListeners() + 3);
    process.on("exit", kill);
    process.on("SIGINT", kill);
    process.on("SIGTERM", kill);

    const cleanup = () => {
      process.off("exit", kill);
      process.off("SIGINT", kill);
      process.off("SIGTERM", kill);
      process.setMaxListeners(Math.max(0, process.getMaxListeners() - 3));
    };

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      reportFailure({ error: err, binary: command, command: display });
      cleanup();
      resolve({ success: false });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      // `code === null` means the child was killed by a signal — a failure, but
      // not one to classify (stderr is partial); only classify a real exit code.
      if (code !== null && code !== 0) {
        reportFailure({ stderr: stderrTail, binary: command, command: display });
      }
      cleanup();
      resolve({ success: code === 0 });
    });
  });
}
