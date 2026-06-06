# OpenCode Prompt: Next Autonomous Step

You are working in the Ewokbot repository.

## Task

Continue implementation from the next incomplete milestone in:

`docs/plans/approved-backlog.md`

The immediate next milestone is also summarized in:

`docs/tracking/next-actions.md`

At the time this prompt was prepared, Milestones AH, AI, AJ, AK, AL, and AM are complete and accepted. Milestone AN: Ewokbot Auth Commands is implemented as a review candidate and must be reviewed and accepted before any later milestone begins.

AI added `ewokbot run-dev <ticket-key> --confirm-dev-execution` as a development-only command. It reuses the AH Jira MCP ticket intake and repository planning path, requires exactly one selected repository, requires the explicit confirmation flag before side effects, creates a local branch only in that repository, invokes the existing OpenCode execution contract, runs local quality gates, and persists implementation/quality evidence under `.ewokbot/runs/`.

AJ made `ewokbot init` generate `.ewokbot/workspace.yml`, `.ewokbot/.env`, `.ewokbot/.env.example`, `.ewokbot/runs/`, `.ewokbot/logs/`, and `.ewokbot/cache/` for `ewokbot doctor`, `ewokbot scan`, `ewokbot plan <ticket-key>`, and `ewokbot run-dev <ticket-key> --confirm-dev-execution`.

AK added Ewokbot's user-level config/data/auth/cache paths while keeping workspace-local delivery state under `.ewokbot/`. User-level paths are:

```text
~/.config/ewokbot/config.json
~/.local/share/ewokbot/auth.json
~/.local/share/ewokbot/state/
~/.cache/ewokbot/
```

AK uses XDG-aware path helpers, avoids real home-directory mutation in tests, creates strict auth-file permissions where supported, reports user-level path readiness in doctor without exposing auth contents, and preserves existing `.ewokbot/` workspace behavior.

AL replaced naive dev-runner setup assumptions with explicit detection and readiness adapters, starting with OpenCode. The `DevToolSetupAdapter` contract includes:

- `detect()`
- `doctor()`
- `launchSetup()`
- `getConfigSummary()`

AL implemented `OpenCodeSetupAdapter` for OpenCode command/version detection, global OpenCode config detection at `~/.config/opencode/opencode.json`, OpenCode auth readiness detection at `~/.local/share/opencode/auth.json` and/or through injected read-only `opencode auth list` probes, project config detection at `<workspace-root>/opencode.json`, normalized readiness states, custom command paths, and fake process/filesystem tests for every readiness branch.

AL safety constraints that must be preserved during review and follow-up work:

- Do not add live OpenCode execution to tests.
- Do not run install scripts, package managers, `opencode auth login`, auth flows, or setup actions without explicit operator confirmation.
- Do not read, print, parse, copy, or store raw OpenCode secret values.
- Keep OpenCode credentials owned by OpenCode; do not copy them into `.ewokbot/.env` or Ewokbot auth.
- Keep tests fake-only with no real OpenCode, package-manager, OAuth, network, MCP, provider, or home-directory mutation side effects.
- Production merge and production deployment remain human-only.

AM replaced the readline-style interactive init wizard with an injectable `@inquirer/prompts` TUI while preserving deterministic `--non-interactive` init. It surfaces AL OpenCode readiness in the init flow, lets ready OpenCode be selected without asking for OpenAI, Anthropic, or OpenCode API keys, and keeps missing or not-ready OpenCode on explicit safe paths such as mock mode, setup instructions, custom command checks, or acknowledged continuation.

AM safety constraints that must be preserved during review and follow-up work:

- Do not add Telegram, WhatsApp, dashboard, daemonization, production merge, or production deployment automation.
- Do not run OpenCode install scripts, package managers, `opencode auth login`, auth flows, or setup actions automatically.
- Do not read, print, parse, copy, or store raw OpenCode secret values.
- Keep OpenCode credentials owned by OpenCode; do not copy them into `.ewokbot/.env` or Ewokbot auth.
- Keep tests fake-only with no real OpenCode, package-manager, OAuth, network, MCP, provider, or home-directory mutation side effects.
- Production merge and production deployment remain human-only.

AN added Ewokbot-owned auth commands that remain separate from OpenCode auth:

```bash
ewokbot auth status
ewokbot auth login <provider>
ewokbot auth logout <provider>
ewokbot auth list
```

AN stores metadata-only Jira, GitHub, Railway, and Vercel provider auth records under the AK user-level auth file (`~/.local/share/ewokbot/auth.json` or XDG equivalent). It does not store auth state in workspace `.ewokbot/`, print raw credential values, perform live OAuth/provider/MCP/network calls, mutate OpenCode config, or treat Ewokbot auth as a substitute for OpenCode auth. `auth login opencode` and `auth logout opencode` refuse with guidance to use OpenCode directly.

AN safety constraints that must be preserved during review and follow-up work:

- Do not implement any post-AN milestone until AN is reviewed and accepted and a next milestone is explicitly approved in `docs/tracking/next-actions.md`.
- Do not add Telegram, WhatsApp, dashboard, daemonization, production merge, or production deployment automation.
- Do not add live provider OAuth, live MCP auth, OpenCode auth execution, package-manager setup, provider network calls, or real home-directory mutation to tests.
- Do not read, print, parse, copy, or store raw OpenCode secret values.
- Keep OpenCode credentials owned by OpenCode; do not copy them into `.ewokbot/.env` or Ewokbot auth.
- Keep Ewokbot auth output redacted and metadata-only.
- Production merge and production deployment remain human-only.

Do not start any later milestone until AN is reviewed and accepted and `docs/tracking/next-actions.md` explicitly approves the next implementation step.

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
