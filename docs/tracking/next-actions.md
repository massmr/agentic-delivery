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
24. Milestone AZ - GitHub MCP Real Mapping is implemented in this pass and awaiting acceptance. GitHub `CodeHostPort` now maps to inspected tools from `docs/reference/github-mcp-tools.md`: `list_branches`, `create_branch`, `list_pull_requests`, `create_pull_request`, `pull_request_read`, and `add_issue_comment`. `create_pull_request` is destructive-classified and policy-gated, `merge_pull_request` remains human-only, destructive branch/file/repo/workflow/secret operations are denied by default, branch push remains a local/native git fallback, mock mode remains the default, and tests remain fake-only with no live GitHub/MCP/Docker/OAuth/network calls.
25. Milestone BA - GitHub PR Handoff v1 is complete and accepted. Develop-target draft PR handoff now requires passed local quality, meaningful diff, agent completion, core safety, and test relevance evidence before branch push or PR side effects; the production BA orchestration path constructs the GitHub `CodeHostPort` through scoped runtime readiness after local BA evidence passes and before any handoff side effects; missing or denied `create_pull_request` policy blocks before local branch handoff, code-host branch creation, git push, PR creation, PR comment, or operation-ledger mutation. Scoped readiness requires only the BA handoff action `openPullRequest`/`create_pull_request`, mock GitHub mode remains working without MCP readiness, and operation-ledger idempotency is preserved for branch readiness/creation, local git push, and develop PR creation. Production PRs, merges, deployments, BB staging verification, BE operator sandboxing, live GitHub/MCP/Docker/OAuth/network calls, and test remotes remain out of scope.
26. Milestone BB - Real Staging Verification v1 is implemented but not accepted. A real smoke run against Atlassian MCP, OpenCode, GitHub MCP, and Railway MCP proved the path reaches GitHub PR handoff, but it pushes a branch with no commit after OpenCode changes. GitHub then rejects PR creation with `No commits between develop and agent/<ticket>...`.
27. Corrective milestone BB1 - Commit Scoped Agent Diff Before Develop PR Handoff is complete and accepted. The develop handoff now stages only meaningful-diff product files, creates a deterministic local commit after all local evidence gates pass, persists/surfaces the commit SHA, pushes the committed branch, and then creates or reuses the develop draft PR. GitHub handoff failures in real-provider smoke output are now labeled as GitHub develop PR handoff failures instead of Jira read failures.
28. Real smoke follow-up against `SCRUM-6` proved the path now reaches GitHub PR handoff successfully: OpenCode produced a scoped product diff, local quality passed, a local commit was created, the branch was pushed, GitHub MCP created PR #3, GitHub MCP added a PR comment, and PR number parsing worked. The run stopped at `PR_TO_DEVELOP_OPENED` because GitHub checks returned `totalCount: 0`, leaving Ewokbot unable to decide whether to wait, require human review, treat absent CI as acceptable, or auto-merge develop.
29. Milestone BC - Develop PR Follow-Up Policy is implemented in this pass and awaiting acceptance. Develop PR handoff now reads PR state and checks through the typed `CodeHostPort`, applies branch-scoped `delivery` policy for `no_remote_checks`, supports develop-only explicit `auto_merge`, records follow-up evidence in state/status/final reports and the operation ledger, stops closed-unmerged PRs before Railway, continues after human-merged PRs, and runs Railway staging only after develop is accepted, merged, or ready by policy. The review fix removed the generic `require_human` merge bypass: raw `merge_pull_request` remains human-only, and typed develop auto-merge now requires explicit develop `auto_merge`, `require_human_approval: false`, and explicit MCP policy allow. Main/production PRs remain human-only.
30. Real smoke follow-up against `SCRUM-7` proved develop auto-merge works end to end through GitHub MCP: OpenCode produced a scoped product diff, local quality passed, a scoped commit was created, a develop PR was opened, and Ewokbot auto-merged it to `develop` under the configured branch policy. The run stopped at Railway staging verification because Railway MCP had no explicit `project_id`/`environment_id`/`service_id` mapping and the local Railway CLI had no linked project/session.
31. Milestone BD - Railway Deployment Mapping Per Repository is implemented in this pass and awaiting acceptance. Workspace repos can now declare explicit staging deployment mappings with Railway project/environment/service ids and verification modes `railway_mcp`, `http_smoke`, `github_only`, or `none`. Staging verification passes the selected repo mapping ids into Railway MCP read-only calls instead of relying on `railway link`, and reports/status output surfaces the mapping used. A missing mapping must fail clearly unless the selected repository has an explicit `none` or `github_only` skip mode.
32. Milestone BE - Railway MCP Discovery And Repository Mapping is implemented in this pass and awaiting acceptance. `ewokbot init` now has a setup-only Railway discovery boundary that reads projects/services through approved read-only MCP tools, maps discovered sibling Git repositories to discovered Railway services or manual IDs, preserves `repos.discovery: sibling-git-directories`, writes per-repo staging overrides, and supports explicit `none`/`github_only` skip choices without changing runtime staging verification.
33. Next milestone after BE acceptance: BF - Invocation Control UI v0. This creates a local Next.js UI bound to one Ewokbot workspace invocation so operators can inspect config, repos, providers, runs, reports, and safe read-only actions without relying on a giant CLI wizard.
34. Milestone BF - Invocation Control UI v0 is complete and accepted. The local Next.js UI is bound to one Ewokbot workspace invocation and exposes safe workspace readiness, provider, repository, run, and report views without provider secrets or delivery side effects.
35. Milestone BG - Railway Mapping UI is complete and accepted. The invocation UI now lets operators map each controlled repository to `railway_mcp`, `github_only`, or `none`, manually enter Railway project/environment/service ids, persist scoped staging mappings under `repos.deployments.<repo>.staging`, and view local validation feedback after save while preserving sibling repository discovery and unrelated config.
36. Next milestone after BG acceptance: BH - Invocation Control UI Shell Refactor. This turns the current local UI into a real operator console with a fixed `100vh`/`100vw` app shell, dense information layout, internal panel scrolling only, and configuration-first ergonomics.
37. Follow-up milestone after BH: BI - Operator Agent Action Sandbox. This creates the future "Ewokbot agent" control layer that can talk with the operator and invoke only approved Ewokbot commands/ports, without raw shell or raw MCP tool access.
38. Cubic review provider is deferred until after the invocation UI shell refactor and operator-agent foundations. It is now planned as BJ.
39. Before BI, the next approved documentation direction is now BK/BL/BM: preserve the existing `docs/` tree as the canonical source of truth, consolidate current behavior into a complete user/developer documentation set, and only then build the public docs site plus landing from that source material.
40. Documentation work must not discard current planning/spec/reference material. Existing docs remain authoritative inputs and must be reorganized, indexed, summarized, or linked rather than replaced with thinner marketing copy.

