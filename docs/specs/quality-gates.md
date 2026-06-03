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

## Future Guards

- Secret scanning.
- Dependency audit.
- Coverage threshold.
- Browser smoke tests.
- API contract tests.
- Database migration checks.
- Bundle size regression checks.
