import { describe, expect, it } from "vitest";
import { formatDiagnostic, redactSecrets } from "./diagnostics";

describe("formatDiagnostic", () => {
  it("renders the four-part envelope for an error", () => {
    expect(
      formatDiagnostic({
        what: "cargo not found",
        why: "the build executor shells out to cargo",
        command: "cargo build -p app",
        fix: "install rustup via https://rustup.rs",
      }),
    ).toBe(
      [
        "[nxrust] cargo not found",
        "  why: the build executor shells out to cargo",
        "  command: cargo build -p app",
        "  fix: install rustup via https://rustup.rs",
      ].join("\n"),
    );
  });

  it("prefixes the severity for warnings and omits an absent command", () => {
    const out = formatDiagnostic({
      severity: "warning",
      what: "unknown metadata key",
      why: "it is ignored",
      fix: "remove it",
    });
    expect(out.startsWith("[nxrust] warning: unknown metadata key")).toBe(true);
    expect(out).not.toContain("command:");
  });

  it("redacts secret-shaped env assignments in the command field", () => {
    const out = formatDiagnostic({
      what: "publish failed",
      why: "registry rejected the token",
      command: "CARGO_REGISTRY_TOKEN=abc123 cargo publish",
      fix: "check the token",
    });
    expect(out).toContain("CARGO_REGISTRY_TOKEN=<redacted>");
    expect(out).not.toContain("abc123");
  });
});

describe("redactSecrets", () => {
  it("redacts TOKEN/SECRET/KEY/PASSWORD values but keeps the names", () => {
    expect(redactSecrets("FOO=1 MY_SECRET=hunter2 API_KEY=zzz PASSWORD=pw NAME=keep")).toBe(
      "FOO=1 MY_SECRET=<redacted> API_KEY=<redacted> PASSWORD=<redacted> NAME=keep",
    );
  });

  it("leaves a command with no secrets untouched", () => {
    expect(redactSecrets("cargo test -p app")).toBe("cargo test -p app");
  });
});