## Immediate Documentation Direction

The next approved sequence is:

1. `BM - Documentation Site And Landing Page`
2. `BI - Operator Agent Action Sandbox`
3. `BJ - Cubic Review Provider`

`BK - Canonical Documentation Architecture` is complete. The docs source map now lives in `docs/README.md`, with the authority model and provider/status rules in `docs/architecture/documentation-architecture.md`.

`BL - Full Product Documentation Rewrite` is complete in the canonical docs tree. The consolidated entrypoint is `docs/index.md`; root `README.md` is now a concise front door into Getting Started, Concepts, Guides, Reference, Architecture, and Product State docs.

Documentation-specific rules:

- `docs/` remains the source of truth.
- The public site must be generated from or tightly aligned to `docs/`, not written as an unrelated parallel narrative.
- `README.md` should become a concise entrypoint into the deeper documentation, not the only source of product explanation.
- The docs set must clearly separate:
  - what Ewokbot can do today,
  - what remains supervised,
  - what is experimental,
  - and what is still roadmap-only.

## Immediate Real-Smoke Finding

Real run evidence from `/private/tmp/ewokbot-init-playground-ERdv06`:

- `ewokbot smoke SCRUM-5 --confirm-real-provider-smoke --run-id codex-real-smoke-6`
- Atlassian MCP ticket intake reached the ticket.
- OpenCode produced local product changes in `src/app.js` and `test/app.test.js`.
- Meaningful diff, agent completion, core safety, test relevance, and local quality gates passed.
- GitHub MCP `create_branch` succeeded after the fine-grained PAT received repository write permissions.
- Local git push and GitHub PR creation ordering is still wrong: the branch was pushed at the base `develop` SHA while OpenCode changes stayed uncommitted in the working tree.
- GitHub MCP `create_pull_request` failed with `422 Validation Failed: No commits between develop and agent/SCRUM-5-improve-frontend-onboarding-empty-state`.

