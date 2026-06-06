# Roadmap

Status legend:

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done
- `[!]` Blocked

## Foundation

- `[x]` Specifications and execution plans
- `[x]` TypeScript/Node project setup
- `[x]` CLI entrypoint
- `[x]` Test runner
- `[x]` Build and typecheck commands

## Core

- `[x]` Config loader and validation
- `[x]` Domain models
- `[x]` State machine
- `[x]` Local state store
- `[x]` Run status command
- `[x]` Run listing and latest-run selection
- `[x]` Deterministic next-action guidance
- `[x]` Resume guard policy
- `[x]` Provider mode and adapter factory design
- `[x]` MCP-first business port architecture
- `[x]` MCP client foundation
- `[x]` Runtime MCP wiring
- `[x]` Real MCP client runtime construction
- `[x]` Jira MCP TicketPort
- `[x]` Native fallback contracts
- `[x]` Operation ledger
- `[x]` Markdown report writer

## Planning

- `[x]` Jira connector interface
- `[x]` TicketPort boundary
- `[x]` Mock Jira connector
- `[x]` MCP Jira ticket adapter
- `[x]` Backlog scan command
- `[x]` Real Jira MCP intake
- `[x]` Ticket planning command
- `[x]` Repository resolver
- `[x]` Multi-repo safety guard

## Delivery

- `[x]` Git adapter
- `[x]` GitHub connector interface
- `[x]` Branch creation flow
- `[x]` PR body generator
- `[x]` Mock GitHub connector
- `[x]` GitHub MCP CodeHostPort
- `[x]` Local git push fallback
- `[x]` GitHub delivery workflow

## Development Runner

- `[x]` OpenCode prompt builder
- `[x]` OpenCode subprocess runner
- `[x]` OpenCode execution contract
- `[x]` Log capture
- `[x]` Retry policy

## Quality

- `[x]` Quality config parser
- `[x]` Quality profile fallback
- `[x]` Quality command runner
- `[x]` Quality reports
- `[x]` Local quality CLI command

## Staging And Production

- `[x]` Railway connector interface
- `[x]` Railway MCP DeploymentPort
- `[x]` Staging deployment polling
- `[x]` Railway staging verification hardening
- `[x]` Smoke checks
- `[x]` Production PR gate
- `[x]` End-to-end mock run command
- `[x]` Final report for completed mock runs

## Autonomous Worker

- `[x]` Ticket queue
- `[x]` Worker loop
- `[x]` Concurrency limits
- `[x]` Retry and escalation policy
- `[x]` Worker MCP mode

## Productized CLI And VPS Runtime

- `[x]` npm-installable CLI experience with `ewokbot` and `ewok` binaries
- `[x]` `.ewokbot/` workspace-local config, state, logs, and cache layout
- `[x]` Interactive first-run onboarding
- `[x]` Provider capability setup model
- `[x]` OpenCode setup detection
- `[x]` oh-my-openagent optional setup detection
- `[~]` GitHub setup prompts
- `[~]` Jira setup prompts
- `[x]` Railway setup prompts
- `[x]` Vercel setup prompts
- `[x]` Secret placeholder and redaction policy for onboarding
- `[x]` `ewokbot doctor` readiness command
- `[x]` VPS-oriented worker start command
- `[x]` Worker lock and graceful shutdown
- `[x]` CLI run inspection and approval commands
- `[x]` Explicit first real-provider smoke run command
- `[x]` Public CLI real MCP client wiring for smoke/scan/worker
- `[x]` Real workspace dry run for discovery, Jira MCP intake, and planning without delivery side effects
- `[x]` Controlled single-repository dev execution
- `[x]` Interactive init wizard and credential setup
- `[x]` User-level Ewokbot config/data/auth/cache layout
- `[x]` Dev tool detection adapters, starting with OpenCode
- `[x]` Inquirer TUI init
- `[x]` Ewokbot auth commands separated from OpenCode auth
- `[x]` Meaningful diff guard for post-agent false positives
- `[ ]` Core safety loop for post-agent diff policy
- `[ ]` Agent completion contract
- `[ ]` Test relevance guard
- `[ ]` Harness v1 for fixture-based scoring
- `[ ]` Real provider smoke v1 with Jira MCP and local run-dev
- `[ ]` GitHub draft PR handoff after validated local evidence
- `[ ]` Operator agent action sandbox for conversational control without raw shell/MCP access

## Future Control Surfaces

- `[ ]` Telegram control plane
- `[ ]` WhatsApp control plane
- `[ ]` Web or mobile dashboard

## Optional Dashboard

- `[ ]` Run list
- `[ ]` Ticket status view
- `[ ]` PR/deployment view
- `[ ]` Human approval queue
