# Next Actions

## Immediate

1. Implement Milestone M from `docs/plans/approved-backlog.md`: real provider adapter design.
2. Do not start real Jira, GitHub, or Railway adapter implementation until Milestone M is complete.
3. Keep production merge human-only and keep credentials out of repository files and tests.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone L

Completed through Milestone L. The public `agentic run <ticket-key>` command now fails safely when mock planning selects multiple repositories: it persists `NEEDS_HUMAN`, writes the plan report, does not branch or implement, and reports that multi-repo sub-runs are not implemented yet.

Next approved work:

1. Milestone M: Real Provider Adapter Design
2. Milestone N: Real Jira Adapter, only after Milestone M is complete
3. Milestone O: Real GitHub Adapter, only after Milestone M is complete

Any other task must be proposed here first and must not be implemented until approved.
