/**
 * Entry point for the `@eddacraft/nxrust` Nx plugin. Re-exports the project-graph
 * integration so `nx.json`'s `plugins: ["@eddacraft/nxrust"]` wiring sees the
 * `createNodesV2` + `createDependencies` pair.
 */
export { createNodesV2, createDependencies } from "./graph";

/**
 * Cross-language test-seam contract (D-WN4 / D-009). Severs the inherited
 * `^build` from a JS project's `test` target so JS tests don't serialise on the
 * cargo workspace `target/` lock. Consumed by future WASM/NAPI generators;
 * callable directly when wiring a cross-language edge by hand.
 */
export {
  applyCrossLanguageTestSeam,
  severCrossLanguageTestEdge,
  type CrossLanguageTestSeamOptions,
} from "./utils/cross-language-edges";
