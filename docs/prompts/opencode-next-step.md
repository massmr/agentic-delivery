# OpenCode Prompt: Next Autonomous Step

You are working in the Ewokbot repository.

## Task

Continue implementation from the next incomplete milestone in:

`docs/plans/approved-backlog.md`

The immediate next milestone is also summarized in:

`docs/tracking/next-actions.md`

At the time this prompt was prepared, Milestones AH, AI, and AJ are complete and accepted. The approved next milestone is AK: User-Level Ewokbot Layout.

AI added `ewokbot run-dev <ticket-key> --confirm-dev-execution` as a development-only command. It reuses the AH Jira MCP ticket intake and repository planning path, requires exactly one selected repository, requires the explicit confirmation flag before side effects, creates a local branch only in that repository, invokes the existing OpenCode execution contract, runs local quality gates, and persists implementation/quality evidence under `.ewokbot/runs/`.

AJ made `ewokbot init` generate `.ewokbot/workspace.yml`, `.ewokbot/.env`, `.ewokbot/.env.example`, `.ewokbot/runs/`, `.ewokbot/logs/`, and `.ewokbot/cache/` for `ewokbot doctor`, `ewokbot scan`, `ewokbot plan <ticket-key>`, and `ewokbot run-dev <ticket-key> --confirm-dev-execution`.

AK must add Ewokbot's user-level config/data/auth/cache paths while keeping workspace-local delivery state under `.ewokbot/`. Target user paths are:

```text
~/.config/ewokbot/config.json
~/.local/share/ewokbot/auth.json
~/.local/share/ewokbot/state/
~/.cache/ewokbot/
```

AK must use XDG overrides in tests, avoid real home-directory mutation in tests, create strict auth-file permissions where supported, update doctor/docs to distinguish global user state from workspace-local state, and preserve existing `.ewokbot/` workspace behavior.

Do not start AL, AM, AN, or any later milestone until AK is implemented, reviewed, and accepted or `docs/tracking/next-actions.md` explicitly approves the next implementation step.

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
