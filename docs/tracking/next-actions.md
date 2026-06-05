# Next Actions

## Immediate

1. Milestones AA, AB, AC, AD, AE, AF, AG, AH, and AI from `docs/plans/approved-backlog.md` are complete and accepted.
2. The next approved product direction remains the npm-installable CLI and VPS runtime path.
3. Milestone AJ: Interactive Init Wizard And Credential Setup is accepted after the prompt UX hardening commit.
4. The next approved implementation milestone is Milestone AK: User-Level Ewokbot Layout.
5. Milestones AL, AM, and AN are approved in order as future work, but must not be implemented before AK is completed and reviewed.
6. Do not implement later PR handoff, staging verification, worker daemon, Telegram, dashboard, or production automation work until those milestones are explicitly approved.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone AF

Completed through Milestone AG. Workspace config supports `mock`, `real`, and selected `mcp` provider modes, adapter factories keep mock connectors as the default, real Jira/GitHub/Railway factories fail fast before live adapters are implemented, shared MCP client infrastructure exists without live provider calls, Jira, GitHub, and Railway MCP operations now have typed ports with audit capture and configurable tool names where applicable, native fallback contracts explicitly define when MCP, native, subprocess, mock, and human-only surfaces are allowed, and the public CLI can construct supported stdio MCP clients from `.ewokbot/workspace.yml` for scan, worker, and smoke.

Milestone AC added `ewokbot worker start`, `--once`, `--dry-run`, foreground continuous polling, workspace locking, graceful shutdown, operator-readable logs, and conservative restart state reuse that avoids duplicate side effects.

Milestone AD added local CLI control commands: `ewokbot runs`, `ewokbot inspect <run-id>`, `ewokbot pause`, `ewokbot resume <run-id>`, `ewokbot approve <run-id>`, `ewokbot reject <run-id>`, and `ewokbot logs <run-id>`. After AG, these commands operate on persisted state and sidecar control files under `.ewokbot/runs/`, and approval commands record local human decisions only without merging or deploying production.

Milestone AE added `ewokbot smoke <ticket-key> --confirm-real-provider-smoke [--run-id <run-id>]` for one explicitly confirmed real-provider smoke path. After AG, the command loads `.ewokbot/workspace.yml`, fails missing confirmation before any doctor/config/MCP/state/git/OpenCode/PR/deployment/ledger/provider side effects, runs local doctor before effects, requires Jira/GitHub/Railway `mcp` provider modes, validates runtime MCP readiness, reads exactly one Jira ticket through `TicketPort.getTicket`, refuses an existing `.ewokbot/runs/<ticket-key>/<run-id>/` directory or `state.json` before delivery side effects, requires exactly one selected repository, then proceeds through local git, OpenCode, local quality gates, develop PR handoff with the existing operation ledger, staging verification, and production PR preparation only. It does not list the full backlog, implement multi-repo autonomy, merge production, or deploy production.

Milestone AF added public CLI stdio MCP client construction, and AG moved the default config source to `.ewokbot/workspace.yml` for scan, worker, and smoke. Supported MCP server entries use `mcp_servers.<id>.command` plus optional `args`; HTTP MCP server entries currently fail fast as unsupported by the public runtime. Missing, unsupported, unavailable, unauthenticated, missing-tool, or disallowed MCP setup fails before Jira reads, worker locks, run-state writes, git, OpenCode, PRs, Railway checks, operation-ledger writes, or provider mutations where applicable. Tests remain fake-only and do not start live MCP servers or OAuth flows.

Architecture direction changed after review and Milestone N is complete: external SaaS integrations are MCP-first, with native/subprocess/mock adapters kept as fallbacks behind typed business ports. Do not implement Jira REST as the next milestone.

Milestone AG Workspace Layout Migration To `.ewokbot/` is complete.

AG changed the product layout so Ewokbot is launched from the parent directory that already contains the target repositories. Fresh init now generates repository discovery mode (`repos.discovery: sibling-git-directories`) so all direct child directories containing `.git/` are watched by default, with `.ewokbot/`, hidden directories, `node_modules/`, non-Git directories, nested repos, and configured excludes ignored. Ewokbot-owned files move under `.ewokbot/`: `.ewokbot/workspace.yml`, `.ewokbot/.env`, `.ewokbot/.env.example`, `.ewokbot/runs/`, `.ewokbot/logs/`, and `.ewokbot/cache/`.

AG removed legacy fallback defaults. Root `config/workspace.yml`, root `.env`, root `.env.example`, and root `runs/` are not supported defaults; commands fail clearly if `.ewokbot/workspace.yml` is missing unless an explicit config path is supplied.

Milestone AH - Real Workspace Dry Run is complete and accepted.

AH proves the real operator flow from a parent multi-repository workspace without starting code generation or delivery side effects:

```bash
cd <workspace-root>
ewokbot init
ewokbot doctor
ewokbot scan
ewokbot plan <ticket-key>
```

AH connects `.ewokbot/` setup, direct sibling Git repository discovery, Jira MCP intake, and ticket-to-repository planning. Doctor reports discovered sibling Git repository count and names, scan can read Jira backlog through the configured Jira MCP, and plan reads one ticket through `TicketPort.getTicket`, selects from discovered or explicit repositories, and persists only local planning evidence under `.ewokbot/runs/`. It does not create git branches, run OpenCode, run package scripts, write operation ledgers, call GitHub, call Railway/Vercel, open PRs, verify deployments, merge production, or deploy production.

Milestone AI - Controlled Single-Repository Dev Execution is complete and accepted.

AI adds an explicitly confirmed development-only command:

```bash
cd <workspace-root>
ewokbot run-dev <ticket-key> --confirm-dev-execution
```

