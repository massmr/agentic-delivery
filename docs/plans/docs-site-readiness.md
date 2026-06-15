# Documentation Site Readiness Inventory

This inventory prepares milestone BM without implementing the public documentation site or landing page. `docs/` remains the canonical source of truth, and any future site must be generated from or manually kept aligned with the files listed here.

## BM Scope Boundary

BM may add a public docs site and landing page later. This prep pass does not add a site framework, route tree, marketing page, hosted deployment, analytics, or visual design system.

BM must not describe unsupported behavior as current product behavior. In particular, the site must not claim autonomous production merge, autonomous production deploy, broad provider parity, a Vercel-backed delivery path, raw shell access, raw MCP access, or an operator-agent sandbox.

## Proposed Public Navigation

| Public page | Canonical source |
| --- | --- |
| Landing overview | `README.md`, `docs/index.md`, `docs/concepts/product-state.md` |
| Install | `docs/getting-started/install.md` |
| Initialize workspace | `docs/getting-started/init.md`, `docs/reference/workspace-config.md` |
| Check readiness | `docs/getting-started/doctor.md` |
| Auth metadata | `docs/getting-started/auth.md` |
| Current product state | `docs/concepts/product-state.md` |
| Safety model | `docs/concepts/safety-model.md`, `docs/specs/quality-gates.md` |
| Workspace model | `docs/concepts/workspace.md`, `config/workspace.example.yml` |
| MCP-first architecture | `docs/concepts/mcp-first.md`, `docs/specs/mcp-first-architecture.md` |
| Scan and inspect tickets | `docs/guides/scan-and-plan.md`, `docs/reference/atlassian-mcp-tools.md` |
| Run local development | `docs/guides/run-dev.md` |
| Real-provider smoke | `docs/guides/smoke.md` |
| GitHub handoff | `docs/guides/github-handoff.md`, `docs/reference/github-mcp-tools.md` |
| Railway staging mapping | `docs/guides/railway-mapping.md`, `docs/reference/railway-mcp-tools.md` |
| Local invocation UI | `docs/guides/ui.md` |
| CLI reference | `docs/reference/cli.md`, `src/cli/program.ts` |
| Architecture overview | `docs/architecture/overview.md`, `docs/specs/technical-architecture.md` |
| Documentation authority model | `docs/README.md`, `docs/architecture/documentation-architecture.md`, `docs/plans/documentation-site-plan.md` |

## Landing Page Content Inventory

Future landing content can safely use these claims:

- Ewokbot is an open-source TypeScript/Node.js CLI for supervised agentic delivery.
- It connects ticket intake, repository selection, OpenCode execution, local quality gates, GitHub develop handoff, and Railway staging evidence.
- Mock mode is the default safe path.
- Real-provider actions require workspace configuration, explicit confirmation, and policy approval.
- Production merge and production deployment remain human-only.
- Current public docs are repository docs; BM may add a downstream site, but the site must not become a separate truth source.

Future landing content must not use these claims unless later milestones implement them:

- autonomous production deployment,
- autonomous production PR merge,
- hosted SaaS control plane,
- operator-agent chat or sandbox,
- raw shell or raw MCP tool access,
- Vercel-backed smoke/deployment verification,
- production-ready support for providers beyond the documented current surfaces.

## Site Build Expectations

BM should add a docs-site stack only after choosing a framework intentionally. Acceptable future implementations include a static docs generator, an Astro/Next/Vite documentation app, or a generated markdown export, as long as source content remains traceable to `docs/`.

Minimum BM verification should include:

- site build command in `package.json`,
- link check or route smoke for every public nav entry,
- grep check for high-risk unsupported claims,
- docs-source mapping check for every public page,
- local screenshot or browser smoke for landing and docs navigation if a browser-rendered site is added,
- no staged changes to product runtime code unless BM explicitly approves them.

## Gap List Before BM Completion

- Select site framework and hosting target.
- Decide whether public docs are generated from markdown, imported from markdown, or manually mirrored with source links.
- Define public route names and redirects.
- Add link-check tooling.
- Add build command and CI-compatible verification command.
- Decide how versioned docs will work once public docs exist.
- Decide whether provider reference pages remain full repo-only pages or get summarized public pages with links back to canonical references.

## Copy Guardrails

Use the status labels from `docs/architecture/documentation-architecture.md` everywhere:

- Today: implemented in CLI/runtime.
- Supervised: implemented but gated by confirmation, policy, or human approval.
- Experimental: implemented or partially implemented for narrow validation.
- Roadmap-only: planned but not implemented.

BM landing copy should prioritize trust over hype. Each claim must be traceable to one canonical source file listed in this inventory.
