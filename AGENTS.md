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
5. `docs/specs/quality-gates.md`
6. `docs/prompts/opencode-build-orchestrator.md`
7. `docs/tracking/README.md`
8. `docs/tracking/next-actions.md`

Then implement the current milestone from `docs/plans/opencode-autonomy-plan.md`.

## Autonomy Rules

You may:

- Create and modify files.
- Add tests.
- Add package dependencies when justified.
- Run local checks.
- Refactor code you introduce.
- Update documentation when behavior changes.

You must:

- Keep secrets out of the repository.
- Preserve production approval as a human-only gate.
- Persist run state after major transitions.
- Prefer typed interfaces and small modules.
- Add tests for core logic.
- Keep commands documented in `package.json`.
- Stop and report clearly when credentials are required.

You must not:

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
