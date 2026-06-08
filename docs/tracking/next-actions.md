# Next Actions

## Immediate

1. Milestones AA, AB, AC, AD, AE, AF, AG, AH, and AI from `docs/plans/approved-backlog.md` are complete and accepted.
2. The next approved product direction remains the npm-installable CLI and VPS runtime path.
3. Milestone AJ: Interactive Init Wizard And Credential Setup is accepted after the prompt UX hardening commit.
4. Milestone AK: User-Level Ewokbot Layout is complete and accepted.
5. Milestone AL: Dev Tool Detection Adapters is complete and accepted, including the no-`runCommand` OpenCode model detection review fix.
6. Milestone AM: Inquirer TUI Init is complete and accepted.
7. Milestone AN: Ewokbot Auth Commands is complete and accepted.
8. Milestone AO: Meaningful Diff Guard is complete and accepted.
9. Milestone AP: Core Safety Loop v1 is complete and accepted.
10. Milestone AQ: Agent Completion Contract is complete and accepted.
11. Milestone AR: Test Relevance Guard is complete and accepted.
12. Milestone AS: Harness v1 is complete and accepted.
13. Milestone AT: Real Provider Smoke v1 is complete and accepted.
14. Milestone AU: MCP Inspect Schemas is complete and accepted.
15. Milestone AV: MCP Tool Registry is complete and accepted.
16. Milestone AW: MCP Policy Modes is complete and accepted.
17. GitHub MCP setup was unblocked after AW by switching the maintained GitHub preset to the official Docker server (`ghcr.io/github/github-mcp-server`) with `GITHUB_PERSONAL_ACCESS_TOKEN`, removing the global organization prompt, deriving owners from local git remotes, and proving `ewokbot mcp inspect github` can list the real GitHub tools under the default `read_only` policy.
18. Atlassian setup was partially realigned after AW by making Jira project keys an optional backlog constraint, not credentials: the init prompt now says `Constrain to Jira project keys, comma-separated (optional; leave blank for all projects)`, empty input writes `project_keys: []`, and Jira MCP backlog JQL becomes unconstrained across all visible projects.
19. The product direction is now Atlassian-first rather than Jira-only. Jira remains the first implemented work-item surface; Confluence documentation remains future policy-gated work and is not part of AX.
20. The previous GitHub PR handoff milestone is intentionally deferred until after MCP schema inspection, tool registry, policy modes, Atlassian mapping, Railway mapping, and GitHub mapping are accepted.
21. Milestone AX0 - Atlassian Naming And Init Realignment is complete as the prerequisite setup/naming pass.
22. Milestone AX - Atlassian MCP Real Mapping is implemented in this pass and awaiting acceptance. Jira `TicketPort` now maps to the documented Atlassian MCP tools from `docs/reference/atlassian-mcp-tools.md`: `search_jira_issues`, `read_jira_issue`, and `add_jira_comment` with the documented argument schemas.
23. Milestone AY - Railway MCP Real Mapping is implemented in this pass and awaiting acceptance. Railway `DeploymentPort` now maps to inspected read-only Railway MCP deployment evidence tools from `docs/reference/railway-mcp-tools.md`: `environment_status` and `list_deployments`. Optional inspected read tools such as `get_service_config`, `list_projects`, `list_services`, `get_logs`, and `service_metrics` remain parsed/classified for future typed use but are not globally required for current `DeploymentPort` readiness. Custom `railway.mcp_tools` overrides remain supported; service URLs must come from deployment evidence or explicit safe URL configuration. `list_variables` is secret-sensitive/redacted/denied, source/link mutation tools are denied by default, and `whoami` plus Railway HTTP observability tools remain unmapped and denied by default.
24. AZ - GitHub MCP Real Mapping is planned after AY acceptance only. Use `docs/reference/github-mcp-tools.md` as the authoritative inspected GitHub MCP tool reference. Do not implement AZ or later GitHub PR handoff, staging verification, operator-agent sandbox, worker daemon, Telegram, dashboard, Sentry/PostHog/Notion ingestion, or production automation work until AZ is explicitly approved.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone AF

