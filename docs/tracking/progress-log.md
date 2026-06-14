# Progress Log

## 2026-06-13

Implemented Milestone BH Invocation Control UI Shell Refactor:

- Reworked the local `ewokbot ui` Next.js page from a vertically stacked document into a fixed `100vh` / `100vw` operator console shell with compact top bar, left navigation, central work surface, right inspector, and bottom runs/reports output panel.
- Kept workspace readiness, safe config editing, provider summaries, delivery policy, repository list, Railway staging mapping, MCP server summaries, doctor checks, runs, and report paths visible through internal panels.
- Disabled global page scrolling and moved scrolling to shell regions only, preserving the local-only API boundary and existing BF/BG editor props without adding backend/provider behavior.
- Kept BH scope only: no operator-agent chat, Cubic, Telegram, WhatsApp, hosted dashboard, production merge automation, production deploy, raw shell access, or raw MCP controls were added.

Verification commands run for BH:

- `lsp_diagnostics` on changed UI and tracking files was attempted, but the environment does not have `typescript-language-server` or Biome LSP installed and Markdown has no configured LSP; no install was performed.
- `pnpm typecheck`
- `pnpm exec next build ui`
- `pnpm build`
- `pnpm test` (`458/458`)
- `git diff --check`
- `gitnexus_detect_changes({ scope: "all", repo: "ewokbot" })` reported MEDIUM risk with the changed UI process limited to `Page -> Value`; tracking-file changes include the already-present BH/BG milestone reprioritization diff in `docs/plans/approved-backlog.md`.
- Browser QA loaded the existing local Next UI at `http://localhost:3000/` after the `--port 3002` launcher reported another dev server was already running. At `1440x900`, `html`, `body`, and `.operator-shell` stayed at viewport height with `overflow: hidden`; `.work-surface` and `.inspector` scrolled internally, and workspace readiness, repositories, Railway mapping, doctor, providers, delivery policy, MCP servers, runs, and reports were reachable. The only console error was a missing `/favicon.ico` asset.

Reprioritized the post-BG UI work:

- Accepted BG Railway Mapping UI.
- Moved the invocation UI shell redesign ahead of the operator-agent milestone because the current page layout is too vertically expansive for real operator use.
- Defined BH as Invocation Control UI Shell Refactor: fixed `100vh` / `100vw` operator shell, no global page scrolling, dense internal panels, and software-style configuration ergonomics.
- Shifted Operator Agent Action Sandbox to BI and Cubic Review Provider to BJ.

Implemented Milestone BG Railway Mapping UI:

- Added a dedicated local `ewokbot ui` Railway staging mapping screen for all controlled repositories in the current workspace.
- Added a scoped workspace API path for saving `repos.deployments.<repo>.staging` mappings without converting `repos.discovery: sibling-git-directories`, dropping `repos.exclude`, or touching unrelated repository mappings.
- Supported operator choices `railway_mcp`, `github_only`, and `none`; `railway_mcp` accepts read-only discovered Railway service selections or manual project/environment/service ids, while skip modes omit Railway ids.
- Re-ran local config parsing and doctor-style deployment validation after saves, returning actionable mapping feedback for the UI.
- Kept runtime smoke behavior on persisted mappings only. No Railway mutating tools, variable-value reads, raw shell, raw MCP controls, operator-agent chat, hosted dashboard, production merge, or production deploy work was added.
- Added fake-only backend/API coverage for multi-repo mapping saves, skip modes, read-only discovery injection, manual ids, unsupported/secret-like field rejection, validation errors, and preservation of sibling discovery plus unrelated config.

Resolved BG review blockers:

- Wired the real `ewokbot ui` CLI path to the typed Railway discovery seam so the local UI can use the same read-only Railway MCP discovery adapter as setup when configured, while preserving unavailable behavior without an injected port.
- Fixed explicit `repos: [...]` staging mapping saves to patch only `deployments.staging`, preserving sibling deployment targets such as production and preview.
- Added fake-only regression coverage for real CLI UI discovery injection and explicit repo-array deployment preservation, with no live Railway CLI, MCP server, Docker, OAuth, provider API, deployed URL, or network calls.

Verification commands run for BG:

- `lsp_diagnostics` on changed TypeScript/UI files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm typecheck`
- `pnpm build`
- `pnpm build && node --test dist/test/ui-backend.test.js` (`12/12`) during focused backend verification
- `pnpm test` (`458/458`)
- `pnpm exec next build ui`
- `git diff --check`
- `gitnexus_detect_changes({ scope: "all", repo: "ewokbot" })` reported HIGH risk because BG touches the shared local UI backend/API summary flow; the affected UI/API paths are covered by the passing UI backend contract tests, full test suite, and Next UI build above.

## 2026-06-12

Implemented Milestone BF Invocation Control UI v0:

- Added `ewokbot ui` as a local-only invocation control surface for the current workspace root, with the Next.js UI served through a safe workspace API sidecar.
- Surfaced workspace config parse status, provider modes, delivery policy, discovered repositories, MCP server ids/configured providers, Railway staging mappings, run states, and known run reports without exposing `.ewokbot/.env` values or provider secrets.
- Kept BF actions inside the approved boundary: doctor/readiness, typed-port ticket scan, runs/inspect/report reads, and minimal non-secret workspace config edits. No OpenCode execution, branch/PR creation, merge, staging verification, deployment, rollback, scaling, raw shell, or raw MCP tool surfaces were added.
- Added fake-only coverage for the UI CLI launcher, backend summaries, local doctor/scan boundaries, safe report reads, safe config patching, and the workspace API/UI port separation found during manual UI verification.
- Remediated the BF review findings by waiting for the Next UI to become reachable before printing the local URL, failing clearly and closing the API server when the UI process exits before readiness, using the same default local-only doctor probes as `ewokbot doctor`, deriving the API CORS origin from the selected local UI port, and exposing only workspace name, autonomy, and max concurrent ticket config controls.
- Fixed the remaining live UI lifecycle bug by launching the concrete Next CLI binary when available, keeping the workspace API lifetime owned by the Ewokbot UI handle instead of a package-manager wrapper exit, requiring `/api/summary`, `/api/doctor`, and the real app route to be healthy before printing the URL, and closing the UI/API explicitly on parent shutdown.
- Left BG Railway Mapping UI, BH Operator Agent Action Sandbox, and BI Cubic Review Provider as future milestones.

Verification commands run for BF:

- `lsp_diagnostics` on changed TypeScript and test files was attempted earlier, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm typecheck`
- `pnpm build`
- `node --test dist/test/cli-ui.test.js dist/test/ui-backend.test.js` (`11/11`)
- `pnpm test` (`448/448`)
- `pnpm exec next build ui`
- `node dist/src/cli/index.js ui --port 3002` with repeated `curl http://127.0.0.1:3002/`; launcher log showed a successful app `GET / 200` before the Ewokbot URL was printed, the live `/api/summary` and `/api/doctor` payloads did not include `.ewokbot/.env` or credential-looking values, and shutdown released port 3002.
- `git diff --check`
- `gitnexus_detect_changes({ scope: "all", repo: "ewokbot" })` reported HIGH risk because the shared CLI dispatch surface changed; the affected CLI paths are covered by the passing help, UI, and full command test suite above.

Reprioritized the post-BE roadmap around a local invocation UI:

- Moved the first UI ahead of the operator-agent milestone because Railway/MCP multi-repo setup is now too heavy for CLI-only configuration.
- Defined BF as Invocation Control UI v0: `ewokbot ui`, local Next.js, one invocation equals one workspace-bound UI session, read-only doctor/scan/runs/inspect/report views, and minimal non-secret workspace config editing.
- Defined BG as Railway Mapping UI: per-repository Railway project/environment/service mapping through read-only discovery or manual entry.
- Moved Operator Agent Action Sandbox to BH so the future conversational agent can reuse the same safe action surfaces exposed by the CLI/UI.
- Moved Cubic Review Provider to BI.
- Kept production merge, production deployment, raw shell, raw MCP tools, Telegram, WhatsApp, and hosted SaaS dashboard work out of BF/BG.

## 2026-06-11

Implemented Milestone BE Railway MCP Discovery And Repository Mapping:

- Added a setup-only Railway MCP discovery boundary that allowlists read-only `list_projects`, `list_services`, and `get_service_config` tool mappings separately from the runtime Railway deployment adapter.
- Extended interactive `ewokbot init` so injected Railway discovery can present discovered sibling Git repositories and Railway services, persist per-repo staging mappings under `repos.deployments`, and preserve unmapped sibling repositories through `repos.discovery: sibling-git-directories`.
- Preserved manual project/environment/service id entry and explicit `none`/`github_only` skip choices for unavailable discovery, incomplete discovery results, non-interactive setup, or operator preference.
- Kept runtime smoke/staging verification on persisted repository mappings only; no `railway link` dependency, Railway mutation tools, variable-value reads, production deployment, or live provider calls were added.
- Added fake-only coverage for the discovery adapter and init mapping flow, including `api` and `frontend` Railway MCP mappings plus a `worker` explicit `none` skip without printing Railway tokens or variable values.

Verification commands run for BE:

- `lsp_diagnostics` on changed TypeScript and test files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm run typecheck`
- `pnpm run build`
- `node --test dist/test/railway-mcp-deployment-port.test.js dist/test/cli-init.test.js` (`39/39`)
- `pnpm test` (`426/426`)
- `git diff --check`
- `gitnexus_detect_changes({ scope: "all", repo: "ewokbot" })` reported critical overall impact across the existing staged BD/BE workspace diff; focused BE discovery/init behavior is covered by the passing fake-only tests above.

Prepared Milestone BE Railway MCP Discovery And Repository Mapping:

- Reframed the next approved Railway work as a guided setup/discovery milestone rather than the operator-agent milestone.
- Defined the BE target flow: discover local repositories, discover Railway projects/services through read-only Railway MCP tools, map each repo to its staging Railway target, and persist mappings under `repos.deployments` while preserving sibling Git discovery.
- Shifted the later milestones to BF Operator Agent Action Sandbox, BG Ewokbot Control UI v1, and BH Cubic Review Provider. This was later reprioritized on 2026-06-12 so BF is now Invocation Control UI v0, BG is Railway Mapping UI, BH is Operator Agent Action Sandbox, and BI is Cubic Review Provider.
- Updated README and tracking docs so missing Railway mappings are treated as actionable failures unless the repository explicitly chooses `none` or `github_only`.

Implemented Milestone BD Railway Deployment Mapping Per Repository:

- Added explicit per-repository staging deployment mappings to workspace config, including Railway project, environment, service, branch, and verification mode fields.
- Supported repository verification modes `railway_mcp`, `http_smoke`, `github_only`, and `none`; worker-style repos should use an explicit `none` or `github_only` mode when Railway staging should be skipped.
- Updated Railway MCP staging verification to pass the selected repository mapping's `project_id`, `environment_id`, and `service_id` into read-only Railway MCP calls instead of relying on `railway link` or the current working directory.
- Kept Railway MCP access read-only by allowlisting discovery/setup evidence tools (`list_projects`, `list_services`, `get_service_config`) and deployment evidence tools (`environment_status`, `list_deployments`) without adding deploy, scale, variable, domain, source/link, production deploy, or other mutation paths.
- Extended interactive `ewokbot init` so operators can enter explicit per-repository Railway staging mappings and manual IDs when Railway discovery is unavailable; non-interactive init remains discovery-based and mock-safe by default.
- Extended `ewokbot doctor` with local-only per-repository deployment mapping diagnostics for missing Railway IDs, no-deployment repos, `http_smoke` URL requirements, and mapping IDs used for `railway_mcp`, without calling live Railway MCP, Railway CLI sessions, Docker, package managers, or network APIs.
- Surfaced the selected deployment mapping in staging reports, final reports, and status output so operators can see which repository/project/environment/service/mode was used.
- Added fake-only coverage for config parsing, incomplete mapping diagnostics, init rendering, doctor checks, staging skip/http-smoke/railway-mcp behavior, Railway MCP argument mapping, status output, and smoke command staging calls.
- Preserved BD scope only: no Cubic review provider, operator-agent sandbox, web UI, Telegram, WhatsApp, production merge automation, production deploy, Railway mutating tools, live provider/MCP/Docker/OAuth/network calls in tests, or raw MCP tool exposure was added.

Verification commands run for BD so far:

- `lsp_diagnostics` on changed TypeScript and test files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm run build`
- `node --test dist/test/setup/doctor.test.js dist/test/smoke-command.test.js dist/test/staging.test.js` (`33/33`)

## 2026-06-09

Implemented Milestone BC Develop PR Follow-Up Policy:

