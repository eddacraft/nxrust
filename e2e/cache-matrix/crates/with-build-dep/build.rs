// Build script with a build-dependency on `solo`. The dependency edge is what
// the matrix exercises; the script itself only emits a rerun directive so the
// build stays hermetic and cache-stable.
fn main() {
    let _ = solo::solo_value();
    println!("cargo:rerun-if-changed=build.rs");
}