Completed through Milestone AG. Workspace config supports `mock`, `real`, and selected `mcp` provider modes, adapter factories keep mock connectors as the default, real Jira/GitHub/Railway factories fail fast before live adapters are implemented, shared MCP client infrastructure exists without live provider calls, Jira, GitHub, and Railway MCP operations now have typed ports with audit capture and configurable tool names where applicable, native fallback contracts explicitly define when MCP, native, subprocess, mock, and human-only surfaces are allowed, and the public CLI can construct supported stdio MCP clients from `.ewokbot/workspace.yml` for scan, worker, and smoke.

Milestone AC added `ewokbot worker start`, `--once`, `--dry-run`, foreground continuous polling, workspace locking, graceful shutdown, operator-readable logs, and conservative restart state reuse that avoids duplicate side effects.

Milestone AD added local CLI control commands: `ewokbot runs`, `ewokbot inspect <run-id>`, `ewokbot pause`, `ewokbot resume <run-id>`, `ewokbot approve <run-id>`, `ewokbot reject <run-id>`, and `ewokbot logs <run-id>`. After AG, these commands operate on persisted state and sidecar control files under `.ewokbot/runs/`, and approval commands record local human decisions only without merging or deploying production.

Milestone AE added `ewokbot smoke <ticket-key> --confirm-real-provider-smoke [--run-id <run-id>]` for one explicitly confirmed real-provider smoke path. After AT, the command loads `.ewokbot/workspace.yml`, fails missing confirmation before any doctor/config/MCP/state/git/OpenCode/quality/provider/deployment side effects, runs AT-scoped local/Jira preflight before effects, requires only Jira `mcp` mode, validates `TicketPort.getTicket` readiness, reads exactly one Jira ticket, refuses an existing `.ewokbot/runs/<ticket-key>/<run-id>/` directory or `state.json` before repository side effects, requires exactly one selected repository, then proceeds only through local git branch creation, OpenCode/dev-runner execution, meaningful diff, agent completion, core safety, local quality gates, test relevance, and final report evidence. It does not require GitHub, Railway, or Vercel readiness, list the full backlog, transition or comment on Jira, push git branches, open GitHub pull requests, call Railway or Vercel, verify deployments, write an operation ledger, write a staging report, implement multi-repo autonomy, merge production, or deploy production.

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

AJ should configure OpenCode, optional oh-my-openagent intent/detection, model/provider env vars, Atlassian MCP for Jira work items, GitHub MCP intent, Railway MCP intent, Vercel placeholder/mock intent, and direct sibling repository discovery. It must write secrets only to `.ewokbot/.env`, keep `.ewokbot/.env.example` placeholder-only, never print secret values, and add runtime `.ewokbot/.env` loading before provider/OpenCode construction.

AJ must preserve non-interactive deterministic init for tests and automation. It must not auto-install tools, mutate non-Ewokbot config, start live MCP/OAuth flows, call providers, run OpenCode, run package managers, create branches, open PRs, deploy, merge production, or enable autonomous production automation.

AJ implementation status:

- `ewokbot init` now generates `.ewokbot/workspace.yml`, `.ewokbot/.env`, `.ewokbot/.env.example`, `.ewokbot/runs/`, `.ewokbot/logs/`, and `.ewokbot/cache/`.
- Interactive and injected wizard selections can configure OpenCode, optional oh-my-openagent, model/provider env vars, Atlassian MCP for Jira work items, GitHub MCP, Railway MCP, Vercel monitor intent, and direct sibling repository discovery.
- `.ewokbot/.env.example` remains placeholder-only, `.ewokbot/.env` is the only generated secrets file, and init/doctor output remains secret-safe.
- Runtime commands load `.ewokbot/.env` before provider, OpenCode, and public MCP construction.
- Tests remain fake-only and no later PR, staging, production, Telegram, dashboard, daemonization, or deployment scope was added.

Milestone AK - User-Level Ewokbot Layout is complete and accepted.

AK added Ewokbot's user-level config/data/auth/cache paths while keeping workspace-local delivery state under `.ewokbot/`. Target paths:

```text
~/.config/ewokbot/config.json
~/.local/share/ewokbot/auth.json
~/.local/share/ewokbot/state/
~/.cache/ewokbot/
```

