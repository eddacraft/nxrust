import {
  formatFiles,
  logger,
  readProjectConfiguration,
  updateProjectConfiguration,
  type Tree,
} from "@nx/devkit";
import { severCrossLanguageTestEdge } from "../../utils/cross-language-edges";
import { formatDiagnostic } from "../../utils/diagnostics";

export interface AddRustReferenceSchema {
  /** The JS/TS project that consumes the Rust crate. */
  project: string;
  /** The Rust crate being consumed (informational; validated to exist). */
  crate: string;
  /**
   * Retain the inherited `^build` on the JS `test` target. Only correct when the
   * JS build genuinely imports the Rust artefact at TS build time (a WASM module
   * bundled into webpack/Vite, a generated `.d.ts` consumed by `tsc`). Defaults
   * to false per D-009 / D-WN4 — a NAPI `.node` is loaded at `require` time, so
   * JS tests must not gate on a cargo build.
   */
  consumesArtifactAtBuildTime?: boolean;
  skipFormat?: boolean;
}

const NXRUST_EXECUTOR_PREFIX = "@eddacraft/nxrust:";

/**
 * Wire a JS/TS project to a sibling Rust crate with the D-009 cross-language
 * test-seam contract. This is the kind-agnostic core that the future
 * `add-napi` / `add-wasm-reference` generators (module 10, Proposed) wrap once
 * their binding-specific scaffolding (manifest deltas, npm dirs, bundler glue)
 * is promoted; here we own only the part that every cross-language edge needs
 * and that Nx gets wrong by default — the `test.dependsOn` seam.
 *
 * It materialises an explicit `test.dependsOn` on the JS project (severing the
 * workspace-default `^build`, or retaining it under
 * `consumesArtifactAtBuildTime`) via {@link severCrossLanguageTestEdge}, so a JS
 * test never pulls a transitive cargo build and serialises on the workspace
 * `target/` lock (ISS-001). Idempotent.
 */
export default async function addRustReferenceGenerator(
  tree: Tree,
  options: AddRustReferenceSchema,
): Promise<void> {
  // `readProjectConfiguration` throws a clear devkit error if either is absent.
  const jsProject = readProjectConfiguration(tree, options.project);
  const crate = readProjectConfiguration(tree, options.crate);

  const crateIsRust = Object.values(crate.targets ?? {}).some(
    (target) =>
      typeof target?.executor === "string" && target.executor.startsWith(NXRUST_EXECUTOR_PREFIX),
  );
  if (!crateIsRust) {
    logger.warn(
      formatDiagnostic({
        severity: "warning",
        what: `\`${options.crate}\` does not look like an nxrust Rust crate (no \`@eddacraft/nxrust:*\` target).`,
        why: "the cross-language seam is intended for a JS project consuming a Rust crate.",
        fix: "double-check the --crate name; the test-seam edit is applied to --project regardless.",
      }),
    );
  }

  const updated = severCrossLanguageTestEdge(jsProject, {
    consumesArtifactAtBuildTime: options.consumesArtifactAtBuildTime,
  });
  updateProjectConfiguration(tree, options.project, updated);

  const retained = options.consumesArtifactAtBuildTime === true;
  logger.info(
    `[nxrust] add-rust-reference: ${
      retained ? "retained" : "severed"
    } \`^build\` on \`${options.project}\` test target (consumes \`${options.crate}\`${
      retained ? "" : "; runtime-only edge"
    }).`,
  );

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}
