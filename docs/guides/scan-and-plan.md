# Scan And Inspect Tickets

Use scan commands to read work items through the TicketPort boundary.

## Commands

```bash
pnpm ewokbot scan
pnpm ewokbot scan jql "project = DEMO ORDER BY priority DESC"
pnpm ewokbot scan epic DEMO-100
pnpm ewokbot scan ticket DEMO-123
pnpm ewokbot plan DEMO-123
```

## What Scan Does

Scan reads backlog, JQL, epic, or ticket data through configured ticket providers. In mock mode, results are local/fake. In MCP mode, Jira reads use typed TicketPort operations backed by approved Atlassian MCP tools.

## Ticket Inspection

`scan ticket` reads one issue and shows relevant fields for planning. It should not modify Jira. Jira comments are a separate write capability and require non-read-only policy.

## Plan

`plan` prepares a local delivery plan for a ticket. Treat it as planning/evidence, not execution.

## Boundaries

Scan and plan do not:

- Run OpenCode.
- Modify source code.
- Create branches or PRs.
- Deploy anything.
- Merge anything.

For Jira MCP mapping, see [Atlassian MCP Tools](../reference/atlassian-mcp-tools.md).