AK uses XDG-aware path helpers, creates user-level directories only through explicit setup flows such as `ewokbot init`, creates `auth.json` with owner-only permissions where supported, preserves existing auth metadata, and keeps `.ewokbot/workspace.yml`, `.ewokbot/.env`, `.ewokbot/.env.example`, `.ewokbot/runs/`, `.ewokbot/logs/`, and `.ewokbot/cache/` workspace-local.

AK doctor/readiness output reports user config, auth, state, and cache presence without reading or printing auth file contents. Tests use injected home/XDG paths and avoid real home-directory mutation, live providers, MCP/OAuth flows, OpenCode execution, network calls, automatic secret migration, and OpenCode credential storage in Ewokbot auth.

Milestone AL - Dev Tool Detection Adapters is complete and accepted.

Milestone AM - Inquirer TUI Init is complete and accepted.

AM replaced the readline-style interactive init wizard with an injectable `@inquirer/prompts` TUI that uses guided selections, confirmations, inputs, and checkboxes while preserving deterministic `--non-interactive` init for tests and automation. The TUI surfaces AL OpenCode readiness before choosing the dev runner: ready OpenCode can be selected without asking for OpenAI, Anthropic, or OpenCode API keys; missing, failed, unsupported, not-authenticated, and no-model states offer explicit mock, instructions, custom command, or acknowledgement paths without installing OpenCode or launching auth automatically. Jira, GitHub, Railway, and Vercel provider choices remain guided, generated files remain limited to `.ewokbot/`, existing onboarding files are refused before prompts, and tests remain fake-only with injected prompt adapters.

Milestone AN - Ewokbot Auth Commands is complete and accepted.

AN added Ewokbot-owned auth commands for provider metadata while keeping OpenCode auth entirely external:

```bash
ewokbot auth status
ewokbot auth login <provider>
ewokbot auth logout <provider>
ewokbot auth list
```

Supported Ewokbot provider metadata entries are Jira, GitHub, Railway, and Vercel. The commands store metadata-only records in the AK user-level auth file at `~/.local/share/ewokbot/auth.json` or the configured XDG data equivalent. They do not write auth state into workspace `.ewokbot/`, do not perform live OAuth/provider/MCP/network calls, and do not print secret values. `ewokbot auth login opencode` and `ewokbot auth logout opencode` refuse with guidance that OpenCode auth is owned by OpenCode and should be managed through OpenCode directly.

Doctor output now distinguishes Ewokbot auth metadata from OpenCode readiness, and redaction covers additional auth-like field names such as access tokens, refresh tokens, client secrets, credentials, and authorization values.

Milestone AO - Meaningful Diff Guard is complete and accepted.

AO exists because the first real local OpenCode smoke proved a false positive: OpenCode exited successfully, local quality gates passed, but the target repository had no product diff and only `.omo/` appeared as an ignored agent artifact.

AO makes the controlled `run-dev` path refuse that result before it can reach `LOCAL_CHECKS_PASSED`.

Implemented:

- Capture a baseline changed-file/diff snapshot after local branch checkout and before OpenCode execution, then capture the after-agent snapshot after OpenCode exits.
- Decide meaningful diff from the agent-introduced delta after that baseline, not from all existing repository changes.
- Ignore `.omo/`, `.ewokbot/`, logs, caches, and run evidence when deciding whether the run produced meaningful product changes.
- If OpenCode exits `0` but no new meaningful product file changed after the baseline, stop as `FAILED` or `NEEDS_HUMAN` with a clear reason.
- Persist the meaningful-diff decision, baseline files, after-agent files, agent-delta files, product files, and ignored files under `.ewokbot/runs/<ticket-key>/<run-id>/`.
- Surface the reason in `final-report.md` and status/report output.
- Add tests for "OpenCode success but only ignored artifacts changed", "pre-existing product diff but no agent product diff", and "safe non-empty product diff can pass".

Milestone AP - Core Safety Loop v1 is complete and accepted.

AP evaluates whether a non-empty agent diff is allowed, requires human review, or must fail before any later handoff can be considered.

Implemented:

