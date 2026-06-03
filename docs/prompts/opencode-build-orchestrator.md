# OpenCode Prompt: Build Agentic Delivery Orchestrator

You are implementing Agentic Delivery, a TypeScript/Node.js CLI orchestrator for autonomous software delivery.

## Mission

Build a standalone software product that orchestrates Jira backlog execution across GitHub repositories, delegates implementation to OpenCode, runs quality gates, verifies Railway staging, and opens production pull requests for human approval.

## Non-Negotiable Requirements

- Use TypeScript and Node.js.
- Keep the architecture modular.
- Implement CLI-first.
- Persist run state after each major transition.
- Make runs resumable.
- Treat Jira as the source of truth for tickets.
- Treat GitHub as the source of truth for PRs and checks.
- Treat Railway as the deployment verifier for `develop` and `main`.
- Do not merge to production automatically.
- Do not push work if required local quality gates fail.
- Keep secrets out of the repository.
- Favor explicit interfaces over hard-coded provider logic.
- Write tests for core state machine, config parsing, and quality gates.

## Core Documents

Read these first:

- `docs/specs/product-spec.md`
- `docs/specs/technical-architecture.md`
- `docs/plans/mvp-plan.md`
- `docs/specs/quality-gates.md`
- `config/workspace.example.yml`

## Initial Implementation Target

Implement Milestones 1 and 2 from `docs/plans/mvp-plan.md`.

Required outcomes:

- TypeScript project setup.
- CLI entrypoint.
- Config loader.
- Domain models.
- State store.
- Markdown report writer.
- Mock Jira connector.
- `agentic init`.
- `agentic scan`.
- `agentic plan <ticket>`.
- Unit tests for config/state/planning basics.

## Suggested Commands

```bash
pnpm install
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

If `pnpm` is not available, use `npm` and document the decision.

## Definition Of Done

- The CLI can be run locally.
- Tests pass.
- TypeScript compiles.
- README explains how to run the MVP.
- No real credentials are required for mock mode.
- The code is ready for real Jira/GitHub/Railway adapters in later milestones.

## Style

- Clean code.
- Small modules.
- Typed boundaries.
- Minimal dependencies.
- Clear error messages.
- No hidden network calls in tests.
