# Run Dev

`run-dev` performs a confirmed local development attempt. It is supervised and intentionally stops before production.

## Command

```bash
pnpm ewokbot run-dev DEMO-123 --confirm-dev-execution
```

The confirmation flag is required.

## What It Can Do

When configured, `run-dev` can:

- Read one ticket.
- Resolve a local repository/worktree target.
- Create or use a local branch.
- Invoke OpenCode through the guarded DevRunnerPort.
- Run configured quality gates.
- Persist state, reports, logs, and evidence.
- Prepare development handoff where configured.

## What It Does Not Do

`run-dev` does not:

- Merge to production.
- Deploy to production.
- Call Railway deploy/rollback/scale/variable/domain tools.
- Use Vercel smoke/deploy paths.
- Expose raw shell or raw MCP access.
- Bypass quality gates silently.

## OpenCode Boundary

OpenCode is an external dev runner. Ewokbot detects and invokes it through configured subprocess contracts; it does not own OpenCode auth or install OpenCode.

## Failure Handling

Failures should leave persisted evidence under `.ewokbot/runs/`. Use `inspect`, `logs`, `pause`, and `resume` to review local state.