- Add forbidden-file detection for `.env`, `.env.*`, private keys, credential files, and Ewokbot auth/config files that must not be changed by an agent.
- Add secret-like content detection over changed diff additions without printing or persisting matched secret values.
- Add diff-size limits for changed files and diff lines, with configurable defaults and a test-overridable policy seam.
- Detect human-review categories such as dependency lockfile changes, database migrations, auth-related paths, payment-related paths, and infrastructure/deployment config changes.
- Return deterministic policy decisions: `pass`, `needs_human`, or `fail`.
- Write `.ewokbot/runs/<ticket-key>/<run-id>/core-safety.json` after AO meaningful diff passes.
- Block local quality and later handoff states when the safety policy returns `needs_human` or `fail`; `fail` marks `FAILED`, and `needs_human` marks `NEEDS_HUMAN` with `humanActionNeeded`.
- Surface the core safety report path and decision in `run-dev` CLI output, final reports, and status output.
- Add fake-only unit and run-dev integration tests for pass, forbidden file fail, redacted secret-like addition fail, diff-limit `NEEDS_HUMAN`, and human-review-category `NEEDS_HUMAN`.

Continue in this order:

1. AU - MCP Inspect Schemas. Completed and accepted.
2. AV - MCP Tool Registry. Completed and accepted.
3. AW - MCP Policy Modes. Completed and accepted.
4. GitHub MCP Docker preset unblocker. Completed after AW: maintained onboarding now uses the official Docker-based GitHub MCP server, asks only for `GITHUB_PERSONAL_ACCESS_TOKEN`, derives repo owners from local git remotes, and `ewokbot mcp inspect github` has been live-smoke verified to list the GitHub tools without calling them.
5. Atlassian setup realignment unblocker. Completed after AW: project keys are optional constraints, empty constraints mean all visible Jira projects, and docs now describe Jira under an Atlassian-first direction.
6. AX0 - Atlassian Naming And Init Realignment. Completed.
7. AX - Atlassian MCP Real Mapping. Implemented in this pass; awaiting acceptance.
8. AY - Railway MCP Real Mapping. Implemented in this pass; awaiting acceptance.
9. AZ - GitHub MCP Real Mapping. Planned after AY acceptance only. Use `docs/reference/github-mcp-tools.md`; do not guess tool names.
10. BA - GitHub PR Handoff v1. Planned after AZ acceptance only.
11. BB - Real Staging Verification v1. Planned after BA acceptance only.
12. BC - Operator Agent Action Sandbox. Planned after BB acceptance only.

Anything outside AX must wait until the later milestone is explicitly approved. Anything outside AU-BC must be proposed here first and must not be implemented until approved.

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
11. AK - User-Level Ewokbot Layout. Completed.
12. AL - Dev Tool Detection Adapters. Completed.
13. AM - Inquirer TUI Init. Completed.
14. AN - Ewokbot Auth Commands. Completed.
15. AO - Meaningful Diff Guard. Completed.
16. AP - Core Safety Loop v1. Completed.
17. AQ - Agent Completion Contract. Completed.
18. AR - Test Relevance Guard. Completed.
19. AS - Harness v1. Completed.
20. AT - Real Provider Smoke v1. Completed.
21. AU - MCP Inspect Schemas. Completed and accepted.
22. AV - MCP Tool Registry. Completed and accepted.
23. AW - MCP Policy Modes. Completed and accepted.
24. GitHub MCP Docker preset unblocker. Completed after AW.
25. Atlassian setup realignment unblocker. Completed after AW.
26. AX0 - Atlassian Naming And Init Realignment. Completed.
27. AX - Atlassian MCP Real Mapping. Implemented; awaiting acceptance.
28. AY - Railway MCP Real Mapping. Implemented; awaiting acceptance.
29. AZ - GitHub MCP Real Mapping. Planned after AY acceptance. Use `docs/reference/github-mcp-tools.md`; do not guess tool names.
30. BA - GitHub PR Handoff v1. Planned after AZ.
31. BB - Real Staging Verification v1. Planned after BA.
32. BC - Operator Agent Action Sandbox. Planned after BB.

Non-goals for the immediate next milestone:

- Telegram or WhatsApp control.
- Web dashboard.
- Daemonization through systemd, pm2, Docker, or hosted workers.
- Live provider calls during tests.
- Live MCP server startup or OAuth flows during tests.
- Automatic global installs without explicit user confirmation.
- Demanding OpenAI/Anthropic API keys during Ewokbot init when OpenCode owns the selected runner auth flow.
- Sentry, PostHog, Notion, support, SEO, or other signal ingestion.
- Autonomous production merge or production deployment.
