# Next Actions

## Immediate

1. Start the next integration milestone by designing real provider adapter boundaries behind the existing mock Jira, GitHub, Railway, and OpenCode interfaces.
2. Add resume/status behavior for existing `runs/<ticket-key>/<run-id>/state.json` records before introducing any real provider calls.
3. Keep production merge human-only and keep credentials out of repository files and tests.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone I

Completed through Milestone I. The public `agentic run <ticket-key>` command is mock-only and reaches `PRODUCTION_PR_OPENED` with a complete local run folder. Next work should add resumability/status and real adapter planning without claiming live Jira/GitHub/Railway/OpenCode integrations.
