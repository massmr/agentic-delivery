# Documentation Architecture

Milestone BK defines how Ewokbot documentation stays trustworthy as user-facing docs and future public site work grow.

## Authority Order

1. `docs/specs/`, `docs/reference/`, `docs/runbooks/`, `docs/plans/`, `docs/tracking/`, and `docs/prompts/` remain the deep factual layer.
2. Consolidated docs under `docs/getting-started/`, `docs/concepts/`, `docs/guides/`, and `docs/architecture/` explain and connect the deep layer.
3. Repository `README.md` stays a concise entrypoint.
4. Future public docs and landing pages are downstream surfaces.

When surfaces disagree, update the downstream surface to match the canonical docs or update the canonical docs first in an approved milestone.

## Canonical Inputs By Topic

| Topic | Canonical source |
|---|---|
| Product vision, current scope, human approval boundaries | `docs/specs/product-spec.md` |
| Runtime architecture, CLI shape, typed ports, state machine, quality policy | `docs/specs/technical-architecture.md` |
| MCP-first provider model, policy modes, native fallback boundaries | `docs/specs/mcp-first-architecture.md` |
| Quality gates, meaningful diff, safety loop, escalation rules | `docs/specs/quality-gates.md` |
| Approved milestones and scope constraints | `docs/plans/approved-backlog.md` |
| Public docs/site strategy | `docs/plans/documentation-site-plan.md` |
| Current sequence, completed work, blockers, decisions | `docs/tracking/` |
| Provider tool contracts | `docs/reference/*-mcp-tools.md` |
| Real-provider operation procedure | `docs/runbooks/ticket-run.md` |

## README Role

`README.md` should answer four questions quickly:

- What is Ewokbot?
- How do I install/build/run it locally?
- Where do I find the canonical docs?
- What safety boundary should I know before trying real-provider commands?

It should not duplicate every command, provider mapping, architecture detail, or roadmap decision.

## Future Public Site Role

The future public site may improve navigation, presentation, and discoverability. It must not become a separate product source of truth.

Site pages should map directly to canonical docs pages or sections. If public copy needs a capability claim, that claim must be traceable to current docs and current behavior.

## Feature Status Rules

| Label | Meaning | Documentation rule |
|---|---|---|
| Today | Implemented in the CLI/runtime. | Document as usable and link to command/reference material. |
| Supervised | Implemented, but gated by explicit confirmation, policy, or human approval. | State the gate next to the workflow. |
| Experimental | Implemented or partially implemented for validation. | Document limits and avoid production-ready language. |
| Roadmap-only | Planned but not implemented. | Keep in roadmap/limits pages and never in quickstart as current behavior. |

## Provider Status Rules

Provider pages must state:

- implemented surface,
- mock/read-only/supervised/partially real status,
- typed business port or command it powers,
- raw MCP or destructive actions that remain blocked,
- credential ownership boundary.

Current provider framing:

- Atlassian/Jira: first implemented work-item surface through typed ticket intake and comments.
- GitHub: branch, develop PR handoff, comments, and checks through typed code-host surface; production merge remains human-only.
- Railway: read-only staging evidence and per-repository mapping; mutating deployment actions remain outside current autonomous runtime.
- Vercel: setup/status presence only where implemented; do not present as current smoke/staging path unless code supports it.
- OpenCode: external development runner; Ewokbot detects readiness and invokes only through guarded subprocess contracts.

## Preservation Rule

BK does not delete, thin, or replace existing specs, plans, references, runbooks, tracking docs, or prompts. Later docs may summarize them, but those summaries must link back to the source material.
