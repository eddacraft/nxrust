// A non-Rust project sharing the workspace with the inferred Rust crates.
// The cache matrix asserts that registering the Rust named inputs in nx.json
// does not disturb caching for non-Rust projects.
export const greeting = "hello from ts-app";
