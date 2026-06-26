import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProcess } from "./run-process";

/**
 * Integration coverage for the diagnostic wiring: a failed spawn / classified
 * stderr must surface a structured `[nxrust]` envelope, while unknown cargo
 * output passes through untouched.
 */
describe("runProcess diagnostics", () => {
  let stderr: string;

  beforeEach(() => {
    stderr = "";
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr += chunk.toString();
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a structured diagnostic when the binary cannot be spawned (ENOENT)", async () => {
    const result = await runProcess("nxrust-nonexistent-binary-xyz");
    expect(result.success).toBe(false);
    expect(stderr).toContain("[nxrust]");
    expect(stderr).toContain("failed to spawn");
  });

  it("classifies a 'toolchain not installed' stderr into a structured fix", async () => {
    const result = await runProcess(
      "node",
      "-e",
      "process.stderr.write(\"error: toolchain 'nightly' is not installed\"); process.exit(1);",
    );
    expect(result.success).toBe(false);
    expect(stderr).toContain("[nxrust] Rust toolchain `nightly` is not installed");
    expect(stderr).toContain("rustup install nightly");
  });

  it("leaves unknown cargo output untranslated", async () => {
    const result = await runProcess(
      "node",
      "-e",
      'process.stderr.write("error[E0382]: borrow of moved value"); process.exit(1);',
    );
    expect(result.success).toBe(false);
    expect(stderr).toContain("error[E0382]"); // cargo's own line teed through
    expect(stderr).not.toContain("[nxrust]"); // no fabricated diagnostic
  });

  it("adds no diagnostic on success", async () => {
    const result = await runProcess("node", "-e", "process.exit(0);");
    expect(result.success).toBe(true);
    expect(stderr).not.toContain("[nxrust]");
  });
});
