<!-- APS Module: 09-supply-chain -->
<!-- Status: Proposed -->

# Supply Chain

Security and governance targets: `audit`, `deny`, `outdated`, `vet`,
`sbom`, `licenses`.

| ID | Owner | Status |
|----|-------|--------|
| SUPPLY | eddacraft | Proposed |

## Purpose

Rust dependency governance is increasingly table-stakes. Anvil's
deterministic-governance story makes it explicit. Spec §6.9 calls for a
first-class set of supply-chain executors backed by `cargo audit`,
`cargo deny`, `cargo outdated`, `cargo vet`, an SBOM tool of choice
(`cargo auditable`, `cargo cyclonedx`), and `cargo deny`'s licence checks.

The design constraint: every tool here is **optional and presence-aware**.
A missing `cargo audit` binary is a clear "install with `cargo install
cargo-audit`" diagnostic, never a raw shell error.

## In Scope

**Executors (spec §6.9):**

- `audit` — `cargo audit`. Cache result; outputs `audit.json` when
  requested. Cacheable per (workspace lockfile content hash + audit DB
  version).
- `deny` — `cargo deny check`. Cache result; outputs report when
  requested. Cacheable per (workspace lockfile + `deny.toml` content
  hash).
- `outdated` — `cargo outdated`. Cache result; outputs `outdated.json`.
  Note: `cargo outdated` queries the registry, so cache must include
  registry index state at invocation time (or accept a short TTL).
- `vet` — `cargo vet`. Cache result. Requires the consumer to have
  imported a vet store.
- `sbom` — configurable tool (`cargo auditable`, `cargo cyclonedx`, or
  any binary on PATH that produces a documented format). Plugin option
  selects the tool.
- `licenses` — `cargo deny check licenses` (subset of `deny`). Provided
  as a sibling executor for consumers who want only licence enforcement
  without the rest of `deny`.

**Workspace-level vs crate-level (spec §6.9, index Open Question):**

- All six executors are infer-able both at the crate level and at the
  synthetic `rust-workspace` level
  ([12-workspace-synthetic-project](./12-workspace-synthetic-project.aps.md)).
- Default: workspace-level (these tools are typically run once for the
  whole `Cargo.lock`).
- Per-crate available for consumers who want crate-scoped reports.

**Tool-presence detection (spec §6.9):**

- On first invocation per Nx session, the executor checks the tool is
  on PATH.
- Missing tool ⇒ structured error via
  [14-diagnostics](./14-diagnostics.aps.md): "what failed (tool
  missing), why (target X needs tool Y), exact command (none ran),
  suggested fix (`cargo install cargo-audit` etc.)".
- Optional `cargo install` shortcut behind explicit `--install-missing`
  flag — never automatic.

## Out of Scope

- Acting on findings — the plugin runs the tools and reports; remediation
  is the consumer's job.
- Vendoring `cargo audit`'s advisory DB. Stays the upstream RustSec DB.
- Cargo plugins not in the spec list (`cargo-bloat`, `cargo-supply-chain`,
  `cargo-geiger`). Easy to add later if a consumer asks — D-007 gate.
- Default `deny.toml` content — generator concern in
  [07-generators](./07-generators.aps.md) (`--with-deny`).
- Workspace-level synthetic project itself — that's
  [12-workspace-synthetic-project](./12-workspace-synthetic-project.aps.md).

## Interfaces

### Depends On

- `cargo audit`, `cargo deny`, `cargo outdated`, `cargo vet`, `cargo
  auditable` / `cargo cyclonedx` as installable binaries. Public Cargo
  ecosystem contract.
- [03-target-inference](./03-target-inference.aps.md) — these targets are
  inferred per crate.
- [12-workspace-synthetic-project](./12-workspace-synthetic-project.aps.md)
  — these targets are also inferred at the workspace level.
- [14-diagnostics](./14-diagnostics.aps.md) — tool-missing error format.

### Exposes

- Six executors in `executors.json`: `audit`, `deny`, `outdated`, `vet`,
  `sbom`, `licenses`.
- Cache rules per the table above.
- Tool-presence diagnostic surface.
- Plugin options:
  - `sbomTool` — name of the SBOM tool to invoke.
  - `denyConfig` — path to `deny.toml`.
  - `auditDbPath` — local advisory DB override (CI ergonomics).

## Constraints

- **Optional tools.** Every executor here gracefully degrades — missing
  tool ⇒ diagnostic, not crash.
- **Cache-key correctness.** Lockfile content hash + tool version + tool
  config hash, all participate in the key.
- **No silent network calls.** `cargo outdated` queries the registry;
  document the network dependency and cache TTL.
- **Licence policy lives in `deny.toml`, not in the plugin.** The plugin
  invokes; the consumer configures.
- **Workspace-level by default for these targets.** Per-crate is opt-in.

## Ready Checklist

Promote individual Work Items to Ready when:

- [ ] A real consumer asks for the specific tool (per D-007).
- [ ] The consumer's tool config is captured (e.g. their `deny.toml`,
      their advisory-DB source, their SBOM format choice).
- [ ] A Work Item is drafted scoped to that tool.

## Work Items

*No work items yet — module is Proposed. Items promote individually on
real-consumer asks per D-007.*

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `cargo audit` advisory DB changes upstream and stale-caches a vulnerability | high | medium | DB version participates in cache key; CI invalidates daily via a scheduled job in the consumer's workflow |
| `cargo outdated` cache stales out within a release cycle | medium | high | Cache TTL on `outdated` (e.g. 24h) or document as cache-miss-on-network-change |
| Tool-version drift between local and CI yields different reports | medium | medium | Tool version in cache key; document the version pin convention (`cargo install --locked` for CI) |
| `cargo vet` setup cost is non-trivial for new adopters | medium | medium | Document the `cargo vet init` flow; do not auto-init on the consumer's behalf |
| `sbom` tool surface is too pluggable to test | medium | low | Test one default tool (`cargo auditable`); other tools work but are user-validated |
| `cargo install --install-missing` runs in CI surprises | high | low | `--install-missing` is never the default; document and require explicit flag |

## Decisions

- **D-SC1:** Tools are optional and presence-aware. Missing tool ⇒
  diagnostic via [14-diagnostics](./14-diagnostics.aps.md), never crash.
  *Accepted (inherits spec §6.9).*
- **D-SC2:** Workspace-level by default for these targets; per-crate is
  opt-in. *Accepted.*
- **D-SC3:** Tool version + config hash + lockfile content participate
  in the cache key. *Accepted.*
- **D-SC4:** `--install-missing` is explicit-only; never default. *Accepted.*

## Open Questions

- [ ] Should `audit` run on a schedule independent of `nx affected`?
      Vulnerabilities can land without any source change. CI-side
      concern, but the plugin could expose a "force-run" hint.
- [ ] What's the right SBOM default — `cargo auditable` (embeds
      metadata into the binary, lightweight) or `cargo cyclonedx`
      (separate CycloneDX file, more portable)? Defer to first promotion.
- [ ] Should `licenses` be its own executor or a `deny --licenses` flag?
      Separate executor is more discoverable; spec §6.9 lists it
      separately. Keep separate.
- [ ] Should `cargo vet` integration include a "lazy import" mode where
      the plugin's first invocation runs `cargo vet init` for the
      consumer? No — automatic vet init is too opinionated.
