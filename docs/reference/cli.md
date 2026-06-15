# CLI Reference

Run `pnpm ewokbot --help` for exact current help text. This page summarizes public command intent and safety boundaries.

## Setup

| Command | Purpose | Boundary |
| --- | --- | --- |
| `init` | Create local `.ewokbot/` workspace files. | No provider calls or OpenCode auth. |
| `doctor` | Validate local readiness. | No live provider, MCP, git remote, package script, or OpenCode calls. |
| `auth status` | Show provider auth metadata state. | Metadata only. |
| `auth list` | List configured auth metadata. | Metadata only. |
| `auth login <provider>` | Record provider auth metadata. | Does not replace provider-specific setup requirements. |
| `auth logout <provider>` | Remove provider auth metadata. | Local metadata only. |

## Ticket And Planning

| Command | Purpose | Boundary |
| --- | --- | --- |
| `scan` | Read backlog through TicketPort. | Mock by default; read path only. |
| `scan jql <query>` | Read Jira issues by JQL. | Read path only. |
| `scan epic <key>` | Read epic-linked issues. | Read path only. |
| `scan ticket <key>` | Inspect one ticket. | Read path only. |
| `plan <key>` | Prepare local delivery plan. | No code execution. |

## Delivery

| Command | Purpose | Boundary |
| --- | --- | --- |
| `run <key>` | Run mock delivery lifecycle. | Mock/local by default. |
| `run-dev <key> --confirm-dev-execution` | Run confirmed local OpenCode development attempt. | Local branch/OpenCode/quality; no production merge/deploy. |
| `smoke <key> --confirm-real-provider-smoke` | Run confirmed single-ticket real-provider smoke for Jira/GitHub/Railway. | No Vercel call, no Railway mutation, no production PR/merge/deploy. |

## Control Plane

| Command | Purpose | Boundary |
| --- | --- | --- |
| `ui` | Start local invocation UI. | Pre-wired commands only; no raw shell/MCP/operator sandbox. |
| `runs` | List local runs. | Reads `.ewokbot/runs/`. |
| `inspect <run-id>` | Inspect local run state. | Local files only. |
| `status <run-id>` | Show run status. | Local files only. |
| `pause <run-id>` | Request local pause. | Local state only. |
| `resume <run-id>` | Clear local pause. | Local state only. |
| `logs <run-id>` | Show local logs. | Local files only. |
| `approve <run-id>` | Record local human approval. | Does not merge/deploy. |
| `reject <run-id>` | Record local human rejection. | Does not merge/deploy. |

## Worker And Utilities

| Command | Purpose | Boundary |
| --- | --- | --- |
| `worker start --dry-run` | Preview worker behavior. | No delivery execution. |
| `worker start --once` | Run bounded worker pass. | Uses local lock/state controls. |
| `worker start` | Run foreground worker loop. | Graceful shutdown and pause-aware local state. |
| `worker` | Legacy worker command. | Retained for compatibility. |
| `quality` | Run configured quality check surface. | Local command profile. |
| `mcp inspect` | Inspect configured MCP server tools/schemas. | Does not call provider tools. |
| `harness run` | Run deterministic local fixture. | No live providers. |
| `harness run --all` | Run all deterministic fixtures. | No live providers. |
