# Workspace Config Reference

Main workspace config lives at `.ewokbot/workspace.yml`. See `config/workspace.example.yml` for a complete example.

## Top-level Sections

| Section | Purpose |
| --- | --- |
| `workspace` | Workspace name, autonomy, branch defaults, concurrency. |
| `jira` | Jira provider mode and project/base-url settings. |
| `github` | GitHub provider mode and repository owner settings. |
| `railway` | Railway provider mode and staging evidence settings. |
| `dev_runner` | OpenCode command, args, timeout, environment allowlist, attempts. |
| `quality` | Default and named quality profiles. |
| `delivery` | Delivery policy settings. |
| `mcp_servers` | MCP server commands and environment allowlists. |
| `mcp_policy` | Provider tool policy mode and custom decisions. |
| `repos` | Explicit repository list or discovery settings. |

## Workspace

Common workspace settings include:

| Key | Meaning |
| --- | --- |
| `name` | Workspace display name. |
| `autonomy` | Delivery autonomy mode. |
| `staging_branch` | Default staging/develop branch. |
| `production_branch` | Default production branch. |
| `max_concurrent_tickets` | Worker concurrency limit. |

## Provider Modes

Jira, GitHub, and Railway default to `mock`. Real provider paths use `mcp` where supported and configured.

Vercel is not part of the current smoke path. Document Vercel only where a command or surface explicitly supports it.

## Dev Runner

Current dev runner provider is OpenCode. It can run in mock or real mode. Real mode uses configured command/args and an environment variable allowlist.

Ewokbot does not own OpenCode login state.

## Repositories

Repository config can include:

- `name`
- `url`
- `local_path`
- `default_branch`
- `production_branch`
- `quality_profile`
- `hints`
- `staging_smoke_urls`
- `deployments`

Discovery can also scan sibling git directories when configured.

## Deployment Mapping

Railway staging mappings use explicit project, environment, and service identifiers where possible. Verification modes include `railway_mcp`, `http_smoke`, `github_only`, and `none`.

## Secrets

Keep secrets in `.ewokbot/.env` or external secret stores. Do not commit credentials. MCP server environment allowlists should contain only variables the server needs.
