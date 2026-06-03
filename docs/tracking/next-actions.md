# Next Actions

## Immediate

1. Start Milestone I: production PR gate interface and mock-only production PR preparation.
2. Reuse the Milestone H `assertProductionPullRequestReady(...)` guard before any production PR preparation helper.
3. Keep production merge human-only and do not add provider credentials or real GitHub/Railway calls.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone A

Completed through Milestone H. Start Milestone I with production PR preparation interfaces while preserving local/mock-only behavior and human-only production merge approval.
