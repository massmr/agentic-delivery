# Next Actions

## Immediate

1. Milestones AA, AB, AC, AD, and AE from `docs/plans/approved-backlog.md` are complete.
2. The next approved product direction remains the npm-installable CLI and VPS runtime path.
3. There is no later implementation milestone currently approved after Milestone AE.
4. Do not implement later worker daemon, Telegram, dashboard, or production automation work until those milestones are explicitly approved.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone AE

Completed through Milestone AE. Workspace config supports `mock`, `real`, and selected `mcp` provider modes, adapter factories keep mock connectors as the default, real Jira/GitHub/Railway factories fail fast before live adapters are implemented, shared MCP client infrastructure exists without live provider calls, Jira, GitHub, and Railway MCP operations now have typed ports with audit capture and configurable tool names where applicable, native fallback contracts explicitly define when MCP, native, subprocess, mock, and human-only surfaces are allowed, the mock-safe agent worker loop can process queued backlog tickets with concurrency, retry/backoff, escalation, durable state updates, and safe stop limits, runtime MCP wiring can resolve configured MCP servers to injected or constructed clients, Jira intake for `agentic scan` and worker backlog processing can use a runtime-injected Jira MCP `TicketPort` while preserving the mock default, `agentic worker` can start in explicit MCP mode with injected runtime clients after validating Jira/GitHub/Railway tool readiness and fallback contracts before queue processing, OpenCode execution now has a typed subprocess-first contract with safe command arguments, workspace cwd validation, environment allowlists, timeout/cancellation handling, sanitized logs, fake-executor tests, and actionable run-state/report summaries, GitHub develop handoff now uses `CodeHostPort` for branch metadata, PR creation, comments, and checks while keeping actual branch push on local git/native fallback with persistent operation-ledger idempotency under the run directory, Railway staging verification now validates MCP deployment precision, service URL evidence, deployment status, and smoke checks before allowing production PR preparation, CLI onboarding exposes `ewokbot`, `ewok`, and `agentic` aliases, generates mock-safe setup files, records Railway/Vercel monitor choices, writes secret placeholders only, and `ewokbot doctor` now reports local PASS/WARN/FAIL readiness for tools, config, `.env`, provider keys, repository paths, branch settings, and static quality gates without live calls.

Milestone AC added `ewokbot worker start`, `--once`, `--dry-run`, foreground continuous polling, workspace locking, graceful shutdown, operator-readable logs, and conservative restart state reuse that avoids duplicate side effects.

Milestone AD added local CLI control commands: `ewokbot runs`, `ewokbot inspect <run-id>`, `ewokbot pause`, `ewokbot resume <run-id>`, `ewokbot approve <run-id>`, `ewokbot reject <run-id>`, and `ewokbot logs <run-id>`. These commands operate on persisted state and sidecar control files under `runs/`, and approval commands record local human decisions only without merging or deploying production.

Milestone AE added `ewokbot smoke <ticket-key> --confirm-real-provider-smoke [--run-id <run-id>]` for one explicitly confirmed real-provider smoke path. The command loads `config/workspace.yml`, fails missing confirmation before any doctor/config/MCP/state/git/OpenCode/PR/deployment/ledger/provider side effects, runs local doctor before effects, requires Jira/GitHub/Railway `mcp` provider modes, validates runtime MCP readiness, reads exactly one Jira ticket through `TicketPort.getTicket`, refuses an existing `runs/<ticket-key>/<run-id>/` directory or `state.json` before delivery side effects, requires exactly one selected repository, then proceeds through local git, OpenCode, local quality gates, develop PR handoff with the existing operation ledger, staging verification, and production PR preparation only. It does not list the full backlog, implement multi-repo autonomy, merge production, or deploy production.

Architecture direction changed after review and Milestone N is complete: external SaaS integrations are MCP-first, with native/subprocess/mock adapters kept as fallbacks behind typed business ports. Do not implement Jira REST as the next milestone.

Next approved work: none after Milestone AE. Any next milestone must be proposed and approved before implementation.

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

Non-goals for the immediate next milestone:

- Telegram or WhatsApp control.
- Web dashboard.
- Daemonization through systemd, pm2, Docker, or hosted workers.
- Live provider calls during tests.
- Automatic global installs without explicit user confirmation.
- Autonomous production merge or production deployment.
