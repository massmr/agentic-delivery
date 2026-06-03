# Next Actions

## Immediate

1. Implement Milestone N from `docs/plans/approved-backlog.md`: real Jira adapter.
2. Do not start real GitHub or Railway adapter implementation until their approved milestones are reached.
3. Keep production merge human-only and keep credentials out of repository files and tests.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone M

Completed through Milestone M. Workspace config now supports `mock` and `real` provider modes, adapter factories keep mock connectors as the default, and real Jira/GitHub/Railway factories fail fast with explicit credential errors before live adapters are implemented.

Next approved work:

1. Milestone N: Real Jira Adapter
2. Milestone O: Real GitHub Adapter
3. Milestone P: Real Railway Adapter

Any other task must be proposed here first and must not be implemented until approved.
