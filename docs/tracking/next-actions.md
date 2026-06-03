# Next Actions

## Immediate

1. Implement Milestone P from `docs/plans/approved-backlog.md`: Jira MCP TicketPort.
2. Use the shared MCP client foundation from Milestone O and mock MCP clients in tests.
3. Keep production merge human-only and keep credentials out of repository files and tests.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone M

Completed through Milestone O. Workspace config supports `mock` and `real` provider modes, adapter factories keep mock connectors as the default, real Jira/GitHub/Railway factories fail fast before live adapters are implemented, and shared MCP client infrastructure now exists without live provider calls.

Architecture direction changed after review and Milestone N is complete: external SaaS integrations are MCP-first, with native/subprocess/mock adapters kept as fallbacks behind typed business ports. Do not implement Jira REST as the next milestone.

Next approved work:

1. Milestone P: Jira MCP TicketPort
2. Milestone Q: GitHub MCP CodeHostPort
3. Milestone R: Railway MCP DeploymentPort
4. Milestone S: Native Fallback Contracts
5. Milestone T: Agent Worker Loop

Any other task must be proposed here first and must not be implemented until approved.
