# Quality Gates

## Goal

Quality gates prevent autonomous agents from pushing unverified work. They are repository-specific but centrally orchestrated.

## Repository-Level Config

Each target repository may define:

```yaml
commands:
  install: pnpm install --frozen-lockfile
  lint: pnpm lint
  typecheck: pnpm typecheck
  test: pnpm test
  build: pnpm build

required:
  - install
  - lint
  - typecheck
  - test
  - build

optional:
  - format
  - coverage
  - secret_scan

staging:
  smoke_urls:
    - /
    - /health
```

## Default Node Profile

If no repository config exists, detect package manager by lockfile:

- `pnpm-lock.yaml` -> `pnpm`
- `yarn.lock` -> `yarn`
- `package-lock.json` -> `npm`

Default commands:

```yaml
pnpm:
  install: pnpm install --frozen-lockfile
  lint: pnpm lint
  typecheck: pnpm typecheck
  test: pnpm test
  build: pnpm build

npm:
  install: npm ci
  lint: npm run lint
  typecheck: npm run typecheck
  test: npm test
  build: npm run build
```

Missing scripts should be handled by policy:

- Required script missing: fail unless the profile marks it optional.
- Optional script missing: skip with warning.

## Required Report Fields

For each gate:

- name
- command
- working directory
- started at
- finished at
- duration
- exit code
- stdout log path
- stderr log path
- status

## Push Policy

The orchestrator must not push code or open a PR if any required quality gate fails.

OpenCode may be retried after failed gates. The default retry limit is 2 attempts.

OpenCode execution itself is a guarded subprocess contract. Normal non-zero OpenCode exits may retry within the configured attempt limit, but timeouts and cancellations stop further OpenCode attempts safely and persist failed run state for operator review. A successful OpenCode run still must be followed by required quality gates before any local git push or GitHub handoff can occur.

Quality gates are a subprocess/native boundary, not an MCP provider boundary. The `QualityGateRunner.runRequiredGates` fallback contract allows local subprocess execution and deterministic mock tests only. Required gates must complete and write local reports before any local git push or GitHub PR handoff can proceed.

## Future Guards

- Secret scanning.
- Dependency audit.
- Coverage threshold.
- Browser smoke tests.
- API contract tests.
- Database migration checks.
- Bundle size regression checks.
