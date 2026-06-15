# Product State

This page separates implemented behavior from future direction.

## Today

Ewokbot today includes:

| Area | Current behavior |
| --- | --- |
| CLI runtime | `init`, `doctor`, `auth`, `scan`, `plan`, `run`, `run-dev`, `smoke`, `ui`, `worker`, control commands, `mcp inspect`, `quality`, and harness commands. |
| Workspace | Local `.ewokbot/` config, env, runs, logs, cache, and user-level config/auth/state/cache paths. |
| Jira intake | Typed TicketPort for backlog/JQL/epic/ticket reads through mock or configured MCP mode. |
| GitHub handoff | Typed CodeHostPort boundaries for branches, develop PRs, comments, checks, and human-gated production paths. |
| Railway evidence | Read-only staging evidence through explicit project/environment/service mappings and smoke URLs. |
| OpenCode runner | Guarded subprocess-first dev runner for confirmed local development attempts. |
| Quality gates | Typecheck/build/test-style local checks plus meaningful diff and safety guards. |
| Local UI | Safe invocation shell for pre-wired commands, not free-form operator access. |

## Supervised

These paths exist only behind explicit flags, policy, or human approval:

| Area | Boundary |
| --- | --- |
| `run-dev` | Requires `--confirm-dev-execution`; local branch/OpenCode/quality only. |
| `smoke` | Requires `--confirm-real-provider-smoke`; single-ticket Jira/GitHub/Railway path only. |
| GitHub develop PR | Requires configured CodeHostPort permission and passing local evidence. |
| Jira comments | Write action, denied in read-only policy and allowed only under supervised/trusted/custom policy. |
| Production PR approval | Local approval/rejection records only; no autonomous merge/deploy. |

## Experimental

These are implemented narrowly or depend on local/provider setup:

| Area | Boundary |
| --- | --- |
| Railway staging verification | Read-only evidence and configured smoke URLs; no deploy/rollback/scale/variable/domain mutation. |
| MCP registry inspection | Inspects tools and sanitized schemas; it does not call provider tools. |
| Worker loop | Foreground, local lock, restart-safe state reuse, pause controls. |
| UI | Local command surface only; no raw shell or raw MCP execution. |

## Roadmap-only

These are not current behavior:

- Autonomous production merge.
- Autonomous production deployment.
- Operator-agent sandbox with free-form raw shell or MCP access.
- Public documentation site and marketing landing page.
- Broad multi-provider parity beyond current typed surfaces.
- Vercel-backed smoke/deployment path.

For approval rules, see [Safety Model](safety-model.md).
