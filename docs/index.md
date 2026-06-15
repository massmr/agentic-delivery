# Ewokbot Documentation

This directory is canonical documentation source for Ewokbot. Public docs and landing pages must be generated from, or tightly aligned to, this content.

## Start Here

| Need | Page |
| --- | --- |
| Install and run locally | [Install](getting-started/install.md) |
| Create workspace files | [Initialize Workspace](getting-started/init.md) |
| Check readiness | [Doctor](getting-started/doctor.md) |
| Understand provider auth metadata | [Auth Metadata](getting-started/auth.md) |
| Understand what exists today | [Product State](concepts/product-state.md) |
| Understand human gates and limits | [Safety Model](concepts/safety-model.md) |
| Run scan and ticket inspection | [Scan And Inspect Tickets](guides/scan-and-plan.md) |
| Run local dev attempts | [Run Dev](guides/run-dev.md) |
| Run confirmed smoke path | [Real-Provider Smoke](guides/smoke.md) |
| Hand off to GitHub | [GitHub Handoff](guides/github-handoff.md) |
| Map Railway staging evidence | [Railway Mapping](guides/railway-mapping.md) |
| Use local UI | [Local Invocation UI](guides/ui.md) |
| Check CLI flags and boundaries | [CLI Reference](reference/cli.md) |
| Configure workspace | [Workspace Config Reference](reference/workspace-config.md) |
| Understand architecture | [Architecture Overview](architecture/overview.md) |

## Documentation Layers

| Layer | Purpose |
| --- | --- |
| Product docs | Practical install, concepts, guides, references, and architecture overview. |
| Deep specs | Long-form product and technical source material under `docs/specs/`. |
| Plans | Approved milestones and future work under `docs/plans/`. |
| Provider references | MCP tool mappings under `docs/reference/`. |
| Runbooks | Operational flows under `docs/runbooks/`. |
| Tracking | Current execution state under `docs/tracking/`. |

## Status Labels

Docs use these labels consistently:

| Label | Meaning |
| --- | --- |
| Today | Implemented in current CLI/runtime. |
| Supervised | Implemented only behind explicit flags, policy, or human approval. |
| Experimental | Present but narrow, local, or provider-dependent. |
| Roadmap-only | Planned or approved, not implemented today. |

## Canonical Sources

For documentation architecture rules, see [docs/README.md](README.md) and [Documentation Architecture](architecture/documentation-architecture.md). For milestone scope, see [Approved Backlog](plans/approved-backlog.md), [Next Actions](tracking/next-actions.md), and [Roadmap](tracking/roadmap.md).
