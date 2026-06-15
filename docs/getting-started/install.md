# Install

Ewokbot is a TypeScript/Node.js CLI. In this repository, use pnpm scripts during development.

## Requirements

| Requirement | Why |
| --- | --- |
| Node.js | Runs the CLI and compiled JavaScript. |
| pnpm | Installs dependencies and runs repository scripts. |
| git | Required for local workspace and handoff flows. |
| OpenCode | Required only for real local development attempts. Ewokbot detects setup; it does not own OpenCode auth. |
| Provider credentials | Required only for configured real provider paths, not mock mode. |

## Install From Source

```bash
pnpm install
pnpm build
pnpm ewokbot --help
```

CLI aliases available in this workspace:

```bash
pnpm ewokbot --help
pnpm ewok --help
pnpm agentic --help
```

## Safe First Run

```bash
pnpm ewokbot init
pnpm ewokbot doctor
pnpm ewokbot run DEMO-123
```

This path uses local workspace files and mock provider behavior unless you change configuration.

## What Install Does Not Do

Install does not:

- Configure Jira, GitHub, Railway, or Vercel credentials.
- Authenticate OpenCode.
- Fetch remote repositories.
- Merge or deploy anything.
- Start background workers.

For workspace setup, continue with [Initialize Workspace](init.md).