Required next implementation:

```text
OpenCode changes
-> meaningful diff
-> agent completion
-> core safety
-> quality gates
-> test relevance
-> stage only allowed agent diff files
-> create a local commit
-> push the committed branch
-> create or reuse the develop draft PR
```

BB1 implementation status:

- Scoped commit ordering now follows the required sequence: OpenCode changes, meaningful diff, agent completion, core safety, quality gates, test relevance, scoped staging, local commit, committed branch push, and develop draft PR handoff.
- Commit metadata is recorded in run state and surfaced in smoke output, develop PR body/comment, run status, and final reports.
- The misleading smoke error message is fixed for GitHub develop PR handoff failures.
- Verification remains fake-only; no live provider, MCP, OpenCode, Docker, OAuth, or network tests were added.

## Develop PR Follow-Up Policy

Milestone BC now makes Ewokbot supervise the develop PR after creation:

- Add branch-scoped delivery config under a `delivery` policy section.
- Allow `develop` auto-merge only when explicitly configured.
- Keep `main` and production PRs human-only.
- Add `no_remote_checks` behavior for repos with no GitHub Actions or external CI checks.
- Supported `no_remote_checks` outcomes should include at least `pass`, `wait`, `needs_human`, and `fail`.
- Poll GitHub MCP for PR state, merge state, and checks/status.
- If the PR is closed without merge, stop the run and stop monitoring.
- If a human merges the PR, continue to Railway staging verification.
- If checks pass and develop auto-merge is enabled, merge through a typed develop-only GitHub action that also requires explicit MCP policy allow; raw `merge_pull_request` remains human-only outside that typed path.
- If checks pass and develop auto-merge is disabled, keep waiting for a human merge.
- If there are no remote checks and policy says `pass`, local Ewokbot quality gates are sufficient only when `require_checks: pass_or_absent` is configured; if develop auto-merge is enabled, Ewokbot merges develop before staging-ready, and if auto-merge is disabled it waits for a human merge instead of staging an open PR.
- `PR_TO_DEVELOP_OPENED` remains resumable through a follow-up-only path that rereads PR state/checks and optionally merges develop without recreating branches, commits, pushes, PRs, or PR comments.
- Persist follow-up evidence in run state, operation ledger, status output, and final reports.
- Fix the misleading error wrapper that reported staging/follow-up failures as Jira read failures.

BC must not implement Cubic, production merge automation, production deploy, Telegram, WhatsApp, dashboard, or conversational operator-agent behavior.

## Railway Deployment Mapping Per Repository

Milestone BD should make Railway staging verification explicit per controlled repository instead of relying on `railway link` or a single current working directory.

Target model:

```yaml
repos:
  - id: frontend
    path: ./frontend
    provider: github
    owner: massmr
    name: frontend
    default_branch: develop
    production_branch: main
    deployments:
      staging:
        provider: railway
        project_id: prj_xxx
        environment_id: env_xxx
        service_id: svc_xxx
        branch: develop
        verification:
          mode: railway_mcp
          smoke_urls:
            - /health
      production:
        provider: railway
        project_id: prj_xxx
        environment_id: env_yyy
        service_id: svc_xxx
        branch: main
        verification:
          mode: require_human
```

