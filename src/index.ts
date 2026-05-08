/**
 * Entry point for the `@eddacraft/nxrust` Nx plugin. Re-exports the project-graph
 * integration so `nx.json`'s `plugins: ["@eddacraft/nxrust"]` wiring sees the
 * `createNodesV2` + `createDependencies` pair.
 */
export { createNodesV2, createDependencies } from './graph';
