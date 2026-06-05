# OpenCode Prompt: Next Autonomous Step

You are working in the Ewokbot repository.

## Task

Continue implementation from the next incomplete milestone in:

`docs/plans/approved-backlog.md`

The immediate next milestone is also summarized in:

`docs/tracking/next-actions.md`

## Required Reading

Read these files before editing:

- `AGENTS.md`
- `README.md`
- `docs/specs/product-spec.md`
- `docs/specs/technical-architecture.md`
- `docs/plans/mvp-plan.md`
- `docs/plans/approved-backlog.md`
- `docs/tracking/next-actions.md`
- `docs/specs/quality-gates.md`

## Execution Rules

- Implement one coherent milestone at a time.
- Use `docs/tracking/next-actions.md` to identify the approved next milestone.
- Do not implement unapproved future controls such as Telegram, WhatsApp, dashboard, daemonization, production merge, or production deployment.
- Add or update tests with each milestone.
- Keep mock mode working without credentials.
- Update docs when commands or behavior change.
- Run typecheck, tests, and build before stopping.
- If a command fails because dependencies are missing, install them and retry.
- If external credentials are required, stop and document exactly which variables are needed.

## Final Report

At the end, report:

- milestone completed
- files changed
- commands run
- test results
- next recommended milestone
- blockers, if any
