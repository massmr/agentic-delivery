# Real-Provider Smoke

`smoke` is a confirmed single-ticket path for real provider integration evidence. It is not a production deploy path.

## Command

```bash
pnpm ewokbot smoke DEMO-123 --confirm-real-provider-smoke
```

The confirmation flag is required.

## Required Provider Shape

Current smoke expects configured Jira, GitHub, and Railway provider paths. It does not call Vercel.

Typical path:

1. Validate provider readiness.
2. Read one Jira ticket.
3. Resolve one local repository.
4. Run local branch/OpenCode/quality evidence.
5. Use GitHub handoff boundaries for develop PR where configured.
6. Collect read-only Railway staging evidence and configured smoke URL results.
7. Stop at staging verified, failure, or human-required state.

## Explicit Non-goals

Smoke does not:

- List and drain a full backlog.
- Transition Jira issues outside typed handoff behavior.
- Call Railway deploy, rollback, scale, variable, source, or domain mutation tools.
- Call Vercel.
- Prepare or open production PRs.
- Merge or deploy production.

## Tests

Repository tests for smoke use fake providers. They do not contact live Jira, GitHub, Railway, Vercel, or OpenCode services.
