# Plan and Blockers — 2026-06-10

Summary
- Refresh GitNexus index and re-run impact analysis for high-risk symbols (done).  `npx gitnexus analyze` completed and `runDevelopPullRequestHandoff` impact rerun returned RISK=HIGH.
- Local verification (typecheck/build/tests) in progress — running `pnpm typecheck`, `pnpm run build`, `pnpm test` to surface regressions.
- Graphify generation blocked by Python environment and missing LLM backend key (OPENAI_API_KEY / GEMINI_API_KEY). See Blockers.

Immediate next steps (owner: Hephaestus)
- Finish local verification: `pnpm typecheck`, `pnpm run build`, `pnpm test` and capture failures (high priority).
- Prepare environment for graphify: create Python virtualenv or use pipx, or set an LLM backend key (medium priority).
- After graphify is runnable, execute `graphify . --no-viz` to produce `graphify-out/graph.json` and `GRAPH_REPORT.md` (medium priority).
- Draft CI workflow (docs only) and propose `ci` npm script for reproducible developer checks (medium priority) — see docs/dev/ci-proposal.md.

Blockers
- Graphify: Python install error (externally-managed-environment) and missing LLM API key. Operator action: choose to (A) provide an LLM API key in CI/dev environment or (B) run graphify locally with pipx/virtualenv and pass a backend flag.
- lsp_diagnostics: system lacks `typescript-language-server`. This is advisory only; `pnpm typecheck` runs without it, but IDE diagnostics are limited.

Artifacts produced in this pass
- GitNexus index refreshed (local). Impact re-run produced a HIGH risk for `runDevelopPullRequestHandoff` (see gitnexus logs).
- Tracking todos recorded in the workspace via the todowrite tool.

Acceptance criteria for next milestone
- All verification commands (typecheck / build / tests) run green or documented failures with remediation todos.
- Graphify output exists (graphify-out/graph.json) or a documented operator decision to skip semantic extraction due to LLM key constraints.
- CI proposal documented in `docs/dev/ci-proposal.md` and added to next-actions for review.
