# nxrust diagnostics catalogue

Every plugin-detectable failure surfaces through the shared diagnostic envelope
(`formatDiagnostic`, APS module 14 / spec §6.14):

```
[nxrust] <what>
  why: <why>
  command: <command, if safe to print — secrets redacted>
  fix: <fix>
```

Each diagnostic carries a stable, slug-based **code** with an `nxrust:` prefix
(D-D5). Codes are part of the public contract: renaming or removing one is a
major version bump; adding one is a minor bump (D-008). Secret-shaped values in
the `command:` field (`TOKEN`, `SECRET`, `KEY`, `PASSWORD`, and `--token`-style
flags) are redacted to `<redacted>`.

## Toolchain & cargo pre-flight family

These cover a missing `cargo`, an uninstalled toolchain channel or target, a
nightly-only invocation, and an unsafe toolchain literal. They are classified
from spawn errors and `rustup`/`cargo` stderr at the single process chokepoint
(`runWithDiagnostic` in `src/utils/diagnostics.ts`).

| Code                               | Trigger                                                           | Fix                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `nxrust:cargo-not-found`           | `cargo`/`rustup` not on PATH (`spawn ENOENT`)                     | Install the Rust toolchain via <https://rustup.rs>.                                            |
| `nxrust:toolchain-not-installed`   | rustup stderr `toolchain '<channel>' is not installed`            | `rustup install <channel>`                                                                     |
| `nxrust:target-not-installed`      | stderr `the target \`<triple>\` must be installed` (and variants) | `rustup target add <triple>`                                                                   |
| `nxrust:nightly-required`          | a nightly-only feature used on a non-nightly channel              | Add `[toolchain] channel = "nightly"` to `rust-toolchain.toml`, or pass `--toolchain=nightly`. |
| `nxrust:invalid-toolchain-literal` | a resolved channel literal fails the shell-safety pattern         | Use a channel like `stable`, `nightly`, or `1.81.0`.                                           |
| `nxrust:spawn-failed`              | a spawn failed for an unclassified reason                         | Confirm the binary is installed and executable, then retry.                                    |

> Unknown cargo output (rustc compile errors and the like) is **not** translated
> — cargo prints its own error inline and nxrust leaves it untouched (module 14
> Out-of-Scope). Only the plugin-detectable shapes above are wrapped.

Later DIAG slices append their codes here (workspace-shape, `cargo metadata`,
duplicate-package, release-publish, supply-chain, and the cross-language
`^build` seam warning surfaced by `nxrust doctor`).