Build:

- Extend workspace config so every discovered or explicit repo can declare zero, one, or multiple deployment targets.
- Support at least `none`, `railway_mcp`, `http_smoke`, and `github_only` verification modes.
- Prepare a later typed Railway discovery/setup surface that uses Railway MCP read-only tools such as `list_projects`, `list_services`, `environment_status`, and `get_service_config` when available.
- Preserve the config shape needed for a later `ewokbot init` flow where operators can map each repository to a Railway project/environment/service without typing raw MCP server ids or relying on `railway link`.
- Preserve manual id entry for non-interactive setup, CI/VPS setup, or unavailable Railway sessions.
- Update `ewokbot doctor` to validate per-repo Railway mappings, missing ids, unavailable MCP commands, missing Railway login/session, and configured smoke URLs without calling mutating Railway tools.
- Update staging verification to pass the configured `project_id`, `environment_id`, and `service_id` from the selected repo deployment mapping into Railway MCP tools.
- Keep production deployment verification human-only unless a later milestone explicitly approves production observation.
- Write reports that name the repo id and Railway mapping used, while never printing secret values.

Acceptance:

- A multi-repo workspace can represent `frontend -> Railway service A`, `api -> Railway service B`, and `worker -> explicit no deployment`.
- Real staging verification no longer depends on a linked Railway project in the repo directory.
- Init manual mapping can write the persisted shape that Railway discovery will later populate automatically.
- Doctor gives actionable output for missing or incomplete repo deployment mappings.
- Tests remain fake-only with mock Railway MCP clients; no live Railway CLI, MCP server, Docker, network, or deployed URL calls happen in tests.
- Railway mutating tools such as deploy, scale, variables, domains, remove, and source/link mutation remain denied by default.

BD must not implement Cubic, the operator-agent sandbox, the web UI, production merge automation, production deploy, Telegram, WhatsApp, or raw MCP tool exposure.

## Railway MCP Discovery And Repository Mapping

Milestone BE should turn the BD Railway mapping model into a guided setup flow.

Goal:

Operators should be able to run `ewokbot init`, discover Railway projects/services through read-only Railway MCP tools, and map each controlled local repository to its staging Railway target without relying on `railway link` or typing raw ids when discovery is available.

Build:

- Add a typed `RailwayDiscoveryPort` or equivalent setup-only boundary.
- Implement a Railway MCP discovery adapter using only approved read-only setup tools such as `list_projects`, `list_services`, `get_service_config`, and safe environment/status reads when available.
- Keep discovery separate from runtime staging verification: init/setup lists choices, while smoke/runtime uses only explicit persisted mappings.
- Update interactive `ewokbot init` so discovered sibling repositories can be mapped to Railway project/environment/service choices through the TUI.
- Preserve manual project/environment/service id entry for non-interactive setup, VPS setup, unavailable Railway sessions, or incomplete MCP discovery results.
- Persist mappings under discovery mode as `repos.deployments.<repo>.staging` so sibling Git repository discovery is preserved and unmapped repositories are not dropped.
- Let operators explicitly choose `none` or `github_only` for repositories that should not run Railway verification.
- Update `ewokbot doctor` and docs so missing Railway mappings are actionable: a Railway smoke run must fail before staging verification unless the selected repository has a valid mapping or an explicit skip mode.
- Record discovery/setup decisions without printing Railway variable values, tokens, or credential-like data.

Acceptance:

- `ewokbot init` can present discovered local repositories and discovered Railway projects/services using fake Railway MCP discovery data in tests.
- The generated workspace config keeps `repos.discovery: sibling-git-directories` and writes per-repository overrides under `repos.deployments`.
- A workspace can map `frontend -> Railway service A`, `api -> Railway service B`, and `worker -> none` without losing any sibling Git repository.
- Manual id entry remains available and produces the same persisted mapping shape.
- Runtime smoke/staging verification still uses only the selected repository's persisted mapping and does not depend on Railway CLI link state.
- Missing mapping fails clearly unless the repo has an explicit `none` or `github_only` verification mode.
- Tests remain fake-only with mock Railway MCP clients; no live Railway CLI, live MCP server, Docker, OAuth, network, provider deployment, or deployed URL calls happen in tests.
- Railway mutating tools such as deploy, scale, variable mutation, variable reads, domain generation, source/link mutation, remove, and production deployment remain denied by default.

