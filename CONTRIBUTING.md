# Contributing to Ewokbot

Thanks for helping improve Ewokbot.

## Development Setup

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Safety Rules

Ewokbot is an autonomous delivery runtime, so contribution safety matters.

- Keep mock mode as the default.
- Do not add tests that require live provider credentials.
- Do not commit `.env` files, tokens, API keys, or captured provider responses containing private data.
- Keep external SaaS integrations behind typed ports.
- Keep raw MCP tool names inside adapter/config layers.
- Do not add autonomous production merge or production deployment behavior.
- Add idempotency protection for provider write operations.

## Pull Request Checklist

Before opening a pull request:

```bash
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

For provider work, include tests with mock clients or fake subprocess executors.

## Architecture Notes

Start with:

- `docs/specs/product-spec.md`
- `docs/specs/technical-architecture.md`
- `docs/specs/mcp-first-architecture.md`
- `docs/tracking/roadmap.md`

When in doubt, prefer a small typed contract plus tests over a live provider shortcut.
