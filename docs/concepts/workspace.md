# Workspace Model

Ewokbot uses repository-local workspace files plus user-level state.

## Repository-local Files

| Path | Role |
| --- | --- |
| `.ewokbot/workspace.yml` | Main workspace configuration. |
| `.ewokbot/.env` | Local secret/environment values. Do not commit. |
| `.ewokbot/.env.example` | Redacted environment template. |
| `.ewokbot/runs/` | Run state, reports, approvals, pauses, and logs. |
| `.ewokbot/cache/` | Workspace cache such as MCP inspection snapshots. |

## User-level Files

| Path | Role |
| --- | --- |
| `~/.config/ewokbot/config.json` | User-level settings. |
| `~/.local/share/ewokbot/auth.json` | Provider auth metadata. |
| `~/.local/share/ewokbot/state/` | User-level runtime state. |
| `~/.cache/ewokbot/` | User-level cache. |

## Repositories

Workspace config can list repositories explicitly or discover sibling git directories. Repository entries can include:

- Name and local path.
- Default and production branches.
- Quality profile.
- Hints for ticket-to-repo matching.
- Staging smoke URLs.
- Deployment mappings for Railway evidence.

## Run State

Runs are persisted under `.ewokbot/runs/`. Control commands such as `runs`, `inspect`, `pause`, `resume`, `logs`, `approve`, and `reject` operate on local run state. Approval and rejection commands record local decisions; they do not merge, deploy, push, or call providers.

For config shape, see [Workspace Config Reference](../reference/workspace-config.md).