BE must not implement Cubic, the operator-agent sandbox, the web UI, production merge automation, production deploy, Telegram, WhatsApp, or raw MCP tool exposure.

## Invocation Control UI v0

Status: Implemented as the BF scope. BG, BH, and BI remain future milestones.

Milestone BF should introduce the first local Next.js control surface for one Ewokbot invocation. It should help operators configure and inspect the current workspace without turning Ewokbot into a SaaS, hosted dashboard, or raw shell surface.

Build:

- Add `ewokbot ui` to start a local Next.js UI bound to the current workspace root.
- Read workspace config, repository discovery, provider modes, delivery policy, Railway mapping placeholders, and run/report state through a safe backend/API boundary.
- Show tickets or work items through safe scan output when configured.
- Show active, blocked, failed, completed, and needs-human runs with report links.
- Provide read-only controls for doctor, scan, runs, inspect, and report viewing.
- Allow minimal non-secret workspace config edits needed for setup.
- Keep secrets redacted or write-only.

Acceptance:

- One invocation maps to one local UI session and one workspace.
- UI API responses never expose `.ewokbot/.env` values or provider credentials.
- UI read-only actions do not start OpenCode, create branches, open PRs, merge, verify staging, or deploy.
- Tests remain fake-only with no live provider, MCP, OpenCode, Docker, OAuth, shell, or network calls.

BF must not implement operator-agent chat, Cubic, Telegram, WhatsApp, production merge automation, or production deploy.

## Railway Mapping UI

Milestone BG should extend the local invocation UI with the Railway setup experience that is currently too heavy for CLI-only configuration.

Build:

- Show each controlled repository and its current staging verification mode.
- Use the existing Railway discovery boundary to show projects/services/status through read-only MCP tools.
- Let operators choose `railway_mcp`, `github_only`, or `none` per repository.
- Let operators select discovered project/environment/service ids or manually enter ids.
- Persist the same `repos.deployments.<repo>.staging` shape as `ewokbot init`.
- Re-run local validation and show actionable mapping errors after save.

Acceptance:

- Multi-repo Railway mapping works from fake discovery data in tests.
- Manual id entry remains available.
- Saving config preserves sibling repository discovery and does not drop unmapped repositories.
- Runtime smoke still uses persisted mappings only.
- Tests remain fake-only with no live Railway CLI, MCP server, Docker, OAuth, provider API, deployed URL, or network calls.

BG must not implement operator-agent chat, Cubic, Telegram, WhatsApp, production merge automation, or production deploy.

## Invocation Control UI Shell Refactor

Status: Completed on 2026-06-13. The local invocation UI now uses a fixed operator-console shell with internal panel scrolling while preserving the existing safe BF/BG UI surfaces.

Milestone BH should turn the current invocation UI from a vertically stacked page into a true operator workbench that fits inside `100vh` / `100vw` without global page scrolling.

Build:

- Replace the page-like stacked layout with a fixed application shell.
- Use a dense operator-console structure with:
  - compact top bar
  - left navigation/sidebar
  - central work surface
  - right inspector/details panel
  - optional bottom console/report/output panel
- Keep the viewport itself non-scrolling; only internal panels may scroll.
- Rework the current large cards/sections into compact tables, lists, tabs, inline controls, and inspectors.
- Keep Railway mapping and workspace configuration usable inside the shell without pushing content vertically.
- Make the UI feel like configuration software or an operational console, not a landing page or a long document.
- Preserve the current safe local-only boundaries, typed backend/API model, and secret redaction behavior.
- Keep `doctor`, repositories, Railway mappings, runs, and reports accessible through the new shell structure.

