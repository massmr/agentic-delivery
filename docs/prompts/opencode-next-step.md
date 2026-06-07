# OpenCode Prompt: Next Autonomous Step

You are working in the Ewokbot repository.

## Task

Continue implementation from the next incomplete milestone in:

`docs/plans/approved-backlog.md`

The immediate next milestone is also summarized in:

`docs/tracking/next-actions.md`

At the time this prompt was prepared, Milestones AH, AI, AJ, AK, AL, AM, AN, AO, AP, AQ, AR, and AS are complete and accepted. Milestone AT: Real Provider Smoke v1 is the next approved implementation milestone. Do not implement AU or later work until AT is complete and accepted and `docs/tracking/next-actions.md` explicitly approves the later milestone.

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

- Do not add Telegram, WhatsApp, dashboard, daemonization, production merge, or production deployment automation.
- Do not add live provider OAuth, live MCP auth, OpenCode auth execution, package-manager setup, provider network calls, or real home-directory mutation to tests.
- Do not read, print, parse, copy, or store raw OpenCode secret values.
- Keep OpenCode credentials owned by OpenCode; do not copy them into `.ewokbot/.env` or Ewokbot auth.
- Keep Ewokbot auth output redacted and metadata-only.
- Production merge and production deployment remain human-only.

AO added the accepted Meaningful Diff Guard for the controlled `run-dev` path:

- Capture a baseline changed-file/diff snapshot after local branch checkout and before OpenCode execution.
- Capture the after-agent snapshot after OpenCode exits.
- Decide meaningful diff from the agent-introduced delta after that baseline, not from all existing repository changes.
- Ignore agent/runtime artifacts such as `.omo/`, `.ewokbot/`, logs, caches, and run evidence when deciding whether a product diff exists.
- Stop before quality gates when OpenCode exits `0` but no new meaningful product file changed.

AP added the accepted Core Safety Loop v1 for non-empty agent diffs:

- Add forbidden-file detection for `.env`, `.env.*`, private keys, credential files, and Ewokbot auth/config files that must not be changed by an agent.
- Add secret-like content detection over changed diff additions without printing matched secret values.
- Add diff-size limits for changed files and diff lines, with configurable defaults.
- Detect human-review categories such as dependency lockfile changes, database migrations, auth-related paths, payment-related paths, and infrastructure/deployment config changes.
- Return deterministic policy decisions: `pass`, `needs_human`, or `fail`.
- Write `.ewokbot/runs/<ticket-key>/<run-id>/core-safety.json` after AO meaningful diff passes.
- Block later local success or handoff states when the safety policy returns `needs_human` or `fail`.

AQ added the accepted Agent Completion Contract for `run-dev`:

- Tighten the OpenCode implementation prompt so agents must end with a structured completion summary: status, changed files, tests run, known limits, blockers, and background agents.
- Parse the final completion summary from implementation logs and pair it with meaningful-diff evidence.
- Persist `.ewokbot/runs/<ticket-key>/<run-id>/agent-completion.json`.
- Reject exploration-only summaries, incomplete/TODO output, pending background-agent endings, no implementation/no changed files, and missing completion signals before core safety or local quality can run.
- Escalate explicit credential, access, approval, or clarification blockers as `NEEDS_HUMAN`.
- Surface the agent completion decision in `run-dev` CLI output, final reports, status, inspect, and logs.

AR Test Relevance Guard for `run-dev` is complete and accepted.

AR planning scope:

- Verify that tests reported by the agent are relevant to the changed product files.
- Return deterministic test relevance decisions: `pass`, `warn`, or `needs_human`.
- Persist `.ewokbot/runs/<ticket-key>/<run-id>/test-relevance.json`.
- Integrate after local quality evidence exists, so the guard can inspect reported tests and actual quality commands/results.
- Surface the test relevance decision in `run-dev` CLI output, final reports, status, inspect, and logs.
- Keep tests fake-only with fake agent outputs, fake diffs, and deterministic quality evidence.

AS Harness v1 is complete and accepted.

AT is the active next implementation milestone: Real Provider Smoke v1. Use `docs/tracking/next-actions.md` and `docs/plans/approved-backlog.md` for the exact approved scope before editing.

AT planning scope:

- Use Jira MCP to read one explicitly selected sandbox ticket.
- Reuse planning, `run-dev`, meaningful-diff, safety, completion, test relevance, and local quality evidence.
- Do not open GitHub PRs or call deployment providers in this milestone.
- Produce an operator report that explains exactly what was read and what local actions happened.
- Prove that one real Jira ticket can drive `scan`, `plan`, and `run-dev` locally.
- Ensure missing Jira MCP readiness fails before repository or agent side effects.
- Keep GitHub, Railway, Vercel, production, and remote mutation out of scope.

AT safety constraints:

- Do not implement AU GitHub PR Handoff v1 or AV Operator Agent Action Sandbox until AT is complete and accepted and a later milestone is explicitly approved.
- Do not implement GitHub PR handoff, staging verification, production merge, production deployment, dashboard, Telegram, WhatsApp, Sentry, PostHog, Notion, support, SEO, or external signal ingestion.
- Do not transition Jira tickets.
- Do not add live provider calls, live MCP calls, live OpenCode execution in tests, package-manager setup, provider network calls, or real home-directory mutation to tests.
- Do not delete or revert user changes outside controlled temporary test repositories.
- Do not print secret values, even when a secret scan fails.
- Production merge and production deployment remain human-only.

After AT is complete and accepted, the planned sequence is AU GitHub PR Handoff v1, then AV Operator Agent Action Sandbox. Do not start any later milestone until `docs/tracking/next-actions.md` explicitly approves it.

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
