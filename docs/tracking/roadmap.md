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

## Optional Dashboard

- `[ ]` Run list
- `[ ]` Ticket status view
- `[ ]` PR/deployment view
- `[ ]` Human approval queue
