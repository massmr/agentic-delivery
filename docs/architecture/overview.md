# Architecture Overview

Ewokbot is a Node.js/TypeScript CLI runtime for supervised agentic delivery.

## Flow

```text
Jira ticket -> repo selection -> OpenCode local run -> quality evidence -> GitHub develop handoff -> Railway staging evidence -> human production decision
```

Production merge and deployment remain human-only.

## Main Boundaries

| Boundary | Role |
| --- | --- |
| CLI program | Parses commands and routes to runtime services. |
| Workspace config | Defines providers, repos, quality, MCP policy, and delivery defaults. |
| TicketPort | Jira/Atlassian work item access. |
| CodeHostPort | GitHub branch/PR/comment/check handoff. |
| DeploymentPort | Railway staging evidence and smoke URLs. |
| DevRunnerPort | OpenCode subprocess execution. |
| Quality gates | Local verification and safety checks before handoff. |
| Run store | Persisted transitions, reports, logs, approvals, pauses. |

## MCP-first Provider Access

Provider access is MCP-first where real SaaS behavior is needed. MCP tools are wrapped by typed ports and policy decisions; raw tool names should not leak into product flows.

## Local-native Work

Local git, filesystem, quality commands, run state, and OpenCode subprocess execution are native runtime boundaries because Ewokbot owns those local decisions.

## Deep Architecture Docs

- [Technical Architecture](../specs/technical-architecture.md)
- [MCP-first Architecture](../specs/mcp-first-architecture.md)
- [Quality Gates](../specs/quality-gates.md)
- [Documentation Architecture](documentation-architecture.md)
