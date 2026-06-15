# Railway Mapping

Railway support is for staging evidence and deployment mapping. It is not autonomous Railway deployment control.

## Workspace Mapping

Repository config can map a repo to Railway staging identifiers:

```yaml
repos:
  - name: api
    local_path: ../api
    staging_smoke_urls:
      - https://example-staging.up.railway.app/health
    deployments:
      staging:
        provider: railway
        project_id: prj_...
        environment_id: env_...
        service_id: svc_...
        verification: railway_mcp
```

Verification modes include `railway_mcp`, `http_smoke`, `github_only`, and `none`.

## What Ewokbot Reads

Railway evidence can include environment status, deployments, services, service config, logs, metrics, and configured smoke URLs.

## What Ewokbot Does Not Do

Ewokbot does not autonomously call Railway tools for:

- Deploy.
- Rollback.
- Scale.
- Variable mutation.
- Source mutation.
- Domain generation.
- Resource creation.

For provider mapping, see [Railway MCP Tools](../reference/railway-mcp-tools.md).
