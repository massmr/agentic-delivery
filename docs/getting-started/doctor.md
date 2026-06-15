# Doctor

`ewokbot doctor` validates local setup and reports readiness without live provider side effects.

## Command

```bash
pnpm ewokbot doctor
```

## What It Checks

Doctor checks local prerequisites and workspace consistency, including:

- Workspace files.
- Local configuration shape.
- Secret redaction in output.
- OpenCode setup detection.
- Provider mode configuration.
- Repository and quality configuration that can be checked locally.

## What It Does Not Do

Doctor does not:

- Call live Jira, GitHub, Railway, or Vercel APIs.
- Invoke MCP provider tools.
- Run OpenCode.
- Fetch, pull, push, merge, or deploy.
- Run package scripts or mutate provider state.

## Output Use

Use doctor before `run-dev` or `smoke` to catch local setup problems early. Treat provider-specific failures as setup work, not proof that the delivery runtime has called a provider.

For auth metadata, see [Auth Metadata](auth.md).
