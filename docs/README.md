# Ewokbot Documentation

This `docs/` tree is the canonical source of truth for Ewokbot product behavior, architecture, provider boundaries, plans, runbooks, and milestone tracking.

`README.md` is the repository front door. Future public docs and landing pages must be downstream of these canonical docs, not a separate narrative.

## Documentation Map

| Area | Purpose | Canonical inputs |
|---|---|---|
| Getting Started | Install, initialize, validate, authenticate, and run the first safe commands. | `docs/specs/product-spec.md`, `docs/specs/technical-architecture.md`, `README.md` |
| Concepts | Workspace model, MCP-first ports, safety modes, run lifecycle, provider roles. | `docs/specs/mcp-first-architecture.md`, `docs/specs/quality-gates.md` |
| Guides | Task workflows such as scan, ticket inspection, dry-run planning, run-dev, smoke, GitHub handoff, Railway mapping, and local UI use. | `docs/runbooks/`, `docs/tracking/progress-log.md`, implementation-backed command behavior |
| Reference | CLI, workspace config, provider MCP mappings, policy labels, tool registries, and typed-port contracts. | `docs/reference/`, `docs/specs/technical-architecture.md` |
| Architecture | Product and runtime explanations that orient contributors without replacing deep specs. | `docs/specs/`, `docs/prompts/`, `docs/plans/` |
| Runbooks | Operational procedures for real provider runs and incident-style follow-up. | `docs/runbooks/`, `docs/tracking/risks-and-blockers.md` |
| Roadmap And Limits | Current milestone sequence, completed work, blockers, and future-only ideas. | `docs/tracking/`, `docs/plans/approved-backlog.md` |

## Current Canonical Structure

- `docs/specs/` contains deep product and technical architecture specs.
- `docs/plans/` contains approved milestone definitions and future implementation plans.
- `docs/getting-started/` contains install, init, doctor, and auth docs for first-time setup.
- `docs/concepts/` contains product state, workspace, MCP-first, and safety explanations.
- `docs/guides/` contains task-oriented workflows for scan, run-dev, smoke, handoff, Railway, and UI use.
- `docs/reference/` contains detailed provider and MCP tool references.
- `docs/runbooks/` contains operator procedures.
- `docs/tracking/` contains current roadmap, next actions, progress, decisions, risks, and blockers.
- `docs/prompts/` contains preserved build prompts and agent instructions that remain useful context.
- `docs/architecture/` contains orientation material and documentation architecture.

## Status Labels

Use these labels consistently in documentation:

- **Today**: implemented behavior in the current CLI/runtime.
- **Supervised**: implemented behavior that still requires explicit operator confirmation or human approval.
- **Experimental**: implemented or partially implemented behavior intended for narrow validation, not broad production operation.
- **Roadmap-only**: planned behavior not implemented yet.

Do not describe roadmap-only behavior as current capability.

## Source-Of-Truth Rules

- Preserve deep specs, plans, reference pages, runbooks, tracking docs, and prompts unless a later approved milestone explicitly replaces them.
- Consolidated product docs should summarize and cross-link canonical material instead of thinning it.
- Provider docs must state whether each provider is mock-only, read-only, supervised, partially real, or not implemented.
- Public docs and landing pages must be generated from or kept tightly aligned to this `docs/` tree.
- Production merge and production deployment remain human-only unless a future approved milestone changes that constraint.

## Docs Milestone State

- BK established this canonical documentation architecture.
- BL adds consolidated product docs for the complete user journey.
- BM will build the public docs and landing surface from these canonical docs.