Acceptance:

- The UI is usable at `100vh` / `100vw` on desktop without global vertical scrolling.
- Workspace navigation, Railway mapping, run inspection, and report viewing fit inside internal panels with local scrolling where needed.
- The layout remains operationally dense and readable for multi-repo workspaces.
- Existing BF/BG functionality remains available after the layout refactor.
- Tests remain fake-only and do not call live providers, MCP servers, OpenCode, Docker, OAuth, shells, or networks.

BH must not implement the conversational operator agent, Cubic, Telegram, WhatsApp, production merge automation, or production deploy.

## Operator Agent Action Sandbox

Milestone BI should introduce the future Ewokbot agent control layer. The agent may converse with the operator, but it must only invoke approved Ewokbot commands and typed ports.

Build:

- Define an `OperatorActionPort` or equivalent command surface for allowed actions.
- Allow the agent to list runs, inspect runs, plan tickets, start confirmed flows, pause/resume, approve/reject local intents, and show reports through typed Ewokbot actions.
- Prevent raw shell, raw MCP tool calls, provider credentials, unrestricted filesystem access, production merge, and production deployment.
- Add policy checks for every action, with deterministic `allow`, `needs_human`, or `deny` decisions.
- Persist agent decisions and operator confirmations in the run/control ledger.

Acceptance:

- The agent can drive existing Ewokbot flows only through approved actions.
- Tests prove denied actions cannot call raw MCP, shell, git, provider APIs, or production operations.
- CLI and UI remain primary control planes; the agent is an interface over Ewokbot, not a bypass around it.

BI must not implement Cubic, Telegram, WhatsApp, production merge automation, or production deploy.

## Cubic Review Provider

Milestone BJ should add Cubic as an optional review provider.

Build:

- Add a review-provider port with Cubic as the first implementation.
- Update init and doctor for Cubic selection/detection.
- Run Cubic after Ewokbot local evidence gates and before scoped commit when configured.
- Verify expected Cubic PR review evidence after PR creation when configured.
- Persist Cubic review evidence in run state, reports, and status output.

Acceptance:

- Required failed or missing Cubic review blocks before commit, push, PR, or staging.
- Cubic remains interchangeable with future review providers.
- Tests remain fake-only with no live Cubic, GitHub, MCP, OpenCode, Docker, OAuth, provider API, or network calls.

BI must not implement production merge automation or production deploy.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone AF

Completed through Milestone AG. Workspace config supports `mock`, `real`, and selected `mcp` provider modes, adapter factories keep mock connectors as the default, real Jira/GitHub/Railway factories fail fast before live adapters are implemented, shared MCP client infrastructure exists without live provider calls, Jira, GitHub, and Railway MCP operations now have typed ports with audit capture and configurable tool names where applicable, native fallback contracts explicitly define when MCP, native, subprocess, mock, and human-only surfaces are allowed, and the public CLI can construct supported stdio MCP clients from `.ewokbot/workspace.yml` for scan, worker, and smoke.

Milestone AC added `ewokbot worker start`, `--once`, `--dry-run`, foreground continuous polling, workspace locking, graceful shutdown, operator-readable logs, and conservative restart state reuse that avoids duplicate side effects.

Milestone AD added local CLI control commands: `ewokbot runs`, `ewokbot inspect <run-id>`, `ewokbot pause`, `ewokbot resume <run-id>`, `ewokbot approve <run-id>`, `ewokbot reject <run-id>`, and `ewokbot logs <run-id>`. After AG, these commands operate on persisted state and sidecar control files under `.ewokbot/runs/`, and approval commands record local human decisions only without merging or deploying production.

