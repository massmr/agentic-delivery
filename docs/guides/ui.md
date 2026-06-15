# Local Invocation UI

`ewokbot ui` starts a local control surface for safe, pre-wired Ewokbot commands.

## Command

```bash
pnpm ewokbot ui
```

## What It Is For

The UI helps operators inspect workspace status and invoke supported Ewokbot flows without memorizing every command.

## Boundaries

The current UI is not:

- A free-form operator-agent sandbox.
- A raw shell terminal.
- A raw MCP tool console.
- A production deploy button.
- A production merge button.

## Safety Model

UI actions must preserve the same command boundaries as CLI invocation. Real provider paths still require configured providers, policy permission, and explicit confirmation where the CLI requires it.

Operator-agent sandbox work remains roadmap-only and must not be described as current behavior.