- Added branch-scoped delivery policy parsing for develop PR follow-up, with safe default `delivery.checks.no_remote_checks: wait` so absent remote CI does not pass unless explicitly configured.
- Extended the typed `CodeHostPort` and GitHub MCP mapping with PR state reads and develop-only merge operations, while keeping main/production PRs human-only and preserving `merge_pull_request` as policy-gated only through the typed develop follow-up path.
- Added develop PR follow-up decisions for zero checks (`pass`, `wait`, `needs_human`, `fail`), pending checks, failed/cancelled checks, human-merged PRs, closed-unmerged PRs, and explicit develop `auto_merge`.
- Completed the BC review remediation: removed the runtime MCP `require_human` merge bypass, kept raw `merge_pull_request` human-only at the generic MCP policy layer, and narrowed typed develop auto-merge readiness to explicit develop `auto_merge`, `require_human_approval: false`, and explicit MCP policy allow.
- Applied `require_checks` and `require_human_approval` during follow-up decisions. Absent checks with `no_remote_checks: pass` now become staging-ready only when `require_checks: pass_or_absent` is configured, and develop is merged first when auto-merge is enabled; otherwise Ewokbot waits or escalates instead of staging an open PR.
- Added a follow-up-only runner for persisted `PR_TO_DEVELOP_OPENED` states that rereads PR state/checks and optionally merges develop without recreating local branches, commits, pushes, PRs, or PR comments.
- Persisted follow-up evidence in run state and operation ledger records, and surfaced the evidence in status output and final reports.
- Stopped real-provider smoke runs before Railway staging unless develop follow-up reaches `DEVELOP_CHECKS_PASSED`; closed, waiting, failed, or human-needed follow-up outcomes do not call Railway staging verification.
- Fixed smoke failure attribution so GitHub develop follow-up and Railway staging failures are not reported as Jira read failures.
- Added fake-only coverage for config defaults/validation, GitHub MCP PR read/merge mapping, runtime MCP readiness, handoff policy decisions, smoke follow-up behavior, and mock worker/end-to-end compatibility.
- Preserved BC scope only: no BD Cubic Review Provider, BE operator sandbox, production merge automation, production deployment, Railway mutations, live provider/MCP/Docker/OpenCode/OAuth/network calls in tests, or main/production auto-merge work was added.

Verification commands run for BC:

- `lsp_diagnostics` on `src` and `test` was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm typecheck`
- `pnpm run build`
- `node --test dist/test/git-github.test.js dist/test/runtime-mcp-wiring.test.js dist/test/config/workspace-config.test.js dist/test/smoke-command.test.js`
- `node --test dist/test/milestone-i.test.js dist/test/worker-runtime.test.js dist/test/worker-mcp-mode.test.js dist/test/cli-help.test.js`
- `pnpm test` (`404/404`)
- `git diff --check`

## 2026-06-10

- Ran graphify AST extraction and clustering locally (no LLM backend). Results were written to the local, unversioned `graphify-out/` directory:
  - Nodes: 2591
  - Edges: 6320
  - Communities (clusters): 121
  - Files produced locally: `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md`

- Notes & next steps:
  - The extraction was run without an LLM backend (no GEMINI/OPENAI key), so community names remain "Community N" placeholders. To enable LLM-based community naming and deeper semantic edges, set an API key (e.g. GOOGLE_API_KEY or OPENAI_API_KEY) and run `graphify label` or `graphify extract --backend <name>`.
  - For focused architecture questions use `graphify query "<question>"` against a freshly generated local `graphify-out/graph.json` to limit scope and token usage.
  - Action items: add a short CI proposal to `docs/tracking/next-actions.md` (draft for review), keep generated `graphify-out/` artifacts out of Git, and upload them only as explicit CI artifacts when reviewers opt in.

Planned Milestone BC Develop PR Follow-Up Policy after real SCRUM-6 smoke:

- Recorded that the SCRUM-6 real smoke reached GitHub PR handoff successfully after BB1: OpenCode produced scoped product changes, local quality passed, the scoped commit was created, the branch was pushed, GitHub MCP opened PR #3, GitHub MCP added a PR comment, and PR number parsing worked.
- Recorded the remaining blocker: GitHub checks returned `totalCount: 0`, leaving Ewokbot at `PR_TO_DEVELOP_OPENED` without a policy for absent remote CI checks, human-merged PRs, closed PRs, or develop auto-merge.
- Added BC as the next approved milestone for branch-scoped develop PR follow-up, including `auto_merge`, `merge_method`, `no_remote_checks`, PR polling, closed/merged handling, and staging handoff only after develop is accepted or merged by policy.
- Deferred Cubic Review Provider to BD and Operator Agent Action Sandbox to BE.
- Updated README, approved backlog, next actions, and roadmap only; no runtime code was changed.

Implemented Milestone BB1 Commit Scoped Agent Diff Before Develop PR Handoff:

- Added a scoped local commit step after meaningful diff, agent completion, core safety, local quality gates, and test relevance pass, and before local branch push or develop PR creation.
- Limited the commit operation to the meaningful-diff product files, rejected unsafe relative paths before staging, normalized the deterministic commit message, and kept local git execution behind the native/subprocess fallback with argument-array commands.
- Preserved operation-ledger idempotency for the new `git:LocalGitAdapter.commitScopedAgentDiff` operation so reruns reuse the recorded commit metadata instead of duplicating commits, pushes, or PR side effects.
- Persisted and surfaced the scoped agent diff commit SHA in run state, branch head metadata, smoke output, develop PR body/comment, status output, and final reports.
- Fixed the real-provider smoke failure formatter so GitHub develop PR handoff errors such as `create_pull_request` failures are reported as GitHub handoff failures instead of misleading Jira read failures.
- Added fake-only regression coverage for scoped staging, unsafe file refusal, commit-before-push ordering, ledger replay, smoke success evidence, smoke GitHub handoff failure wording, status output, and final reports.
- Preserved BB1 scope only: no BD review adapter, BE operator sandbox, production PR automation, production merge, production deployment, dashboard, Telegram, WhatsApp, live provider/MCP/Docker/OAuth/network calls in tests, or real remote git endpoints were added.

Verification commands run for BB1:

- `lsp_diagnostics` on changed TypeScript and test files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm typecheck`
- `pnpm run build`
- `node --test dist/test/git-github.test.js dist/test/smoke-command.test.js dist/test/status.test.js dist/test/milestone-i.test.js` (`43/43`)
- `pnpm test` (`383/383`)
- `git diff --check`

Implemented Milestone BB Real Staging Verification v1:

- Changed the confirmed real-provider smoke path to preserve the BA local evidence gates before provider handoff: meaningful diff, agent completion, core safety, local quality, and test relevance evidence are written before develop PR side effects.
- Added scoped runtime MCP readiness for the smoke path so Jira intake validates only `TicketPort.getTicket`, GitHub handoff validates the actual develop PR handoff tool group, and Railway validates read-only staging deployment evidence required for `DeploymentPort.waitForDeployment` plus configured service URL fallbacks.
- Tightened BB smoke preflight so `jira.mode`, `github.mode`, and `railway.mode` must all be `mcp`; mock GitHub or Railway mode now fails before run state, git, OpenCode, quality, provider handoff, operation ledger, staging report, production PR, merge, or deploy side effects.
- Aligned the BB smoke evidence gates with `run-dev` so agent completion, core safety, or test relevance decisions that require human input transition to `NEEDS_HUMAN` instead of `FAILED`, before provider handoff or staging side effects.
- Continued the smoke path after develop PR handoff into Railway staging verification, using policy-approved read-only deployment evidence plus the injectable smoke URL verifier, and writing `staging-report.md` with deployment and smoke-check results.
- Stopped the real-provider smoke path at `STAGING_VERIFIED`; production PR preparation, production merge, and production deployment remain human-only and were not attempted.
- Added fake-only CLI regression coverage for provider-mode preflight failure and fake GitHub/Railway MCP staging verification, including assertions that Railway deploy, rollback, scale, variable, domain, and secret-sensitive tools are never called.
- Preserved BB scope only: no BC develop PR follow-up, BD review adapter, BE operator sandbox, Vercel deployment, production PR automation, live provider/MCP/Docker/OAuth/network calls in tests, Railway mutating tools, production merge, or production deployment was added.

Verification commands run for BB:

- `lsp_diagnostics` on changed TypeScript and test files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm typecheck`
- `node --test dist/test/smoke-command.test.js` (`7/7`)
- `pnpm test`
- `pnpm build`
- `git diff --check`

Implemented Milestone BA GitHub PR Handoff v1:

- Moved develop PR handoff readiness ahead of branch, push, PR, state-write, and operation-ledger side effects.
- Required passed local evidence before develop handoff: `LOCAL_CHECKS_PASSED`, latest required local quality passed, meaningful diff passed, agent completion passed, core safety passed, and test relevance passed.
- Added scoped GitHub runtime readiness for typed `CodeHostPort` construction so missing or denied `create_pull_request` MCP policy fails before local git push, GitHub PR creation, or operation-ledger mutation; the error points operators to the BA policy override.
- Corrected the production BA orchestration path to construct the GitHub `CodeHostPort` through `createRuntimeCodeHostPort` after local BA evidence passes and before any handoff side effects; scoped readiness requires only the BA handoff action `openPullRequest`/`create_pull_request`, and mock GitHub mode bypasses MCP readiness as intended.
- Preserved operation-ledger idempotency for GitHub branch readiness/creation, local git push fallback, and develop draft PR creation across reruns.
- Updated develop draft PR bodies to include ticket, repo, branch, run id, quality summary, meaningful diff summary, core safety summary, test relevance summary, and local-only handoff notes that exclude production PRs, merges, deployments, production branch pushes, and production approval bypasses.
- Updated legacy fake mock delivery evidence so existing fake-only end-to-end and worker tests still provide local evidence before their mock develop handoff.
- Preserved BA scope only: no production PR handoff expansion, production merge, production deployment, BB staging verification, BC develop PR follow-up, BD review adapter, BE operator sandbox, live GitHub calls, live MCP/Docker/OAuth/network calls, remote git endpoints, provider CLIs, or test remotes were added.

Verification commands run for BA:

- `lsp_diagnostics` on changed TypeScript and test files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm typecheck`
- `pnpm run build`
- `node --test dist/test/git-github.test.js dist/test/runtime-mcp-wiring.test.js dist/test/milestone-i.test.js dist/test/worker-runtime.test.js dist/test/worker-mcp-mode.test.js` (`44/44`)
- `node --test dist/test/git-github.test.js dist/test/runtime-mcp-wiring.test.js` (`27/27`)
- `pnpm test` (`376/376`)
- `git diff --check`

Implemented Milestone AZ GitHub MCP Real Mapping:

- Replaced guessed GitHub MCP defaults with inspected GitHub MCP tools from `docs/reference/github-mcp-tools.md`: `list_branches`, `create_branch`, `list_pull_requests`, `create_pull_request`, `pull_request_read`, and `add_issue_comment`.
- Preserved the typed `CodeHostPort` boundary while mapping branch readiness, remote branch creation, draft PR creation, PR-number lookup, check reads, and PR comments to documented fake-only inspected schemas.
- Preserved custom `github.mcp_tools` overrides and mock mode defaults; GitHub branch push remains on the local/native git fallback path.
- Classified inspected GitHub tools so read-only PR/branch/check reads are allowed by `read_only`, comments and branch creation are writes, PR creation and remote mutation tools are destructive/default-denied, unknown tools remain denied, and `merge_pull_request` remains human-only even under overrides.
- Updated runtime MCP readiness, provider factory wiring, worker MCP fixtures, and registry/policy tests so fake clients must expose required inspected GitHub tools before typed provider construction.
- Preserved AZ scope only: no BA GitHub PR handoff workflow, real GitHub calls, live MCP/Docker/OAuth/network calls, branch push, real PR creation, staging verification, operator-agent sandbox, worker daemon, Telegram/dashboard/Sentry/PostHog/Notion ingestion, production merge, or production deployment work was added.

Verification commands run for AZ:

- `lsp_diagnostics` on changed TypeScript and test files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm typecheck`
- `pnpm test` (`370/370`)
- `git diff --check`

## 2026-06-08

Implemented Milestone AY Railway MCP Real Mapping:

- Replaced guessed Railway MCP defaults with inspected Railway MCP deployment evidence tools from `docs/reference/railway-mcp-tools.md`: `environment_status` and `list_deployments`.
- Updated Railway `DeploymentPort` reads to use safe read-only evidence: environment status plus recent deployments for wait/read flows. Service URLs now come from deployment evidence or explicitly configured safe URL tools; `get_service_config` is not assumed to return service URLs by default.
- Preserved `railway.mcp_tools` custom overrides while adding parsed override keys for the inspected Railway read tools.
- Classified `list_variables`, `set_variables`, and `add_reference_variable` as secret-sensitive; schema defaults for Railway variable values are redacted in registry snapshots.
- Kept `whoami`, `http_error_rate`, `http_requests`, and `http_response_time` unmapped/unknown/denied by default, classified Railway source/link mutation tools as denied by default, and kept deploy, domain generation, scaling, create/update/remove, variable mutation, staging mutation, GitHub handoff, production merge, and production deployment outside AY scope.
- Added fake-only coverage for default mappings, list-deployment array parsing, explicit custom URL tool behavior, custom overrides, missing tools, Railway registry classifications, policy denial, and no Railway variable-value leakage.

Verification commands run for AY:

- `lsp_diagnostics` on changed TypeScript and test files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm typecheck`
- `pnpm test` (`366/366`)
- `git diff --check`