Milestone AE added `ewokbot smoke <ticket-key> --confirm-real-provider-smoke [--run-id <run-id>]` for one explicitly confirmed real-provider smoke path. After BB, the command loads `.ewokbot/workspace.yml`, fails missing confirmation before any doctor/config/MCP/state/git/OpenCode/quality/provider/deployment side effects, requires Jira, GitHub, and Railway provider modes to all be `mcp`, validates scoped runtime MCP readiness for Jira `TicketPort.getTicket`, GitHub develop PR handoff tools, and Railway read-only staging evidence, reads exactly one Jira ticket, refuses an existing `.ewokbot/runs/<ticket-key>/<run-id>/` directory or `state.json` before repository side effects, requires exactly one selected repository, then proceeds through local git branch creation, OpenCode/dev-runner execution, meaningful diff, agent completion, core safety, local quality gates, test relevance, develop PR handoff, read-only Railway staging verification, configured staging smoke URLs, `staging-report.md`, and final report evidence. It does not list the full backlog, perform unrelated Jira transitions/comments, call Railway mutating tools, call Vercel, implement multi-repo autonomy, prepare or open production PRs, merge production, or deploy production.

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
9. AZ - GitHub MCP Real Mapping. Implemented in this pass; awaiting acceptance.
10. BA - GitHub PR Handoff v1. Complete and accepted.
11. BB - Real Staging Verification v1. Implemented but still dependent on develop PR follow-up acceptance.
12. BB1 - Commit Scoped Agent Diff Before Develop PR Handoff. Complete and accepted.
13. BC - Develop PR Follow-Up Policy. Implemented in this pass and awaiting acceptance.
14. BD - Railway Deployment Mapping Per Repository. Implemented and awaiting acceptance.
15. BE - Railway MCP Discovery And Repository Mapping. Implemented in this pass and awaiting acceptance.
16. BF - Invocation Control UI v0. Planned after BE acceptance only.
17. BG - Railway Mapping UI. Planned after BF acceptance only.
18. BH - Operator Agent Action Sandbox. Planned after BG acceptance only.
19. BI - Cubic Review Provider. Planned after BH acceptance only.

Anything outside BF must wait until the later milestone is explicitly approved. Anything outside AU-BI must be proposed here first and must not be implemented until approved.

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
29. AZ - GitHub MCP Real Mapping. Implemented; awaiting acceptance.
30. BA - GitHub PR Handoff v1. Complete and accepted.
31. BB - Real Staging Verification v1. Implemented but still dependent on develop PR follow-up acceptance.
32. BB1 - Commit Scoped Agent Diff Before Develop PR Handoff. Complete and accepted.
33. BC - Develop PR Follow-Up Policy. Implemented in this pass and awaiting acceptance.
34. BD - Railway Deployment Mapping Per Repository. Implemented and awaiting acceptance.
35. BE - Railway MCP Discovery And Repository Mapping. Implemented in this pass and awaiting acceptance.
36. BF - Invocation Control UI v0. Planned after BE acceptance only.
37. BG - Railway Mapping UI. Planned after BF acceptance only.
38. BH - Operator Agent Action Sandbox. Planned after BG acceptance only.
39. BI - Cubic Review Provider. Planned after BH acceptance only.

Non-goals for the immediate next milestone:

- Telegram or WhatsApp control.
- Hosted SaaS dashboard.
- Daemonization through systemd, pm2, Docker, or hosted workers.
- Live provider calls during tests.
- Live MCP server startup or OAuth flows during tests.
- Automatic global installs without explicit user confirmation.
- Demanding OpenAI/Anthropic API keys during Ewokbot init when OpenCode owns the selected runner auth flow.
- Sentry, PostHog, Notion, support, SEO, or other signal ingestion.
- Autonomous production merge or production deployment.

## Safety: GitNexus impact (short)

Before editing any symbol in src/delivery/*, run the GitNexus impact analysis and follow the safety checklist in docs/tracking/gitnexus-safety.md. Recent analysis shows runDevelopPullRequestHandoff → RISK=HIGH. See docs/tracking/gitnexus-safety.md for the exact steps to follow and the required PR process when a change is proposed.

Related: a conservative CI proposal was added at docs/tracking/ci-proposal.md. The CI is intentionally gated: GRAPHIFY must be opt-in and no secrets are used by default.
