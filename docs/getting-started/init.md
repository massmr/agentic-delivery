# Initialize Workspace

`ewokbot init` creates local workspace files used by later commands.

## Command

```bash
pnpm ewokbot init
```

Non-interactive setup is available through init flags. Use `pnpm ewokbot init --help` for current flag names.

## Files Created

| Path | Purpose |
| --- | --- |
| `.ewokbot/workspace.yml` | Workspace, providers, repositories, MCP policy, dev runner, quality, and delivery settings. |
| `.ewokbot/.env` | Local environment values. Keep secrets out of git. |
| `.ewokbot/.env.example` | Redacted template for expected variables. |
| `.ewokbot/runs/` | Persisted run state and reports. |
| `.ewokbot/logs/` | Local logs. |
| `.ewokbot/cache/` | Local cache, including optional MCP registry snapshots. |

User-level paths are also used:

| Path | Purpose |
| --- | --- |
| `~/.config/ewokbot/config.json` | User-level CLI settings. |
| `~/.local/share/ewokbot/auth.json` | Ewokbot-owned provider auth metadata. |
| `~/.local/share/ewokbot/state/` | User-level state. |
| `~/.cache/ewokbot/` | User-level cache. |

## Provider Defaults

New workspaces default to mock providers. Jira, GitHub, and Railway can be configured for MCP-backed paths. Vercel appears in auth/status surfaces where implemented, but the current smoke path does not call Vercel.

## Repository Discovery

Workspace config supports explicit repository entries and sibling git directory discovery. Repository entries can include local paths, branch names, quality profiles, hints, staging smoke URLs, and deployment mappings.

## Boundaries

`init` does not install OpenCode, log into providers, validate live MCP servers, or call provider APIs. Use [Doctor](doctor.md) for local readiness checks after initialization.
