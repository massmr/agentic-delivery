# Auth Metadata

Ewokbot stores provider auth metadata for its own provider surfaces. It does not own all tools' credentials.

## Commands

```bash
pnpm ewokbot auth status
pnpm ewokbot auth list
pnpm ewokbot auth login <provider>
pnpm ewokbot auth logout <provider>
```

Supported provider metadata surfaces include Atlassian/Jira, GitHub, Railway, and Vercel where implemented.

## What Auth Means

Auth metadata records whether Ewokbot knows how a provider should be reached. Real provider calls still require matching workspace config, environment variables, MCP server setup, and policy permission.

## OpenCode Boundary

OpenCode authentication is external. Ewokbot detects whether OpenCode is usable for local dev runs, but it does not install OpenCode, log into OpenCode, or store OpenCode credentials.

## Secret Handling

Secrets must stay outside git. `.ewokbot/.env` is local. Reports and doctor output should redact secret-like values.

## Safe Default

Mock mode does not require provider credentials. Configure credentials only for commands that explicitly need real provider access, such as confirmed smoke paths.