AI reuses the AH dry-run path for Jira MCP ticket intake and repository planning, refuses execution unless exactly one repository is selected, prints the selected ticket/repository/branch/quality boundary before side effects, creates a local branch only in that repository, invokes the existing OpenCode execution contract, runs local quality gates, and writes local implementation/quality evidence under `.ewokbot/runs/`.

AI must stop after local development evidence. It must not open GitHub PRs, call Railway or Vercel, verify deployments, merge production, deploy production, or enable autonomous production automation.

Milestone AJ - Interactive Init Wizard And Credential Setup is complete and accepted.

AJ must make `ewokbot init` a real first-run wizard. At the end of the wizard, the operator should have `.ewokbot/workspace.yml`, `.ewokbot/.env`, `.ewokbot/.env.example`, `.ewokbot/runs/`, `.ewokbot/logs/`, and `.ewokbot/cache/` ready for:

```bash
ewokbot doctor
ewokbot scan
ewokbot plan <ticket-key>
ewokbot run-dev <ticket-key> --confirm-dev-execution
```

AJ should configure OpenCode, optional oh-my-openagent intent/detection, model/provider env vars, Jira MCP, GitHub MCP intent, Railway MCP intent, Vercel placeholder/mock intent, and direct sibling repository discovery. It must write secrets only to `.ewokbot/.env`, keep `.ewokbot/.env.example` placeholder-only, never print secret values, and add runtime `.ewokbot/.env` loading before provider/OpenCode construction.

AJ must preserve non-interactive deterministic init for tests and automation. It must not auto-install tools, mutate non-Ewokbot config, start live MCP/OAuth flows, call providers, run OpenCode, run package managers, create branches, open PRs, deploy, merge production, or enable autonomous production automation.

AJ implementation status:

- `ewokbot init` now generates `.ewokbot/workspace.yml`, `.ewokbot/.env`, `.ewokbot/.env.example`, `.ewokbot/runs/`, `.ewokbot/logs/`, and `.ewokbot/cache/`.
- Interactive and injected wizard selections can configure OpenCode, optional oh-my-openagent, model/provider env vars, Jira MCP, GitHub MCP, Railway MCP, Vercel monitor intent, and direct sibling repository discovery.
- `.ewokbot/.env.example` remains placeholder-only, `.ewokbot/.env` is the only generated secrets file, and init/doctor output remains secret-safe.
- Runtime commands load `.ewokbot/.env` before provider, OpenCode, and public MCP construction.
- Tests remain fake-only and no later PR, staging, production, Telegram, dashboard, daemonization, or deployment scope was added.

Recommended next action: implement Milestone AK only.

Milestone AK - User-Level Ewokbot Layout is the next approved implementation milestone.

AK must add Ewokbot's user-level config/data/auth/cache paths while keeping workspace-local delivery state under `.ewokbot/`. Target paths:

```text
~/.config/ewokbot/config.json
~/.local/share/ewokbot/auth.json
~/.local/share/ewokbot/state/
~/.cache/ewokbot/
```

AK must use XDG overrides in tests, avoid real home-directory mutation in tests, create strict auth-file permissions where supported, and update doctor/docs to distinguish global user state from workspace-local state.

After AK is completed and reviewed, continue in this order:

1. AL - Dev Tool Detection Adapters, starting with OpenCode `detect()`, `doctor()`, `launchSetup()`, and `getConfigSummary()`.
2. AM - Inquirer TUI Init using `@inquirer/prompts`, backed by AK and AL.
3. AN - Ewokbot Auth Commands, separate from OpenCode auth.

Any other task must be proposed here first and must not be implemented until approved.

## Post-Z Product Direction

Ewokbot should become an installable CLI-first product that can run on a VPS without depending on the operator's personal laptop.

Target first-run experience:

```bash
npm install -g ewokbot
ewokbot init
ewokbot doctor
ewokbot worker start --once
ewokbot status
```

CLI control is the primary control plane for now. The experience should feel closer to Claude Code or OpenCode than to a web dashboard. Telegram, WhatsApp, and other chat controls are future interfaces over the same command/control model, not the immediate product surface.

Deployment/CI monitoring must support both Railway and Vercel as first-class provider choices. Railway remains required for the founder's first real deployment path; Vercel is also part of the public product direction.

The next milestones should move in this order:

1. AA - Interactive CLI Onboarding For VPS Setup. Completed.
2. AB - Doctor And Local Readiness Checks. Completed.
3. AC - Long-Running Worker Runtime. Completed.
4. AD - CLI Control Plane. Completed.
5. AE - First Real Provider Smoke Run. Completed.
6. AF - Real MCP Client Runtime Wiring. Completed.
7. AG - Workspace Layout Migration To `.ewokbot/`. Completed.
8. AH - Real Workspace Dry Run. Completed.
9. AI - Controlled Single-Repository Dev Execution. Completed.
10. AJ - Interactive Init Wizard And Credential Setup. Completed.
11. AK - User-Level Ewokbot Layout. Next approved.
12. AL - Dev Tool Detection Adapters. Approved after AK.
13. AM - Inquirer TUI Init. Approved after AL.
14. AN - Ewokbot Auth Commands. Approved after AM.

Non-goals for the immediate next milestone:

- Telegram or WhatsApp control.
- Web dashboard.
- Daemonization through systemd, pm2, Docker, or hosted workers.
- Live provider calls during tests.
- Live MCP server startup or OAuth flows during tests.
- Automatic global installs without explicit user confirmation.
- Demanding OpenAI/Anthropic API keys during Ewokbot init when OpenCode owns the selected runner auth flow.
- Autonomous production merge or production deployment.
