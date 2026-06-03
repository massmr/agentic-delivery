# Next Actions

## Immediate

1. Implement Milestone L from `docs/plans/approved-backlog.md`: multi-repo safety guard.
2. Do not start real provider adapter work until Milestone L is complete.
3. Keep production merge human-only and keep credentials out of repository files and tests.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone K

Completed through Milestone K. The resume guard policy exposes `canResumeState(state)` and `assertStateResumable(state)`, covers every delivery lifecycle state, and blocks automatic resume from `FAILED`, `NEEDS_HUMAN`, `SKIPPED`, `PRODUCTION_PR_OPENED`, and `DONE` without triggering side effects.

Next approved work:

1. Milestone L: Multi-Repo Safety Guard
2. Milestone M: Real Provider Adapter Design
3. Milestone N: Real Jira Adapter, only after Milestone M is complete

Any other task must be proposed here first and must not be implemented until approved.