Implemented Milestone AX Atlassian MCP Real Mapping:

- Replaced the Jira `TicketPort` default MCP tool names with the documented Atlassian MCP tools: `search_jira_issues`, `read_jira_issue`, and `add_jira_comment`.
- Updated `TicketPort.comment` to call the Atlassian comment tool with `{ issueKey, body }` while preserving `jira.mcp_tools` custom overrides and existing `jira:` workspace config compatibility.
- Preserved empty `jira.project_keys: []` behavior as an unconstrained Jira backlog JQL query across all visible projects.
- Added fake-only coverage for default mappings, list/get/comment argument schemas, missing configured tools, custom overrides, empty project keys, and `read_only` policy denial for Jira comments before provider tool calls.
- Preserved AX scope only: no Confluence workflows, Railway mapping, GitHub mapping, PR handoff, staging verification, worker daemon, Telegram/dashboard/Sentry/PostHog/Notion ingestion, production merge, or production deployment work was added.

Verification commands run for AX:

- `lsp_diagnostics` on changed TypeScript and test files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm typecheck`
- `pnpm test` (`358/358`)
- `git diff --check`

Implemented Milestone AX0 Atlassian Naming And Init Realignment:

- Renamed interactive init setup wording from Jira-only provider language to Atlassian-first language: the provider prompt now offers `Atlassian MCP`, and the URL prompt now asks for the `Atlassian site URL`.
- Kept the Jira-specific backlog filter wording unchanged: `Constrain to Jira project keys, comma-separated (optional; leave blank for all projects)`, with empty input still writing `project_keys: []` for all visible Jira projects.
- Updated setup capability and doctor guidance to describe Atlassian MCP setup with Jira as the first supported work-item product while preserving `jira:` config compatibility and the existing `jira-mcp` runtime selection value.
- Updated README/spec wording to explain Atlassian MCP as the provider setup boundary, Jira as the currently implemented work-item surface, and Confluence as future policy-gated work that is not implemented now.
- Preserved AX0 scope only: no real Atlassian tool-name/schema mapping, default MCP tool-name changes, Confluence workflows, provider mutations, GitHub PR handoff, staging verification, operator-agent sandbox, production merge, or production deployment work was added.

Verification commands run for AX0:

- `lsp_diagnostics` on changed TypeScript and test files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm typecheck`
- `pnpm test` (`354/354`)
- `git diff --check`

Accepted Milestone AW MCP Policy Modes:

- Marked AW as complete and accepted after review.
- Current MCP policy state is safe by default: `read_only` allows read-classified tools, non-read tools remain denied unless a later policy explicitly allows or requires human approval, and production merge/deployment remains human-only.
- No AX/AY/AZ provider mappings, BA GitHub PR handoff, BB staging verification, BC develop PR follow-up, BD review adapter, BE operator-agent sandbox, worker daemon, Telegram/dashboard, Sentry/PostHog/Notion ingestion, or autonomous production automation has been started as part of acceptance.

Completed GitHub MCP Docker preset unblocker:

- Updated the maintained GitHub MCP setup path so onboarding no longer asks for a global GitHub organization.
- GitHub MCP now uses the official Docker-based local server preset: `docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server`.
- `ewokbot init` asks only for `GITHUB_PERSONAL_ACCESS_TOKEN` for GitHub MCP.
- Ewokbot derives repository owners from local git remotes, with the optional `github.organization` value acting only as a fallback.
- `ewokbot doctor` verifies the configured MCP server commands locally.
- A local playground smoke confirmed `ewokbot mcp inspect github` can start the GitHub MCP server, list 43 tools, and apply the default `read_only` policy without calling provider tools.
- This was an unblocker for real setup confidence, not AZ or BA implementation. GitHub real mapping and PR handoff remain future milestones.

Completed Atlassian setup realignment unblocker:

- Re-centered the roadmap around Atlassian rather than Jira-only while keeping Jira as the first work-item surface.
- Made Jira project keys an optional backlog constraint in onboarding and config rather than a required setup field.
- `ewokbot init` now prompts `Constrain to Jira project keys, comma-separated (optional; leave blank for all projects)`.
- Empty project-key input writes `project_keys: []`.
- Jira MCP backlog search now omits `project in (...)` when `project_keys` is empty, so the MCP session can scan all visible Jira projects.
- This was an onboarding/config unblocker, not AX implementation. Real Atlassian tool-name/schema mapping remains the next planned milestone and is not started.

Approved Milestone AX0 Atlassian Naming And Init Realignment:

- Added AX0 before AX so the product-facing setup is Atlassian-first before real tool mapping work begins.
- AX0 should rename init prompts and docs from "Jira MCP" provider language to "Atlassian MCP" provider language while keeping Jira-specific project-key constraints as the first work-item filter.
- AX0 should keep `jira:` config compatibility unless a tested backward-compatible `atlassian:` alias/migration is included.
- AX0 must not implement real Atlassian tool-name/schema mapping, Confluence workflows, provider mutations, GitHub PR handoff, staging verification, or production automation.

Implemented Milestone AW MCP Policy Modes review candidate:

- Added typed MCP policy modes `read_only`, `supervised`, `trusted`, and `custom`, plus policy decisions `allow`, `allow_redacted`, `require_human`, and `deny`.
- Added registry-based policy evaluation and reports with provider/server/tool override precedence, safe `read_only` defaults, unknown/unclassified default deny, redacted reporting for explicitly approved secret-sensitive reads, and human-readable reasons for every decision.
- Extended workspace config, generated onboarding config, and example config with top-level `mcp_policy` parsing and validation.
- Extended `ewokbot mcp inspect <server-id>` human and JSON output with policy decisions while preserving inspect-only behavior: it calls `listTools` and never calls provider tools.
- Added runtime MCP readiness policy checks before the existing typed-port allowlist guard and before provider side effects. Autonomous runtime execution proceeds only for `allow`; `deny`, `require_human`, and `allow_redacted` stop readiness.
- Preserved production merge/deploy as human-only, denied unknown tools by default, kept destructive delete/remove/destroy tools from autonomous allow, and kept raw MCP tool calling away from coding/operator agents.
- Added fake-only tests covering Atlassian, Railway, GitHub, custom, inspect output, config parsing, and runtime readiness decisions.
- Preserved AW scope only: no AX/AY/AZ provider mappings, BA GitHub PR handoff, BB staging verification, BC develop PR follow-up, BD review adapter, BE operator-agent sandbox, live provider/MCP/OAuth/network calls in tests, production merge/deploy automation, worker daemon, dashboard, Telegram, Sentry/PostHog/Notion ingestion, or autonomous production automation were added.

Verification commands run for AW so far:

- `lsp_diagnostics` on changed TypeScript and test files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm build`
- Initial focused `node --test dist/test/mcp-policy.test.js dist/test/config/workspace-config.test.js dist/test/cli-mcp.test.js dist/test/runtime-mcp-wiring.test.js` surfaced three test/fixture alignment issues; those were corrected.
- `node --test dist/test/mcp-policy.test.js dist/test/config/workspace-config.test.js dist/test/cli-mcp.test.js dist/test/runtime-mcp-wiring.test.js` (`46/46`)
- Initial `pnpm test` surfaced seven MCP readiness fixture issues where scan and worker tests were still validating write/destructive tools under the safe default policy; scan readiness is now scoped to backlog reads and worker fixtures declare explicit staging-safe overrides.
- `node --test dist/test/cli-scan.test.js dist/test/worker-mcp-mode.test.js` (`12/12`)
- `pnpm typecheck`
- `pnpm test` (`350/350`)
- `git diff --check`

Implemented Milestone AV MCP Tool Registry review candidate:

- Added typed MCP tool registry entries for inspected Atlassian, Railway, GitHub, and custom servers, including provider, server id, tool name, description, sanitized schemas, optional output metadata, category, classification, source, and default-deny policy metadata.
- Added registry classifications `read`, `write`, `destructive`, `secret_sensitive`, `unknown`, and `custom`; unknown or unclassified tools are represented explicitly and remain denied by default until a later policy milestone allows them.
- Extended `ewokbot mcp inspect <server-id>` so JSON output includes registry metadata while preserving inspect-only behavior and the existing human/schema output surfaces.
- Added explicit `--cache-registry` snapshot writing under `.ewokbot/cache/mcp-tools/<server-id>.json`; snapshots are sanitized and remain separate from credentials, run evidence, operation ledgers, and provider execution records.
- Added fake-only tests for Atlassian, Railway, GitHub, and custom registry data plus CLI snapshot behavior. The targeted tests initially caught a `get_deployment_status` classifier bug where the embedded `deployment` term was treated as a destructive `deploy` action; the classifier now treats explicit read prefixes as read before destructive verb matching.
- Documented the registry as support for full MCP mapping with policy-gated execution, without adding the later AW policy modes.
- Preserved AV scope only: no AW policy modes, AX/AY/AZ provider mappings, BA GitHub PR handoff, BB staging verification, BC develop PR follow-up, BD review adapter, BE operator-agent sandbox, provider tool execution or mutation, production merge/deploy, live provider/MCP/OAuth/network calls in tests, worker daemon, dashboard, Telegram, Sentry/PostHog/Notion ingestion, or autonomous production automation were added.

Verification commands run for AV:

- `lsp_diagnostics` on `src/mcp/schema-sanitizer.ts`, `src/mcp/tool-registry.ts`, `src/cli/commands/mcp.ts`, `src/index.ts`, `test/cli-mcp.test.ts`, and `test/mcp-tool-registry.test.ts` was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm typecheck`
- `pnpm build`
- Initial `node --test dist/test/mcp-tool-registry.test.js dist/test/cli-mcp.test.js` surfaced the `get_deployment_status` classifier issue described above; the classifier was corrected.
- `node --test dist/test/mcp-tool-registry.test.js dist/test/cli-mcp.test.js` (`10/10`)
- `pnpm test` (`335/335`)
- `node dist/src/cli/index.js mcp`
- `git diff --check`

Implemented Milestone AU MCP Inspect Schemas review candidate:

- Extended `ewokbot mcp inspect <server-id>` with `--schema` and `--json` while preserving the existing default human-readable output.
- Added sanitized schema rendering for MCP tool input schemas plus optional output schema and output metadata when discovery exposes them.
- Kept inspect mode read-only: tests use injected mock MCP clients only and assert discovery calls `listTools` without any `callTool` provider execution.
- Documented the command behavior and updated tracking so AV remains blocked until AU is accepted.
- Preserved AU scope only: no MCP tool registry, policy modes, Atlassian/Railway/GitHub business-port remapping, GitHub PR handoff, staging verification, provider mutation, production merge/deploy, dashboard, or live provider/MCP/OAuth/network calls were added.

Verification commands run for AU:

- `lsp_diagnostics` on `src/mcp/client.ts`, `src/cli/commands/mcp.ts`, `src/cli/program.ts`, and `test/cli-mcp.test.ts` was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm typecheck`
- `pnpm build`
- Initial `pnpm test -- test/cli-mcp.test.ts` surfaced an AU redaction bug where credential-like strings inside top-level `examples` arrays were not redacted; the sanitizer was corrected.
- `node --test dist/test/cli-mcp.test.js` (`5/5`)
- `pnpm test` (`330/330`)
- `git diff --check`

Realigned the post-AT roadmap around MCP-first provider contracts:

- Set AU to MCP Inspect Schemas as the next approved implementation milestone.
- Deferred GitHub PR Handoff v1 to BA, after MCP schema inspection, tool registry, policy modes, and real Atlassian/Railway/GitHub mappings are accepted.
- Added the approved sequence AU through BC: MCP Inspect Schemas, MCP Tool Registry, MCP Policy Modes, Atlassian MCP Real Mapping, Railway MCP Real Mapping, GitHub MCP Real Mapping, GitHub PR Handoff v1, Real Staging Verification v1, and Operator Agent Action Sandbox.
- Recorded the product direction as full MCP tool mapping with policy-gated execution, where unknown or unclassified tools are denied by default and production merge/deploy remain human-only.

## 2026-06-07

Accepted Milestone AT Real Provider Smoke v1:

- Accepted the Jira-only real-provider smoke flow after scoped preflight hardening.
- Confirmed `ewokbot smoke <ticket-key> --confirm-real-provider-smoke` requires only Jira MCP `TicketPort.getTicket` readiness plus local workspace/tool/repository/quality readiness.
- Confirmed smoke reaches local run-dev evidence only and stops at `LOCAL_CHECKS_PASSED`, `FAILED`, or `NEEDS_HUMAN`.
- Confirmed smoke does not require or contact GitHub, Railway, or Vercel; it also does not transition/comment on Jira, push branches, open PRs, write an operation ledger, verify deployments, write staging reports, merge production, or deploy production.
- At that time, AU - GitHub PR Handoff v1 was marked as the next approved implementation milestone. This was superseded on 2026-06-08 by the MCP Inspect Schemas roadmap realignment above.

Verification commands run for AT acceptance:

- `pnpm typecheck`
- `pnpm test` (`323/323`)
- `git diff --check`

Addressed AT smoke review finding for scoped preflight:

- Scoped `ewokbot smoke <ticket-key> --confirm-real-provider-smoke` doctor output to AT-local and Jira readiness so missing GitHub, Railway, or Vercel provider credentials no longer block Jira-only smoke runs.
- Preserved standalone `ewokbot doctor` provider readiness behavior and kept smoke blocking on local prerequisites plus Jira MCP `TicketPort.getTicket` readiness before side effects.
- Added regression coverage for GitHub/Railway MCP modes with missing non-AT env vars reaching `LOCAL_CHECKS_PASSED` while making zero GitHub/Railway MCP list/tool calls and creating no PR, deployment, operation ledger, staging report, or provider handoff files.
- Removed stale `smokeVerifier` wiring from the CLI smoke delivery options and smoke command tests; staging smoke verifier code remains intact for later milestones.
- Updated README and next-actions wording so AT smoke requires Jira MCP plus local readiness only and does not require GitHub/Railway/Vercel readiness.
- Preserved AT scope only: no AU GitHub PR Handoff v1, AV sandbox, staging verification, provider mutation, operation ledger, production merge/deploy, dashboard, live provider calls, or live OpenCode execution in tests were added.

Verification commands run for this AT review fix:

- `lsp_diagnostics` on `src/cli/commands/smoke.ts` and `test/smoke-command.test.ts` was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm typecheck`
- `pnpm test` (`323/323`)
- `git diff --check`

Implemented Milestone AT Real Provider Smoke v1 review candidate:

- Repurposed `ewokbot smoke <ticket-key> --confirm-real-provider-smoke` from the stale full-provider smoke path into an AT local-only flow.
- Kept the confirmation and local doctor gates before side effects, then required only Jira MCP readiness for `TicketPort.getTicket` and one explicitly selected ticket.
- Routed the smoke command through the existing local `run-dev` execution evidence path so successful runs stop at `LOCAL_CHECKS_PASSED` after local branch creation, OpenCode/dev-runner execution, meaningful-diff inspection, agent completion evaluation, core safety evaluation, local quality gates, test relevance evaluation, and final report writing.
- Preserved AT non-actions explicitly: no Jira transition/comment, no backlog listing, no git push, no GitHub PR, no Railway/Vercel call, no deployment verification, no operation ledger, no staging report, and no production merge/deploy.
- Expanded the final operator report note so it records the Jira ticket read through `TicketPort.getTicket`, the selected local repository, local branch, local actions, evidence paths, and explicit non-actions.
- Updated smoke tests to assert Jira `getTicket` only, local evidence files, `LOCAL_CHECKS_PASSED`, no provider handoff files, no GitHub/Railway tool calls, no git push, and fail-before-side-effects behavior when Jira MCP readiness is missing.
- Updated README and tracking docs to describe AT as implemented pending acceptance while keeping AU and later PR handoff, staging verification, provider mutation, and production automation blocked until explicit acceptance/approval.
- Preserved AT scope only: no AU GitHub PR Handoff v1, AV sandbox, staging verification, production merge/deploy, dashboard, Telegram/WhatsApp, Sentry/PostHog/Notion ingestion, live provider calls in tests, live OpenCode execution in tests, package-manager setup, or real home-directory mutation were added.

Verification commands run for AT:

- `lsp_diagnostics` on `src/cli/commands/smoke.ts`, `src/delivery/development-run.ts`, and `test/smoke-command.test.ts` was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `rg "requires Jira, GitHub, and Railway|opens the develop PR|verifies Railway staging|production PR preparation|Provider Modes: Jira=mcp" README.md docs/tracking/next-actions.md docs/tracking/roadmap.md src/cli/commands/smoke.ts test/smoke-command.test.ts` found only intentional negative assertions in `test/smoke-command.test.ts`.
- `pnpm run typecheck`
- Initial `pnpm test` failed `321/322` because the expanded operator-report wording removed the legacy phrase expected by the `run-dev` test; the phrase was restored while keeping the richer AT wording.
- `node --test dist/test/run-dev-command.test.js dist/test/smoke-command.test.js` (`21/21`)
- `pnpm test` (`322/322`)
- `pnpm run build`
- `git diff --check`

AT was reviewed, corrected, accepted, and committed. At that time, AU was marked as the next approved implementation milestone; this was superseded on 2026-06-08 by the MCP Inspect Schemas roadmap realignment above.

Accepted Milestone AS Harness v1:

- Accepted the local fixture harness after review fixes for realistic pathspec status and tracked-file unified diff evidence.
- Confirmed `core-safety.json` for the tracked product-change fixture records added-line evidence instead of a zero-addition false positive.
- Committed AS as `d46a756 feat(harness): add local fixture scoring`.
- AT - Real Provider Smoke v1 is now the next approved implementation milestone.

Implemented Milestone AS Harness v1 review candidate:

- Added typed local harness fixtures and parsing for tickets, repositories, fake agent behavior, and expected scoring outcomes.
- Added deterministic AS fixture assets under `fixtures/harness/`, including an AD-101 minimal Node fixture and a no-meaningful-diff regression fixture that only changes ignored agent artifacts.
- Added a local-only harness runner that copies fixture repositories into temporary workspaces, injects fake ticket, git, dev-runner, and quality seams, runs the existing `run-dev` execution path, and scores selected repository, meaningful diff, policy decision, quality result, final state, and expected report presence.
- Added `ewokbot harness run <fixture-id>` and `ewokbot harness run --all` with compact CI-readable output and pass/fail exit codes.
- Added fake-only schema, runner, CLI, sorted `--all`, source fixture immutability, and no-meaningful-diff false-positive regression tests.
- Tightened test relevance detection so `Tests run: node --test` is treated as executed test evidence, not as a `no`/`not run` report.
- Preserved AS scope only: no AT Real Provider Smoke v1, AU GitHub PR Handoff v1, AV sandbox, staging verification changes, production merge/deploy, dashboard, Telegram/WhatsApp, Sentry/PostHog/Notion ingestion, live provider calls, live MCP/OpenCode/network calls, package-manager installs, or user repository mutation were added.

Verification commands run for AS:

- `lsp_diagnostics` on modified TypeScript files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm run typecheck`
- `pnpm test` (`322/322`)
- `pnpm run build`
- `git diff --check`
- `node dist/src/cli/index.js harness run ad-101-minimal-node`
- `node dist/src/cli/index.js harness run --all`

AS was reviewed, corrected, accepted, and committed. AT is now the next approved implementation milestone.

## 2026-06-07 Earlier

Accepted Milestone AR Test Relevance Guard:

- Added a deterministic test relevance policy with `pass`, `warn`, and `needs_human` decisions from meaningful-diff evidence, the agent completion test claim, and local quality gate command results.
- Integrated AR into `ewokbot run-dev` after local quality evidence exists; it persists `.ewokbot/runs/<ticket-key>/<run-id>/test-relevance.json`, embeds the decision in quality evidence, lets `pass` and `warn` reach `LOCAL_CHECKS_PASSED`, and marks `NEEDS_HUMAN` when usable test evidence is missing for product changes.
- Surfaced test relevance in `run-dev` CLI output, `quality-report.md`, `final-report.md`, status rendering, inspect, and logs.
- Added fake-only policy and run-dev/control coverage for realistic test commands, stub/no-op weak evidence, explicit tests-not-run escalation, persisted JSON evidence, report visibility, and no provider handoff files.
- Preserved AR scope only: no AS Harness v1, AT Real Provider Smoke v1, AU GitHub PR Handoff v1, AV sandbox, staging verification, production merge/deploy, dashboard, Telegram/WhatsApp, Sentry/PostHog/Notion ingestion, live provider calls, live MCP/OpenCode/network calls, package-manager installs, or home-directory mutation were added.

Verification commands run for AR:

- `lsp_diagnostics` on modified TypeScript files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm run typecheck`
- `pnpm test` (`312/312`)
- `pnpm run build`
- `git diff --check`

Next approved implementation milestone:

- AS - Harness v1.

## 2026-06-07 Earlier

Accepted Milestone AQ Agent Completion Contract:

- Added a deterministic agent completion policy with `pass`, `needs_human`, and `fail` decisions from the final structured agent summary plus meaningful-diff evidence.
- Tightened the OpenCode implementation prompt and `run-dev` definition of done so agents must report status, changed files, tests run, known limits, blockers, and background agents.
- Integrated AQ into `ewokbot run-dev` after AO meaningful diff and before AP core safety/local quality; AQ persists `.ewokbot/runs/<ticket-key>/<run-id>/agent-completion.json`, `fail` marks `FAILED`, `needs_human` marks `NEEDS_HUMAN`, and only `pass` continues.
- Surfaced the agent completion report path and decision in CLI output, final reports, status rendering, inspect, and logs.
- Added fake-only policy, prompt, and run-dev coverage for completed summaries, exploration-only output, pending background agents, incomplete/TODO output, credential blockers, and missing meaningful product diffs.
- Preserved AQ scope only: no AR Test Relevance Guard, AS Harness v1, AT Real Provider Smoke v1, AU GitHub PR Handoff v1, AV sandbox, staging verification, production merge/deploy, live provider calls, live MCP/OpenCode/network calls, package-manager tests, or home-directory mutation were added.
- Reviewed the staged AQ implementation and accepted it after confirming the `run-dev` ordering is AO meaningful diff -> AQ agent completion -> AP core safety -> local quality, AQ `fail` and `needs_human` block before AP/quality, and CLI/report/status/inspect/log surfaces include `agent-completion.json` evidence.

Verification commands run for AQ:

