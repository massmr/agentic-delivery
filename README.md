# Ewokbot

Ewokbot is an open-source TypeScript/Node.js CLI for supervised agentic delivery. It turns work items into local development runs, quality evidence, GitHub handoff, and staging verification while keeping production merge and deployment under human approval.

The product is early and conservative by design. Mock mode is the default. Real provider paths require explicit configuration and confirmation flags.

## Current Shape

Today Ewokbot can:

- Initialize a local `.ewokbot/` workspace and user-level state paths.
- Check local readiness with `doctor` without making live provider calls.
- Store Ewokbot-owned provider auth metadata while leaving OpenCode authentication external.
- Scan and inspect Jira-backed work through typed TicketPort boundaries.
- Run mock delivery lifecycles and local harness scenarios.
- Run confirmed local development attempts through OpenCode with quality gates.
- Open or prepare GitHub develop-branch handoff where configured.
- Collect Railway staging evidence through read-only mappings and smoke URLs.
- Run a confirmed single-ticket real-provider smoke path for Jira/GitHub/Railway.
- Start a local invocation UI for safe, pre-wired commands.

Ewokbot does not autonomously merge production PRs, deploy to production, rotate secrets, expose raw shell/MCP access, or run the roadmap-only operator-agent sandbox.

## Install

```bash
pnpm install
pnpm build
pnpm ewokbot --help
```

Package aliases are `ewokbot`, `ewok`, and `agentic`.

## Quickstart

```bash
pnpm ewokbot init
pnpm ewokbot doctor
pnpm ewokbot scan ticket DEMO-123
pnpm ewokbot run DEMO-123
pnpm ewokbot ui
```

Confirmed real-ish paths require explicit flags:

```bash
pnpm ewokbot run-dev DEMO-123 --confirm-dev-execution
pnpm ewokbot smoke DEMO-123 --confirm-real-provider-smoke
```

## Documentation

`docs/` is canonical source of truth. This README is only repository front door.

- Start at [docs/index.md](docs/index.md).
- Read install/setup docs in [docs/getting-started/install.md](docs/getting-started/install.md).
- Review product boundaries in [docs/concepts/safety-model.md](docs/concepts/safety-model.md).
- Use command reference in [docs/reference/cli.md](docs/reference/cli.md).
- See architecture overview in [docs/architecture/overview.md](docs/architecture/overview.md).
- See current/future status in [docs/concepts/product-state.md](docs/concepts/product-state.md).

Deep specs, plans, runbooks, provider references, and tracking files remain in `docs/specs/`, `docs/plans/`, `docs/runbooks/`, `docs/reference/`, and `docs/tracking/`.

## Safety Defaults

- Mock providers by default.
- No credentials required in mock mode.
- No live Jira/GitHub/Railway calls unless configured and explicitly invoked.
- No provider mutation from `doctor`, `mcp inspect`, or the local UI status surfaces.
- Production merge and deploy remain human-only.
- MCP provider tools are wrapped behind typed ports and policy decisions.

## Development

```bash
pnpm typecheck
pnpm build
pnpm test
```

Before changing behavior, read repository instructions in [AGENTS.md](AGENTS.md) and the canonical docs map in [docs/README.md](docs/README.md).
