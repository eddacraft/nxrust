import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  NxrustDiagnosticError,
  cargoNotFound,
  formatDiagnostic,
  invalidToolchainLiteral,
  nightlyRequired,
  redactSecrets,
  runWithDiagnostic,
  targetNotInstalled,
  toolchainNotInstalled,
} from "./diagnostics";

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

  it("redacts secret-bearing flag values too", () => {
    expect(redactSecrets("cargo publish --token sekret123 --dry-run")).toBe(
      "cargo publish --token <redacted> --dry-run",
    );
  });

  it("redacts the `--token=value` form as well", () => {
    expect(redactSecrets("cargo publish --token=sekret123")).toBe(
      "cargo publish --token=<redacted>",
    );
  });
});

describe("toolchain/cargo diagnostic builders", () => {
  it("cargoNotFound carries the slug code and a rustup fix", () => {
    const d = cargoNotFound("cargo build -p app");
    expect(d.code).toBe(DIAGNOSTIC_CODES.cargoNotFound);
    expect(d.code).toBe("nxrust:cargo-not-found");
    expect(d.fix).toContain("https://rustup.rs");
    expect(d.command).toBe("cargo build -p app");
  });

  it("toolchainNotInstalled quotes `rustup install <channel>`", () => {
    const d = toolchainNotInstalled("nightly");
    expect(d.code).toBe("nxrust:toolchain-not-installed");
    expect(d.what).toContain("nightly");
    expect(d.fix).toContain("rustup install nightly");
  });

  it("targetNotInstalled quotes `rustup target add <triple>`", () => {
    const d = targetNotInstalled("x86_64-pc-windows-gnu");
    expect(d.code).toBe("nxrust:target-not-installed");
    expect(d.fix).toContain("rustup target add x86_64-pc-windows-gnu");
  });

  it("nightlyRequired offers both the toml and the --toolchain fix", () => {
    const d = nightlyRequired();
    expect(d.code).toBe("nxrust:nightly-required");
    expect(d.fix).toContain('channel = "nightly"');
    expect(d.fix).toContain("--toolchain=nightly");
  });

  it("invalidToolchainLiteral keeps the legacy `from <origin>` wording", () => {
    const d = invalidToolchainLiteral("a;b", "projectJsonToolchain");
    expect(d.code).toBe("nxrust:invalid-toolchain-literal");
    expect(d.what).toContain("invalid toolchain literal from projectJsonToolchain");
    expect(d.what).toContain('"a;b"');
  });
});

describe("NxrustDiagnosticError", () => {
  it("carries the code and formats the envelope as its message", () => {
    const err = new NxrustDiagnosticError(toolchainNotInstalled("stable"));
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("nxrust:toolchain-not-installed");
    expect(err.message).toBe(formatDiagnostic(err.diagnostic));
    expect(err.message).toContain("[nxrust]");
  });
});

describe("runWithDiagnostic", () => {
  it("throws cargo-not-found on a spawn ENOENT for cargo", () => {
    const error = Object.assign(new Error("spawn cargo ENOENT"), { code: "ENOENT" });
    expect(() => runWithDiagnostic({ error, binary: "cargo" })).toThrow(NxrustDiagnosticError);
    try {
      runWithDiagnostic({ error, binary: "cargo" });
    } catch (e) {
      expect((e as NxrustDiagnosticError).code).toBe("nxrust:cargo-not-found");
    }
  });

  it("classifies rustup 'toolchain not installed' stderr", () => {
    expect(() =>
      runWithDiagnostic({ stderr: "info: ...\nerror: toolchain 'nightly' is not installed" }),
    ).toThrow(/rustup install nightly/);
  });

  it("classifies a missing target stderr", () => {
    let caught: NxrustDiagnosticError | undefined;
    try {
      runWithDiagnostic({
        stderr: "error: the target `x86_64-pc-windows-gnu` must be installed",
      });
    } catch (e) {
      caught = e as NxrustDiagnosticError;
    }
    expect(caught?.code).toBe("nxrust:target-not-installed");
    expect(caught?.message).toContain("rustup target add x86_64-pc-windows-gnu");
  });

  it("classifies a nightly-required stderr", () => {
    let caught: NxrustDiagnosticError | undefined;
    try {
      runWithDiagnostic({ stderr: "error: this feature requires nightly" });
    } catch (e) {
      caught = e as NxrustDiagnosticError;
    }
    expect(caught?.code).toBe("nxrust:nightly-required");
  });

  it("passes unknown cargo stderr through unchanged (no throw)", () => {
    expect(() =>
      runWithDiagnostic({ stderr: "error[E0382]: borrow of moved value: `x`" }),
    ).not.toThrow();
  });

  it("does not flag a stable `requires -Z` advisory as nightly-required", () => {
    expect(() =>
      runWithDiagnostic({
        stderr: "warning: this requires -Zunstable-options; not available on stable",
      }),
    ).not.toThrow();
  });
});
