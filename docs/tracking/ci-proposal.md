CI proposal (draft)

Summary
-------

This is a draft proposal for a lightweight CI workflow suitable for the repository. It is intentionally conservative: no secrets, no live provider credentials, and no LLM API keys are used by default.

Workflow outline
----------------

- Trigger: push and pull_request on main and develop branches (adjustable by reviewers).
- Steps:
  1. actions/checkout
  2. Setup Node.js 20.x
  3. Cache pnpm store + node_modules
  4. pnpm install --frozen-lockfile
  5. pnpm build
  6. pnpm typecheck
  7. pnpm test

- Optional artifact step (disabled by default): run graphify update . --no-cluster when the environment variable GRAPHIFY=true. If GRAPHIFY=true, upload graphify-out/ as a workflow artifact for reviewers.

Safety constraints
------------------

- The workflow MUST NOT require secrets to run (no provider tokens). Any step that needs credentials must be gated and require explicit reviewer action before enabling (for example: enabling GRAPHIFY to produce artifacts that may include semantic labels driven by LLMs requires an operator-provided key and policy approval).
- Do not run any step that performs network effects against production services (no git push, no provider map, no deployments).

Next steps
----------

1. Reviewers: please accept or refine this draft in the tracking docs. After acceptance create a topic branch and add `.github/workflows/ci.yml` implementing the safe steps above. Keep GRAPHIFY disabled by default and document how to enable it in a reviewer-only run.
2. If maintainers want a CI artifact for the graph, require an explicit protected-run flag and a documented operator procedure to supply the LLM/graphify key.

Notes
-----
This proposal is intentionally conservative and intended for early-stage repositories where secrets and live provider calls must never be enabled by default. The optional graphify artifact generation is provided as an auditor convenience and must be opt-in and protected.