- `lsp_diagnostics` on modified TypeScript files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm run typecheck`
- `pnpm test` (`305/305`)
- `pnpm run build`
- `git diff --check`

Committed AQ as `37beb11 feat(run-dev): add agent completion contract`.

Next approved implementation milestone:

- AR - Test Relevance Guard.

## 2026-06-07 Earlier

Accepted Milestone AP Core Safety Loop v1:

- Added deterministic core safety policy evidence with exact `pass`, `needs_human`, and `fail` decisions.
- Added forbidden-file detection for `.env`, `.env.*`, private keys, credential/secret/token files, and Ewokbot auth/config paths.
- Added redacted secret-like diff-addition detection that records detector metadata, file paths, and line numbers only, without persisting raw added values.
- Added changed-file and added-line limits with defaults and a test-overridable run-dev seam.
- Added human-review escalation for dependency lockfiles, database migrations, auth paths, payment/billing paths, and infrastructure/deployment configuration.
- Integrated AP into `ewokbot run-dev` after AO meaningful diff passes and before `LOCAL_CHECKS_RUNNING`; AP `fail` marks `FAILED`, AP `needs_human` marks `NEEDS_HUMAN`, both skip local quality and provider handoff files, and AP `pass` continues the existing local quality flow.
- Persisted `.ewokbot/runs/<ticket-key>/<run-id>/core-safety.json` and surfaced it in CLI output, final reports, and status rendering.
- Added fake-only unit and run-dev integration coverage for pass, forbidden-file fail, secret-like addition fail with raw-value absence assertions, diff-limit `NEEDS_HUMAN`, and human-review category `NEEDS_HUMAN`.
- Preserved AP scope only: no AQ Agent Completion Contract, AR Test Relevance Guard, AS Harness v1, AT Real Provider Smoke v1, AU GitHub PR Handoff v1, AV sandbox, staging verification, production merge/deploy, live provider calls, live MCP/OpenCode/network calls, package-manager tests, or home-directory mutation were added.

Verification commands run for AP:

- `lsp_diagnostics` on modified TypeScript files was attempted, but the environment does not have `typescript-language-server` installed; no install was performed.
- `pnpm run typecheck`
- `pnpm test` (`295/295`)
- `pnpm run build`
- `git diff --check`

Committed AP as `2d575fb feat(run-dev): add core safety loop`.

Next approved implementation milestone:

- AQ - Agent Completion Contract.

## 2026-06-07 Earlier

Accepted Milestone AO and prepared Milestone AP:

- Accepted AO Meaningful Diff Guard after Codex review of the baseline-vs-after-agent correction.
- Confirmed validation passed with `pnpm typecheck`, `pnpm test` (`284/284`), and `git diff --check`.
- Recorded the remaining non-blocking limitation as GitHub issue follow-up: the meaningful-diff delta is path-based, so future work should detect content changes in files that were already dirty before OpenCode.
- Set AP Core Safety Loop v1 as the next approved implementation milestone.

Fixed the AO review blocker for pre-existing product diffs:

- Captured a meaningful-diff baseline immediately after local branch checkout and before OpenCode execution.
- Changed the AO decision to use only files newly changed after that baseline, so pre-existing product diffs cannot make an empty OpenCode run pass.
- Persisted baseline changed files, after-agent changed files, new agent-delta files, ignored files, product files, deterministic ignore patterns, and baseline/after-agent diff summaries in `meaningful-diff.json`.
- Added fake-only regression coverage for a pre-existing product diff where OpenCode exits successfully but adds no product changes; `run-dev` now fails before quality gates in that case.
- Adjusted local-only final-report wording so early AO failures no longer imply local quality gates ran.
- Preserved AO scope only; AP forbidden-file policy, secret scanning, escalation categories, diff-size limits, PR handoff, staging, production, live providers, MCP startup, network calls, package-manager calls, and live OpenCode remain out of scope.

Verification commands run for the AO blocker fix:

- `pnpm typecheck`
- `pnpm test`
- `git diff --check`

## 2026-06-07 Earlier

Implemented Milestone AO Meaningful Diff Guard review candidate:

- Added a post-OpenCode meaningful-diff inspection to `ewokbot run-dev` before local quality gates, so successful agent execution with only ignored artifacts cannot reach `LOCAL_CHECKS_PASSED`.
- Captured changed files, ignored files, product files, deterministic ignore patterns, and diff summary under `.ewokbot/runs/<ticket-key>/<run-id>/meaningful-diff.json`.
- Ignored `.omo/`, `.ewokbot/`, log/logs files and directories, and cache directories when deciding whether a product diff exists.
- Surfaced the meaningful-diff decision in CLI output, `final-report.md`, persisted run state, and `ewokbot status` rendering.
- Added fake-only coverage for ignored-artifact-only OpenCode success, safe product diffs, porcelain parsing, ignore matching, final reports, and status output.
- Preserved AO scope only: no forbidden-file policy, secret scanning, dependency/migration/auth/payment/infra escalation, diff-size limits, GitHub PR handoff, staging verification, production merge, production deployment, live provider calls, MCP startup, network calls, package-manager calls, or OpenCode execution in tests.

Verification commands run for AO:

- `pnpm typecheck`
- `pnpm test`
- `git diff --check`

## 2026-06-06

Refined post-AN milestones after the first real local OpenCode smoke:

- Confirmed `ewokbot run-dev AD-101 --confirm-dev-execution` can invoke local OpenCode headlessly and reach `LOCAL_CHECKS_PASSED` outside the Codex filesystem sandbox.
- Found a real false positive: OpenCode exited `0` and local quality gates passed, but the target repository had no product diff and only `.omo/` appeared as an agent artifact.
- Re-scoped AO from broad Core Safety Loop v1 to Meaningful Diff Guard so the next implementation directly prevents empty-agent-success runs.
- Planned the follow-up sequence after AO: AP Core Safety Loop v1, AQ Agent Completion Contract, AR Test Relevance Guard, AS Harness v1, AT Real Provider Smoke v1, and AU GitHub PR Handoff v1.
- Kept Sentry, PostHog, Notion, support/SEO signal ingestion, Telegram/WhatsApp, dashboard, autonomous production merge, and production deployment out of scope.

Accepted Milestone AN and prepared Milestone AO:

- Marked AN Ewokbot Auth Commands as complete and accepted after Codex review and commit `58f4506`.
- Initially set AO Core Safety Loop v1 as the next approved implementation milestone.
- Defined AO around post-agent diff policy for `run-dev`: changed-file capture, forbidden-file checks, redacted secret-like diff scanning, diff-size limits, sensitive-category escalation, deterministic `pass`/`needs_human`/`fail` decisions, and a local safety report.
- Kept Sentry, PostHog, Notion, support/SEO signal ingestion, Telegram/WhatsApp, dashboard, later PR handoff, staging verification, production merge, and production deployment out of scope until explicitly approved.

Implemented Milestone AN Ewokbot Auth Commands review candidate:

- Added `ewokbot auth status`, `ewokbot auth login <provider>`, `ewokbot auth logout <provider>`, and `ewokbot auth list` for Ewokbot-owned Jira, GitHub, Railway, and Vercel auth metadata.
- Stored auth state only in the AK user-level auth file (`~/.local/share/ewokbot/auth.json` or the configured XDG data equivalent) with metadata-only provider records; workspace `.ewokbot/` auth state and raw provider secrets are not written.
- Kept OpenCode auth external: `auth login opencode` and `auth logout opencode` refuse with operator guidance to use OpenCode directly, and no OpenCode config/auth files are mutated.
- Updated doctor wording to distinguish Ewokbot auth metadata from OpenCode readiness and hardened redaction for access-token, refresh-token, client-secret, credential, and authorization-style fields.
- Added fake-only tests for empty auth state, provider login/logout, OpenCode refusal, secret-like output redaction, help text, and doctor wording; no live provider, OAuth, MCP, network, OpenCode, or package-manager flows were introduced.
- Marked AN as a review candidate only. No post-AN milestone, Telegram/dashboard/daemonization, later PR handoff, staging verification, production merge, or production deployment work was started.

Implemented Milestone AM Inquirer TUI Init review candidate:

- Added `@inquirer/prompts` and replaced the readline-style interactive init wizard with an injectable prompt adapter using guided selections, confirmations, text input, and checkbox monitor selection.
- Preserved deterministic `--non-interactive` init, fake-only tests, and injected prompt seams so test coverage does not require a real TTY.
- Surfaced AL OpenCode readiness in init: ready OpenCode can be selected without Ewokbot API-key prompts, not-authenticated/no-model states require explicit acknowledgement, and missing/failed/unsupported states offer mock mode, setup instructions, or custom command checks without installers or auth flows.
- Kept OpenCode credentials owned by OpenCode, kept generated files limited to `.ewokbot/` plus AK user-level Ewokbot paths, and refused existing `.ewokbot/workspace.yml`, `.ewokbot/.env`, or `.ewokbot/.env.example` before prompting.
- Preserved AM scope only: no AN Ewokbot auth commands, Telegram/dashboard/daemonization, live provider automation, production merge, or production deployment work was added.

Accepted Milestone AL and prepared Milestone AM:

- Marked AL Dev Tool Detection Adapters as complete and accepted after Codex review.
- Set AM Inquirer TUI Init as the next approved/current implementation milestone, backed by AK and accepted AL.
- Kept AN Ewokbot Auth Commands explicitly future-only after AM, with Telegram, dashboard, daemonization, later PR handoff, staging verification, and production automation still out of scope.

Fixed AL OpenCode readiness detection review issue:

- Updated the no-`runCommand` OpenCode detection path to still inspect global and project OpenCode config files for model/provider configuration before resolving readiness.
- Added fake-only regression tests proving command-present/no-runner detection reports `installed_ready` when auth and model config are present, reports `installed_authenticated_no_model` when auth is present without model config, and does not expose auth or model values in returned details.
- Preserved AL scope only: no live OpenCode execution in tests and no AM Inquirer TUI work.

## 2026-06-05

Implemented Milestone AL Dev Tool Detection Adapters review candidate:

- Added a typed `DevToolSetupAdapter` contract with `detect()`, `doctor()`, `launchSetup()`, and `getConfigSummary()` plus normalized readiness states for missing tools, command failures, unsupported versions, missing auth, missing model config, and ready setups.
- Added `OpenCodeSetupAdapter` for command/custom-command detection, safe version probing, global OpenCode config presence at `~/.config/opencode/opencode.json`, OpenCode auth presence at `~/.local/share/opencode/auth.json` or an injected read-only `opencode auth list` probe, and project config presence at `<workspace-root>/opencode.json`.
- Integrated OpenCode readiness into `ewokbot doctor`, init preflight, and setup capability detection while preserving mock-safe defaults and avoiding installers, auth login, package managers, OAuth, network, MCP, provider calls, and production automation.
- Stopped `ewokbot init` from asking for or writing OpenCode-owned model/provider credential variables such as OpenCode API keys or Anthropic/OpenAI keys into `.ewokbot/.env`; OpenCode credentials remain owned by OpenCode.
- Added fake-only adapter and integration tests for every AL readiness branch, custom command paths, fake OpenCode home paths, no secret output, doctor WARN/FAIL behavior, init missing-command safety, provider capability alignment, and smoke preflight isolation.
- Preserved AL scope only: no AM Inquirer TUI, no AN Ewokbot auth commands, no automatic installs, no OpenCode auth flow execution, and no production merge or deployment automation.

Focused verification run for AL:

- `pnpm run build`
- `node --test dist/test/setup/opencode-setup-adapter.test.js dist/test/setup/doctor.test.js dist/test/cli-doctor.test.js dist/test/cli-init.test.js dist/test/setup/provider-capabilities.test.js dist/test/smoke-command.test.js`

Full verification run for AL:

- `pnpm run typecheck`
- `pnpm run build`
- `pnpm test`
- `git diff --check`

Implemented Milestone AK User-Level Ewokbot Layout review candidate:

- Added typed user-level Ewokbot layout helpers for XDG-aware config, data/auth, state, and cache paths, with defaults under `~/.config/ewokbot/config.json`, `~/.local/share/ewokbot/auth.json`, `~/.local/share/ewokbot/state/`, and `~/.cache/ewokbot/`.
- Added explicit user layout creation through `ewokbot init`, including owner-only `auth.json` permissions where supported and non-overwrite behavior for existing auth metadata.
- Kept workspace-local `.ewokbot/workspace.yml`, `.ewokbot/.env`, `.ewokbot/.env.example`, `.ewokbot/runs/`, `.ewokbot/logs/`, and `.ewokbot/cache/` unchanged for workspace setup and delivery evidence.
- Extended `ewokbot doctor` to report user config, user auth, user state, and user cache readiness without reading or printing auth file contents.
- Added fake-only tests with injected home/XDG paths so no test mutates the real home directory, starts providers, starts MCP/OAuth flows, runs OpenCode, or performs network calls.
- Preserved AK scope only: no automatic secret migration, no OpenCode credential storage in Ewokbot auth, no AL dev-tool detection adapters, no AM Inquirer TUI, no AN auth commands, and no production automation.

Verification commands run for AK:

- `pnpm run typecheck`
- `pnpm run build`
- `node --test dist/test/user-layout.test.js dist/test/setup/doctor.test.js dist/test/cli-doctor.test.js dist/test/cli-init.test.js`
- `pnpm test`
- `git diff --check`

Accepted Milestone AJ and prepared Milestones AK-AN:

- Committed AJ prompt UX hardening with guided numbered choices for closed init questions and the top-level-await CLI wrapper fix.
- Marked AJ Interactive Init Wizard And Credential Setup as complete and accepted.
- Added AK User-Level Ewokbot Layout as the next approved implementation milestone.
- Added AL Dev Tool Detection Adapters, AM Inquirer TUI Init, and AN Ewokbot Auth Commands as the approved follow-up sequence after AK.
- Clarified the product direction: Ewokbot should detect and qualify external dev tools such as OpenCode instead of blindly installing or asking for model provider API keys that belong to the selected runner's own auth flow.
- Clarified the storage model: workspace-local `.ewokbot/` remains for workspace config and run evidence, while shared user-level Ewokbot config/data/auth/cache should live under XDG-style user paths.

Implemented Milestone AJ Interactive Init Wizard And Credential Setup review candidate:

- Expanded `ewokbot init` into a first-run wizard that can configure OpenCode, optional oh-my-openagent intent, model/provider environment variables, Jira MCP, GitHub MCP, Railway MCP, Vercel monitor intent, and direct sibling repository discovery while preserving deterministic mock-safe non-interactive init.
- Added init-time OpenCode command detection for real OpenCode selections; missing OpenCode prints the official install script and stops so the operator can choose mock mode or install OpenCode explicitly.
- Generated `.ewokbot/workspace.yml`, `.ewokbot/.env`, placeholder-only `.ewokbot/.env.example`, `.ewokbot/runs/`, `.ewokbot/logs/`, and `.ewokbot/cache/`, and made init refuse to overwrite any existing onboarding file by default.
- Added workspace `.env` loading before doctor, scan, plan, run-dev, worker, smoke, provider adapter construction, OpenCode runner construction, and public MCP subprocess environment resolution without mutating global `process.env`.
- Kept secret values out of init and doctor output, with tests proving injected wizard secrets remain only in `.ewokbot/.env` and MCP/OpenCode fake paths receive loaded values without leaking unlisted or secret values.
- Preserved AJ scope only: no auto-installs, non-Ewokbot config mutation, live MCP/OAuth/provider calls, OpenCode/package-manager execution during init, branch creation, PR handoff, staging verification, production merge, production deploy, Telegram, dashboard, daemonization, or autonomous production automation.

Verification commands run for AJ:

- `pnpm run typecheck`
- `pnpm run build && node --test dist/test/cli-init.test.js dist/test/runtime-mcp-client.test.js dist/test/run-dev-command.test.js`
- `pnpm run build && node --test dist/test/cli-doctor.test.js dist/test/setup/doctor.test.js dist/test/setup/provider-capabilities.test.js`
- `pnpm run build && pnpm test && git diff --check`

Accepted Milestone AI and prepared Milestone AJ:

- Marked AI Controlled Single-Repository Dev Execution as complete and accepted after review.
- Set AJ Interactive Init Wizard And Credential Setup as the next approved implementation milestone.
- Defined AJ around making `ewokbot init` produce a usable `.ewokbot/` setup for `doctor`, `scan`, `plan`, and `run-dev` without manual config surgery.
- Required wizard coverage for OpenCode, optional oh-my-openagent intent/detection, model/provider env vars, Jira MCP, GitHub MCP intent, Railway MCP intent, Vercel placeholder/mock intent, and direct sibling repository discovery.
- Required `.ewokbot/.env` loading for runtime commands while preserving secret redaction, fake-only tests, no auto-installs without explicit confirmation, no live MCP/OAuth/provider/network/OpenCode/package-manager/git side effects, and human-only production.

Implemented Milestone AI Controlled Single-Repository Dev Execution review candidate:

- Added `ewokbot run-dev <ticket-key> --confirm-dev-execution [--run-id <run-id>]` for one explicitly confirmed development-only ticket from the parent workspace.
- Reused the AH Jira ticket intake and repository planning path while requiring exactly one selected repository before state writes, branch creation, OpenCode execution, or quality gates.
- Printed the selected ticket, repository, branch, quality gates, run directory, and local-only stop boundary before delivery side effects.
- Created a local branch only in the selected repository, invoked the existing OpenCode execution contract, ran local quality gates, and persisted plan, state, implementation log, quality report, and final local-only report evidence under `.ewokbot/runs/`.
- Kept the command out of GitHub PR handoff, Railway/Vercel calls, deployment verification, operation ledgers, production merge, production deploy, Telegram, dashboard, daemonization, and autonomous production automation.
- Added fake-only tests for missing confirmation, successful local execution, zero-repository guard, multi-repository guard, and existing-run collision, including assertions that GitHub/Railway MCP clients, remote git push, provider handoffs, staging reports, and operation ledgers are not touched.

Accepted Milestone AH and prepared Milestone AI:

- Marked AH Real Workspace Dry Run as complete and accepted after review.
- Set AI Controlled Single-Repository Dev Execution as the next approved implementation milestone.
- Clarified that AI must add `ewokbot run-dev <ticket-key> --confirm-dev-execution`, reuse AH planning, require exactly one selected repository, require explicit confirmation before side effects, create only a local branch, run OpenCode through the existing execution contract, run local quality gates, and persist local implementation/quality evidence.
- Repeated AI non-goals: no GitHub PRs, Railway/Vercel calls, deployment verification, production merge, production deploy, or autonomous production automation.

Implemented Milestone AH Real Workspace Dry Run review candidate:

- Added fake-only coverage for a parent workspace containing multiple direct sibling Git repositories, proving `ewokbot doctor`, `ewokbot scan`, and `ewokbot plan <ticket-key>` operate from `.ewokbot/workspace.yml` without delivery side effects.
- Updated doctor repository discovery output so discovery mode reports the discovered sibling Git repository count and names while preserving the readable no-repository warning.
- Routed planning ticket intake through the runtime typed `TicketPort.getTicket` boundary so mock mode remains default and Jira MCP planning uses the configured fake/runtime MCP client instead of a direct mock connector.
- Hardened planning as an explicit dry run: output and `plan.md` state that no branches, OpenCode execution, package scripts, operation ledgers, GitHub, Railway/Vercel, PRs, deployment checks, production merge, or production deployment are performed.
- Verified planning evidence stays local under `.ewokbot/runs/<ticket-key>/<run-id>/` as only `plan.md` plus `state.json`, with branch, pull request, deployment, quality, and dev-run arrays empty.
- Added fail-before-write coverage for missing Jira MCP `getTicket` readiness, Jira MCP ticket-read failures, and scan coverage showing Jira MCP backlog intake does not create `.ewokbot/runs/` evidence.
- Hardened `ewokbot plan` preflight failures so config/MCP/ticket-read readiness errors return actionable stderr with exit code `1`, no stdout, and no run state or delivery side effects.
- Scoped AH planning MCP readiness to Jira `TicketPort.getTicket` only while preserving full Jira MCP requirements for scan, worker, smoke, and other runtime flows.

Prepared Milestones AH and AI:

- Added AH Real Workspace Dry Run to the approved backlog as the next milestone after AG.
- Defined AH around the real operator flow `ewokbot init`, `ewokbot doctor`, `ewokbot scan`, and `ewokbot plan <ticket-key>` from a parent multi-repository workspace, using `.ewokbot/`, sibling Git repository discovery, Jira MCP intake, and planning without delivery side effects.
- Added explicit AH non-side-effect boundaries: no git branches, OpenCode, package scripts, operation ledgers, GitHub, Railway/Vercel, PRs, deployment checks, production merge, or production deployment.
- Added AI Controlled Single-Repository Dev Execution as the planned follow-up after AH is reviewed and accepted.
- Defined AI around exactly one selected repository, explicit confirmation before side effects, OpenCode execution, local branch creation, local quality evidence, and no PR/deployment handoff until a later approved milestone.

Completed Milestone AG Workspace Layout Migration To `.ewokbot/`:

- Added shared workspace layout constants in `src/workspace-layout.ts` and exported them through `src/index.ts` so Ewokbot-owned paths resolve consistently to `.ewokbot/workspace.yml`, `.ewokbot/.env`, `.ewokbot/.env.example`, `.ewokbot/runs/`, `.ewokbot/logs/`, and `.ewokbot/cache/`.
- Updated `ewokbot init` to create only `.ewokbot/` owned files/directories and added tests asserting it does not create root `config/workspace.yml`, root `.env`, root `.env.example`, or root `runs/`.
- Corrected the generated onboarding repository config to use `repos.discovery: sibling-git-directories` so fresh `.ewokbot/workspace.yml` files watch all direct sibling Git repositories instead of generating a fake repository name or `worktrees/` layout.
- Removed the tracked root `.env.example` legacy artifact and stopped explicitly unignoring it; `.ewokbot/.env.example` remains generated by `ewokbot init` and allowed by `.gitignore`.
- Removed default CLI fallback reads for root legacy config paths: `scan`, `plan`, `run`, `worker`, and `smoke` now default to `.ewokbot/workspace.yml` while preserving explicit `configPath` overrides for tests and advanced callers.
- Moved run state, reports, quality logs, operation ledgers, run controls, status/list/log reads, and worker locks to `.ewokbot/runs/`; doctor now inspects `.ewokbot/workspace.yml`, `.ewokbot/.env.example`, and `.ewokbot/.env` while keeping repository paths relative to the workspace root.
- Updated README, technical architecture, next actions, roadmap, package file publishing list, `.gitignore`, and fake-only tests for the new layout. Targeted migration suites passed with 105 tests after `pnpm typecheck` and `pnpm build`.

Prepared Milestone AG Workspace Layout Migration To `.ewokbot/`:

- Added AG to the approved backlog as the next milestone after AF.
- Defined the product target as running `ewokbot` from the parent directory that already contains the target repositories, with Ewokbot-owned files under `.ewokbot/`.
- Made the no-legacy requirement explicit: AG must remove root `config/workspace.yml`, root `.env`, root `.env.example`, and root `runs/` defaults instead of keeping fallback support.

Completed Milestone AF Real MCP Client Runtime Wiring:

- Added a public stdio MCP runtime client adapter backed by the Model Context Protocol SDK and exposed through the repo `McpClient` interface, including safe environment allowlisting, lifecycle cleanup, tool discovery/result normalization, unsupported-transport errors, and startup errors with server context.
- Wired the public CLI entrypoint to pass a constructed `createMcpClient` factory into scan, worker, and smoke while preserving existing test injection seams and mock defaults.
- Updated `ewokbot scan` to prefer `config/workspace.yml` when present and fall back to `config/workspace.example.yml` for mock exploration.
- Hardened `ewokbot worker start` in MCP mode so runtime MCP readiness is validated before the worker lock, run state, Jira reads, git, OpenCode, PRs, Railway checks, ledger writes, or provider mutations.
- Added fake-only coverage for SDK client construction, env allowlisting, result normalization, unsupported HTTP runtime configs, startup failures, public scan runtime construction, and worker-start fail-before-lock behavior.
- Preserved production merge and production deployment as human-only, kept tests free of live MCP/OAuth/provider/network/OpenCode/git side effects, and left HTTP runtime transport support for a later approved milestone.

Prepared Milestone AF Real MCP Client Runtime Wiring:

- Added AF to the approved backlog as the next milestone after AE so the public CLI can construct real MCP clients from `config/workspace.yml` instead of relying on test-only MCP injection.
- Defined AF acceptance around fail-fast MCP runtime setup, clear operator errors, mock-safe defaults, fake-only tests, and no production merge or deployment automation.
- Updated next actions and roadmap so OpenCode can continue from the approved milestone rather than inventing post-AE work.

Resolved Milestone AE P1 acceptance blocker:

- Added a smoke-only run collision guard so `ewokbot smoke <ticket-key> --confirm-real-provider-smoke --run-id <run-id>` refuses an existing `runs/<ticket-key>/<run-id>/` directory or `state.json` after the Jira ticket read but before run-state writes, plan reports, git/OpenCode/quality work, GitHub/Railway provider calls, or operation-ledger writes.
- Added fake-only tests covering both an existing state file and an existing run directory, including evidence that the existing state is preserved and no local git, GitHub, Railway, quality, report, or ledger side effects occur.

Completed Milestone AE First Real Provider Smoke Run:

- Added `ewokbot smoke <ticket-key> --confirm-real-provider-smoke [--run-id <run-id>]` as an explicit single-ticket real-provider smoke command while preserving the existing mock `ewokbot run` behavior and its `config/workspace.example.yml` default.
- Added fail-fast smoke preflight ordering: missing confirmation stops before doctor/config/MCP/run-state/git/OpenCode/PR/deployment/ledger/provider writes; doctor FAIL checks stop before config/adapters; non-MCP Jira/GitHub/Railway modes stop before runtime adapters or side effects.
- Added a typed smoke delivery orchestration path that loads `config/workspace.yml`, validates runtime MCP readiness through `createRuntimeWorkspaceAdapters`, reads one Jira ticket through `TicketPort.getTicket` without listing backlog, requires exactly one selected repository, creates run state only after preflight, then reuses local git branch creation, OpenCode runner, local quality gates, `runDevelopPullRequestHandoff`, `runStagingVerification`, and `runProductionPullRequestPreparation`.
- Added an HTTP smoke verifier for the real command path and kept tests on `MockSmokeUrlVerifier` plus fake MCP clients, fake local git, fake quality runner, and mock OpenCode so tests make no live MCP, provider, network, package manager, provider CLI, OpenCode subprocess, remote git, production merge, or production deployment calls.
- Added operator-readable smoke output for scope, phases, provider modes, run id, reports, operation boundary, and the human-only production PR boundary.
- Preserved the operation ledger used by develop PR handoff and avoided full backlog automation, multi-repo delivery, daemonization, Telegram/WhatsApp/dashboard work, secrets, uncontracted REST fallbacks, production merge, and production deployment.

## 2026-06-04

Completed Milestone AD CLI Control Plane:

- Added `ewokbot runs`, `ewokbot inspect <run-id>`, `ewokbot pause`, `ewokbot resume <run-id>`, `ewokbot approve <run-id>`, `ewokbot reject <run-id>`, and `ewokbot logs <run-id>` as SSH-readable local control commands over persisted run state.
- Added durable sidecar control records under `runs/control.json` and `runs/<ticket-key>/<run-id>/control.json` for workspace pause state, resume intent, and local production approval/rejection decisions.
- Preserved the human-only production boundary: approval and rejection commands record local decisions only and do not merge pull requests, deploy production, call providers, run OpenCode, or push git changes.
- Added worker pause enforcement so `ewokbot worker start` exits before provider/ticket processing when the workspace is paused and re-checks pause state between continuous cycles through the existing stop hook.
- Added local-only tests for run-id resolution, run listing, inspection, pause/resume, approval/rejection, logs, CLI help, and worker pause behavior.
- Preserved mock-safe defaults and avoided Telegram/WhatsApp/dashboard scope, daemonization, live provider calls in tests, autonomous production merge, and autonomous production deployment.

Completed Milestone AC Long-Running Worker Runtime:

- Added the operator-facing `ewokbot worker start` command while preserving the legacy `ewokbot worker` path for compatibility.
- Added `--once` for one worker cycle and `--dry-run` for read-only backlog preview with no run-state writes, operation-ledger writes, provider mutations, git operations, PRs, or deployments.
- Added an atomic workspace lock at `runs/worker.lock` with owner-token release, live-worker contention errors, and stale dead-PID recovery before provider adapters are opened.
- Added a foreground runtime with continuous polling defaults, bounded `--max-cycles` support, graceful `SIGINT`/`SIGTERM` abort wiring, lock cleanup, and operator-readable startup, lock, dry-run, state reuse, summary, and human-only production boundary logs.
- Added conservative restart safety: backlog tickets with existing persisted run state are skipped instead of creating duplicate runs or repeating side effects, including `PRODUCTION_PR_OPENED` states that remain human-only.
- Added deterministic mock-only coverage for lock ownership, stale recovery, dry-run behavior, one-cycle start mode, bounded continuous cycles, abort cleanup, and restart duplicate prevention.
- Preserved mock mode as the default and avoided daemonization, hosted workers, Telegram/WhatsApp/dashboard scope, live provider calls in tests, autonomous production merge, and autonomous production deployment.

Completed Milestone AB Doctor And Local Readiness Checks:

- Expanded `ewokbot doctor` from setup-file validation into a local readiness report with PASS/WARN/FAIL checks for Node.js, pnpm, OpenCode, optional oh-my-openagent, workspace config, `.env.example`, `.env`, GitHub, Jira, Railway, Vercel, repository paths, branch settings, and quality gate presence.
- Added injectable doctor probes for environment, command availability, file reads, and file/directory existence so tests stay deterministic and do not call providers, MCP servers, package managers, git, scripts, installers, or networks.
- Added redacted secret diagnostics: doctor reports missing key names and `[redacted]` readiness, but never prints token, email, organization, URL, or secret values.
- Added static repository readiness checks for missing paths, non-directory paths, staging/production branch separation, `.agent-quality.yml` validity, and package quality scripts without executing quality commands.
- Preserved Milestone AB scope only, with no long-running worker runtime, daemonization, control approval commands, live provider calls, hosted workers, or production automation.

Fixed Milestone AA review findings:

- Replaced shared setup capability stubs with provider-specific local detection and generated-config validation for OpenCode, optional oh-my-openagent, GitHub, Jira, Railway, Vercel, and CLI control.
- Hardened `ewokbot init --deployment-monitor` parsing so invalid or missing values fail before writing setup files.
- Updated generated onboarding config to use `dev_runner.env_var_names`, matching the workspace config parser.
- Made the no-command CLI hint state-aware: fresh workspaces point to `ewokbot init`, while configured workspaces point to `ewokbot doctor`, `ewokbot worker`, and `ewokbot status`.
- Preserved Milestone AA scope only, with no live provider calls, package installs, daemonization, hosted workers, or production automation.

Completed Milestone AA Interactive CLI Onboarding For VPS Setup:

- Added the `ewok` package binary while retaining `ewokbot` and `agentic`, and updated no-command/help output to point new users to `ewokbot init`.
- Added typed setup provider capability contracts for OpenCode, optional oh-my-openagent, GitHub, Jira, Railway, Vercel, and CLI-only control, with deterministic onboarding order and secret-env metadata.
- Reworked `ewokbot init` to create mock-safe `config/workspace.yml` and `.env.example` files for Railway-only, Vercel-only, or both deployment monitor choices, while preserving a non-interactive automation path.
- Added a local-only `ewokbot doctor` skeleton that validates local config shape and required `.env.example` placeholders without provider, MCP, installer, OpenCode, or network calls.
- Added tests for aliases/help, setup hints, generated configs, placeholder safety, existing config detection, provider ordering, and doctor missing/generated config behavior.
- Preserved mock mode as the default and avoided Telegram, WhatsApp, dashboards, daemonization, systemd, pm2, Docker, hosted workers, live provider calls, global installs, production merge, and production deployment automation.

Aligned post-Z product direction:

- Defined Ewokbot's next product phase as an npm-installable CLI designed to run continuously on a VPS.
- Made CLI control the current control plane and moved Telegram, WhatsApp, and dashboards to future interfaces.
- Added Railway and Vercel as first-class deployment/CI monitoring choices for onboarding and future smoke runs.
- Added approved post-Z milestones AA-AE covering interactive onboarding, doctor checks, long-running worker runtime, CLI control commands, and the first real-provider smoke run.
- Updated README, product spec, roadmap, next actions, approved backlog, and decision log to prevent unapproved task invention.

Completed Milestone Z Railway Staging Verification:

- Hardened staging verification so Railway polling errors, missing or invalid service URLs, failed deployment statuses, and failed smoke checks persist actionable `FAILED` state and write `staging-report.md` evidence.
- Added Railway MCP precision guards for branch, commit SHA, deployment reference, staging environment, and HTTP(S) service URL validation before staging evidence is trusted.
- Added mock-only tests for Railway provider errors, missing service URLs before smoke checks, MCP deployment identity mismatches, MCP service URL validation, and production readiness blocking.
- Preserved Railway MCP-first typed `DeploymentPort` behavior, native fallback as a documented precision-gap boundary only, mock default execution, human-only production controls, and no live Railway/MCP/deployed-service calls.

Completed Milestone Y GitHub Delivery Workflow:

- Added a deterministic operation ledger with stable input hashing, completed-operation lookup, and a local JSON-backed implementation stored under each run directory for restart-safe delivery handoff idempotency.
- Added `LocalGitAdapter.pushBranch(...)` as the local git/native fallback for actual branch pushes, with fake command-runner tests and no real remote push tests.
- Reworked develop PR handoff to require passed quality gates before push or PR handoff, use `CodeHostPort` for GitHub branch metadata, PR creation, PR comments, and check reads, and use local git for actual branch push.
- Added ledger-backed idempotency coverage for branch creation, local push, pull request creation, PR comments, and check reads so reruns do not duplicate side effects when ledger state exists, including after recreating a persistent ledger instance.
- Integrated the mock end-to-end run with the new workflow while preserving mock-only providers, human-only production controls, and no live GitHub/MCP/remote git calls.

Completed Milestone X OpenCode Execution Contract:

- Hardened `OpenCodeSubprocessRunner` with an injectable subprocess executor, executable-plus-args command construction, workspace-root cwd validation, environment allowlists, timeout handling, cancellation handling, and secret-like output redaction.
- Added typed runner contract fields for command args, workspace root, timeout, environment allowlist, abort signal, attempt signal, timed-out attempts, and cancelled attempts.
- Added workspace config support for `dev_runner.args`, `dev_runner.timeout_ms`, and `dev_runner.env_var_names` while keeping mock mode and deterministic local tests as the default.
- Replaced live child-process runner tests with fake executor tests covering success, non-zero retry, cwd guardrails, env allowlisting, timeout, cancellation, and log redaction.
- Updated run-state failure summaries so failed, timed-out, and cancelled OpenCode runs remain actionable without bypassing required quality gates or production human approval.
- Avoided real OpenCode execution in tests, OpenCode MCP work, GitHub delivery workflow, Railway staging verification, remote pushes, production merges, production deployments, and credentials.

## 2026-06-04 Earlier - Milestone W

Completed Milestone W Worker MCP Mode:

- Added explicit worker runtime mode metadata so the worker distinguishes mock mode from MCP mode and reports worker, intake, and provider modes to operators.
- Wired `agentic worker` to full runtime workspace MCP readiness when Jira, GitHub, or Railway is configured with `mode: mcp`, while preserving mock mode as the default.
- Validated configured MCP clients, discovered tools, typed allowlists, and Native Fallback Contracts before queue processing begins in MCP mode.
- Preserved existing queue, concurrency cap, retry/backoff, escalation, safe stop, abort, and durable run-state behavior.
- Added mock-only tests for default mock worker output, injected `MockMcpClient` MCP mode, missing client/tool startup failures before side effects, and unsupported real provider modes.
- Avoided OpenCode execution hardening, GitHub delivery workflow, Railway staging verification, remote pushes, production merges, production deployments, credentials, and live provider/MCP calls.

## 2026-06-04 Earlier - Milestone V

Completed Milestone V Real Jira Intake:

- Added a Jira-only runtime `TicketPort` factory with `createRuntimeTicketPort(...)`, preserving mock defaults while validating Jira MCP clients, discovered tools, and typed allowlists before intake use.
- Routed `agentic scan` through the runtime `TicketPort` so explicit Jira MCP configuration can list backlog tickets with injected `MockMcpClient` tests and MCP audit capture.
- Routed worker intake through a typed `TicketPort`, fetching ticket details with `getTicket` before handing tickets to the existing mock-safe delivery path.
- Added mock-only tests for Jira MCP scan intake, empty backlog handling, missing client/tool readiness failures, typed comment audit capture, and worker list/get intake behavior.
- Preserved the no-Jira-REST boundary, mock local default, no live provider/MCP calls in tests, and human-only production merge/deployment controls.

Completed Milestone U Runtime MCP Wiring:

- Added runtime MCP provider construction through `createRuntimeWorkspaceAdapters(...)`, resolving configured MCP servers to injected clients or an injectable `createMcpClient(serverConfig)` factory.
- Exposed Jira, GitHub, and Railway MCP tool requirement metadata from adapter layers while keeping raw MCP tool names out of core delivery logic.
- Added startup readiness validation for discovered tools and typed port/action allowlists before MCP-backed adapter use.
- Wired a shared MCP audit sink through runtime-created Jira, GitHub, and Railway adapters.
- Added mock-only runtime MCP wiring tests for mock defaults, client construction, readiness failures, disallowed tools, audit capture, and GitHub `pushBranch` exclusion.
- Preserved mock mode as the default and avoided live MCP sessions, provider network calls, credentials, production merge, or production deployment automation.

Completed Milestone T Agent Worker Loop:

- Added a mock-safe `runAgentWorkerLoop(...)` delivery coordinator that queues backlog tickets, de-duplicates tickets within an invocation, respects concurrency limits, and stops on idle, max cycles, explicit stop callbacks, or abort signals.
- Added deterministic retry/backoff and escalation behavior with injectable sleep, preserving human-only production boundaries and escalating exhausted or human-gated tickets to `NEEDS_HUMAN`.
- Persisted worker attempt state and returned ticket run state through the existing run-state store so worker progress remains auditable.
- Added the public `agentic worker` CLI command with safe concurrency, retry, cycle, and polling options while keeping mock mode as the default and avoiding credentials or live provider calls.
- Added worker-loop and CLI tests for queue behavior, concurrency, retries, escalation, safe stops, durable state writes, and mock-only execution.
- Documented worker behavior in README and technical architecture, and updated tracking to mark Milestone T complete.

## 2026-06-04 Earlier - Milestone S

Completed Milestone S Native Fallback Contracts:

- Added a typed `nativeFallbackContracts` policy surface under `src/policy` with explicit MCP, native, subprocess, mock, and human-only adapter rules.
- Covered Jira MCP-first ticket actions, GitHub MCP-first PR/check/comment actions, GitHub local git push fallback, Railway MCP-first deployment reads with narrow native precision fallback, local workspace/filesystem/quality/OpenCode subprocess boundaries, and human-only production merge/deployment controls.
- Added tests for the contract matrix, disallowed adapters, undeclared operations, and Milestone S required policy surfaces without live API calls or credentials.
- Documented the fallback rules in README, MCP-first architecture, technical architecture, and quality gate specs.

## 2026-06-04 Earlier - Milestone R

Completed Milestone R Railway MCP DeploymentPort:

- Added a typed `DeploymentPort` boundary under `src/ports` and kept `RailwayConnector` compatible with that surface.
- Added `RailwayMcpDeploymentPort`, which maps read-oriented Railway MCP tools into `waitForDeployment`, `readDeployment`, and `getServiceUrl` while keeping raw tool names private to the adapter.
- Extended workspace config with Railway `mode: mcp`, optional top-level `mcp_servers`, configurable Railway MCP tool names, and MCP-mode server validation.
- Updated provider factory behavior so mock remains the default, real Railway remains fail-fast/no live adapter, and MCP Railway requires an injected `McpClient` keyed by configured server id.
- Added mock-only tests for Railway MCP deployment state, service URL lookup, audit capture, missing tools, Railway MCP config parsing, and factory selection.
- Documented that Railway MCP is read-oriented and unsupported deployment actions remain on the native/local fallback path until the next fallback-contract milestone.
- Verified the milestone with `pnpm typecheck`, `pnpm test`, and `pnpm build`.

## 2026-06-03

Created initial project specifications and OpenCode execution material:

- `README.md`
- `docs/specs/product-spec.md`
- `docs/specs/technical-architecture.md`
- `docs/specs/quality-gates.md`
- `docs/plans/mvp-plan.md`
- `docs/plans/opencode-autonomy-plan.md`
- `docs/prompts/opencode-build-orchestrator.md`
- `docs/prompts/opencode-next-step.md`
- `docs/runbooks/ticket-run.md`
- `config/workspace.example.yml`
- `.env.example`
- `.gitignore`
- `AGENTS.md`

Added roadmap controls for post-Milestone I autonomy:

- Added `docs/plans/approved-backlog.md`.
- Updated `AGENTS.md` to forbid unapproved autonomous milestones.
- Updated `docs/tracking/next-actions.md` to make Milestone J the next approved task.
- Clarified that real provider adapter work must wait until Milestones J, K, and L are complete.

Added tracking system:

- `docs/tracking/README.md`
- `docs/tracking/roadmap.md`
- `docs/tracking/decision-log.md`
- `docs/tracking/progress-log.md`
- `docs/tracking/risks-and-blockers.md`
- `docs/tracking/next-actions.md`

Resumed development directly and completed the first mock planning loop:

- Added JSON run state store and state transition helpers.
- Added mock Jira connector.
- Added repository resolver based on configured hints.
- Added Markdown plan report writer.
- Added `agentic scan`.
- Added `agentic plan <ticket-key>`.
- Added tests for state, scan, planning, and reports.
- Verified `pnpm test`: 23 passing tests.

Started quality gate implementation:

- Added `.agent-quality.yml` parser.
- Added Node package script quality detection fallback.
- Added ordered quality gate runner with stdout/stderr log capture.
- Added tests for parsing, detection, and required-gate fail-fast behavior.
- Verified `pnpm test`: 27 passing tests.

Completed Milestone E quality gates:

- Optional configured gates without commands now produce skipped warning results and logs instead of failing the run.
- Required configured gates without commands still fail configuration.
- Added deterministic `quality-report.md` output under `runs/<ticket-key>/<run-id>/`.
- Added `agentic quality <repo-path> --ticket-key <ticket-key> [--run-id <run-id>]` for local quality execution, log capture, report writing, and state persistence.
- Added tests for optional skip warnings, required configuration failure, Markdown report writing, CLI help, passing quality runs, and required-gate fail-fast behavior.
- Verified `pnpm test`: 32 passing tests.
- Verified `pnpm typecheck` and `pnpm build`.

Completed Milestone F OpenCode runner contract:

- Added typed dev runner domain models and persisted `devRuns` on run state records.
- Added state helper behavior for recording passed implementation runs at `IMPLEMENTING` and failed implementation runs at `FAILED` with actionable implementation log and exit-code context.
- Added deterministic OpenCode prompt builder covering ticket, repository, branch, quality policy, definition of done, and local/mock-only guardrails.
- Added OpenCode-compatible subprocess runner with prompt stdin, implementation log capture at `runs/<ticket-key>/<run-id>/implementation-log.md`, and retry attempt sections.
- Added stateful implementation wrapper that writes `IMPLEMENTING`, runs the typed runner, appends dev run results, and persists failed outcomes.
- Added harmless `process.execPath -e` mock-command tests for prompt rendering, runner success, runner failure, retry logging, and stateful failure persistence.

Completed Milestone G git and GitHub interfaces:

- Added deterministic working branch naming using `agent/<JIRA_KEY>-<short-slug>` with custom prefix support.
- Added a local-only git adapter with an injectable argument-array command runner; it creates/checks out local branches and never fetches, pulls, or pushes remotes.
- Added a future-shaped GitHub connector interface, deterministic mock GitHub connector, and develop PR body builder with Jira, run, branch, quality, risks, and local/mock-only details.
- Added state helpers for branch creation, pushed branch state, and develop PR creation with idempotent replacement of matching branch and PR entries.
- Added develop PR handoff flow that writes `BRANCH_CREATED`, then requires `LOCAL_CHECKS_PASSED` plus a latest passed required quality report before mock push and PR state writes.
- Added tests for branch naming, mock GitHub behavior, PR body rendering, state helpers, local git command-runner behavior, a harmless temp git repository, handoff write sequencing, and failed-quality guarding.

Completed Milestone H Railway staging verification foundation:

- Added a future-shaped Railway connector interface and deterministic `MockRailwayConnector` for local staging deployment status, service URL resolution, and failure simulation.
- Added a `SmokeUrlVerifier` contract and deterministic `MockSmokeUrlVerifier` with passed, failed, and skipped outcomes without HTTP or network calls.
- Added `runStagingVerification(...)` to require `DEVELOP_CHECKS_PASSED`, persist `STAGING_DEPLOYING`, verify mock deployment and smoke checks, then persist `STAGING_VERIFIED` or actionable `FAILED` state.
- Added staging state helpers and a production PR readiness guard that rejects anything except `STAGING_VERIFIED`.
- Added deterministic staging report rendering and `MarkdownReportWriter.writeStaging(...)` for `runs/<ticket-key>/<run-id>/staging-report.md`.
- Added workspace config parsing for repository `staging_smoke_urls`, including explicit empty arrays for skipped smoke checks.
- Added tests for mock Railway pass/fail behavior, smoke verifier pass/fail/skipped behavior, staging state write sequencing, failed deployment and smoke checks, production readiness guard, staging report output, and config parsing.


Completed Milestone I end-to-end mock run:

- Added mock-only production PR preparation with `assertProductionPullRequestReady(...)`, production PR body rendering, and `PRODUCTION_PR_OPENED` state recording.
- Added deterministic `MockOpenCodeRunner` that writes `implementation-log.md` without spawning OpenCode or making provider calls.
- Added `runEndToEndMockDelivery(...)` and public `agentic run <ticket-key>` wiring for the mock lifecycle through `PRODUCTION_PR_OPENED`.
- Added `final-report.md` rendering with ticket, run, repositories, branches, implementation, quality, develop PR, staging, production PR, final state, and human-only production approval note.
- Added tests for production PR body/state/preparation, final report output, mock OpenCode runner, CLI help, and complete CLI run artifacts.
- Verified `pnpm typecheck` and `pnpm test` during implementation.

Completed Milestone J status and resume foundation:

- Added run-state lookup helpers for explicit `runs/<ticket-key>/<run-id>/state.json` reads, per-ticket run listing, and latest-run selection by persisted `updatedAt` timestamp.
- Added deterministic `getNextActionForState(...)` guidance for every delivery lifecycle state without triggering side effects.
- Added concise status rendering that includes state, repositories, branches, PRs, quality, staging, failures, and human action.
- Added `agentic status <ticket-key> [--run-id <run-id>]` for local run inspection without provider credentials.
- Added tests for state lookup, latest-run selection, missing run errors, summary rendering, next-action coverage, CLI help, and CLI status output.
- Verified `pnpm typecheck` and `pnpm test` during implementation.

Completed Milestone K resume guard:

- Added `canResumeState(...)` and `assertStateResumable(...)` as side-effect-free policy helpers over persisted run state.
- Covered every delivery lifecycle state in the resume policy.
- Blocked automatic resume from `FAILED`, `NEEDS_HUMAN`, `SKIPPED`, `PRODUCTION_PR_OPENED`, and `DONE` with explicit error reasons.
- Documented the resume policy in README and advanced next actions to Milestone L.
- Added tests for every delivery run state and blocked-state error reasons.

Completed Milestone L multi-repo safety guard:

- Added a guard in `agentic run <ticket-key>` that stops before branch creation or implementation when planning selects multiple repositories.
- Persisted `NEEDS_HUMAN` with a clear reason that multi-repo sub-runs are not implemented yet.
- Preserved the single-repo mock run path through `PRODUCTION_PR_OPENED`.
- Documented the multi-repo guard in README and advanced next actions to Milestone M.
- Added tests for single-repo completion and multi-repo safe stop behavior.

Completed Milestone M real provider adapter design:

- Expanded workspace provider mode types from mock-only to `mock | real` while keeping mock as the default behavior.
- Added adapter factories for Jira, GitHub, Railway, and OpenCode runner boundaries.
- Added explicit credential errors for real Jira, GitHub, and Railway factory paths before any live adapter can be constructed.
- Kept real provider implementations out of scope and documented that Jira, GitHub, and Railway live adapters remain future milestones.
- Added tests for real-mode parsing, mock-default factories, credential failures, and no-live-call factory behavior.

Completed Milestone N MCP-first architecture realignment:

- Added `docs/specs/mcp-first-architecture.md`.
- Updated technical architecture to describe Agent Runtime, typed business ports, MCP layer, and native/subprocess/mock fallbacks.
- Replaced the next approved Jira REST milestone with MCP-first architecture realignment, MCP client foundation, Jira MCP TicketPort, GitHub MCP CodeHostPort, and Railway MCP DeploymentPort.
- Clarified that MCP is the preferred external SaaS control plane, while local git, filesystem, quality gates, state, reports, and production approval remain runtime-owned.

Completed Milestone O MCP client foundation:

- Added `src/mcp` shared infrastructure for MCP server config, `McpClient`, deterministic `MockMcpClient`, tool discovery, tool allowlist rules, tool call audit records, allowed tool-call execution, and timeout/auth/session error mapping.
- Exported public MCP APIs through `src/mcp/index.ts` and `src/index.ts` so future TicketPort, CodeHostPort, and DeploymentPort MCP adapters can depend on typed interfaces instead of raw tool names in delivery logic.
- Added mock-only tests for MCP config validation, discovery, missing-tool errors, allowlist enforcement, audit records, allowed tool calls, timeout/error mapping, failed-call audit capture, and no-live-call behavior.
- Kept provider factories and live Jira/GitHub/Railway/Vercel/Bitbucket integrations untouched; Milestone O adds infrastructure only.

Completed Milestone P Jira MCP TicketPort:

- Added a typed `TicketPort` boundary under `src/ports` and kept `JiraConnector` compatible with that surface.
- Added `JiraMcpTicketPort`, which maps Atlassian MCP Jira search, issue fetch, and comment capabilities into `listBacklog`, `getTicket`, and `comment` while keeping raw tool names private to the adapter.
- Extended workspace config with Jira-only `mode: mcp`, optional top-level `mcp_servers`, and an Atlassian `mcp-remote` example without repository secrets.
- Updated provider factory behavior so mock remains the default, real Jira remains fail-fast/no REST, and MCP Jira requires an injected `McpClient` keyed by configured server id.
- Added mock-only tests for backlog, ticket fetch, comments, missing MCP tools, Jira-only MCP config, factory selection, and no-live-call behavior.
- Corrected Milestone P before moving to Milestone Q by preserving MCP audit records through an optional Jira MCP audit sink, allowing configurable Jira MCP tool names with Atlassian defaults, and validating MCP-mode Jira project keys before JQL construction.
- Tightened the Milestone P Jira MCP acceptance gap by sharing project-key validation between workspace parsing and `JiraMcpTicketPort` construction, rejecting invalid keys before any MCP call while keeping valid uppercase keys like `LK`, `LK2`, and `LK_API` supported.
- Verified the validation refactor with `pnpm typecheck` and `pnpm test`.

Completed Milestone Q GitHub MCP CodeHostPort:

- Added a typed `CodeHostPort` boundary under `src/ports` and kept `GitHubConnector` compatible with that surface.
- Added `GitHubMcpCodeHostPort`, which maps MCP branch, pull-request, checks, and comment tools into the GitHub connector contract while keeping raw tool names private to the adapter.
- Extended workspace config with GitHub `mode: mcp`, optional top-level `mcp_servers`, configurable GitHub MCP tool names, and MCP-mode server validation.
- Updated provider factory behavior so mock remains the default, real GitHub remains fail-fast/no live adapter, and MCP GitHub requires an injected `McpClient` keyed by configured server id.
- Added mock-only tests for GitHub MCP branch/PR/check/comment flows, missing tools, GitHub MCP config parsing, and factory selection.
- Verified the Milestone Q implementation with `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- Corrected the Milestone Q GitHub MCP acceptance gap by removing unsafe metadata-only pushBranch support, keeping pushBranch on the native/local git fallback path, and adding default GitHub MCP tool-name coverage alongside the existing custom-name tests.
