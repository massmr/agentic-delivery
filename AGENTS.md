# Agent Instructions

This repository is built by autonomous coding agents.

## Mission

Implement Agentic Delivery: a TypeScript/Node.js CLI orchestrator that turns Jira backlog items into verified GitHub pull requests, using OpenCode as the development runner and Railway as the staging/production deployment surface.

## Primary Workflow

Before coding, read:

1. `README.md`
2. `docs/specs/product-spec.md`
3. `docs/specs/technical-architecture.md`
4. `docs/plans/mvp-plan.md`
5. `docs/plans/approved-backlog.md`
6. `docs/specs/mcp-first-architecture.md`
7. `docs/specs/quality-gates.md`
8. `docs/prompts/opencode-build-orchestrator.md`
9. `docs/tracking/README.md`
10. `docs/tracking/next-actions.md`

Then implement only the current approved milestone from `docs/tracking/next-actions.md` or `docs/plans/approved-backlog.md`.

## Autonomy Rules

You may:

- Create and modify files.
- Add tests.
- Add package dependencies when justified.
- Run local checks.
- Refactor code you introduce.
- Update documentation when behavior changes.

You must:

- Only implement tasks listed in `docs/tracking/next-actions.md` or `docs/plans/approved-backlog.md`.
- If useful work is not listed, add it as a proposal in `docs/tracking/next-actions.md` and stop before implementing it.
- Keep secrets out of the repository.
- Preserve production approval as a human-only gate.
- Persist run state after major transitions.
- Prefer typed interfaces and small modules.
- Add tests for core logic.
- Keep commands documented in `package.json`.
- Stop and report clearly when credentials are required.

You must not:

- Invent or implement unapproved milestones.
- Add hidden network calls in tests.
- Merge to production.
- Hard-code private workspace credentials.
- Treat mocks as real provider integrations.
- Skip quality gates silently.

## Completion Standard

For every implementation pass:

- TypeScript compiles.
- Tests pass.
- Lint passes when configured.
- README or docs are updated if commands or behavior change.
- `docs/tracking/progress-log.md` is updated.
- `docs/tracking/next-actions.md` is updated.
- `docs/tracking/roadmap.md` is updated when milestone status changes.
- The final response summarizes changed files, commands run, and remaining risks.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **ewokbot** (4947 symbols, 10669 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/ewokbot/context` | Codebase overview, check index freshness |
| `gitnexus://repo/ewokbot/clusters` | All functional areas |
| `gitnexus://repo/ewokbot/processes` | All execution flows |
| `gitnexus://repo/ewokbot/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
