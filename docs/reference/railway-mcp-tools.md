# Railway MCP Tool Reference

This document records the inspected Railway MCP server surface that Ewokbot should use for Milestone AY.

Source:

- Server: `railway`
- Transport: `stdio`
- Command: `railway mcp`
- Discovered tools: 36
- Registry entries: 36
- Inspected policy mode: `read_only`
- Inspection mode only listed MCP tools; no MCP tool was called.
- Input schemas were captured with `ewokbot mcp inspect railway --schema`.

## AY Railway Mapping

AY should stop guessing Railway MCP tool names and map Ewokbot's deployment/staging inspection intents to the inspected tools below.

| Ewokbot intent | Railway MCP tool | Inspected policy | Expectation |
| --- | --- | --- | --- |
| Railway auth readiness | `whoami` | deny, unclassified | Do not rely on allowlisted use until classified; useful as a future readiness target. |
| Environment deployment overview | `environment_status` | allow | Read service deployment status across an environment. |
| Recent deployments | `list_deployments` | allow | Find deployment IDs, status, timestamps, and commit hashes. |
| Project discovery | `list_projects` | allow | List available projects by workspace. |
| Service discovery | `list_services` | allow | List services in a project or linked project. |
| Service configuration summary | `get_service_config` | allow | Read source/build/start configuration and variable count, not variable values. |
| Logs | `get_logs` | allow | Read build, deploy, or HTTP logs for diagnostics. |
| Metrics | `service_metrics` | allow | Read CPU/memory or other service metrics. |
| HTTP error rate | `http_error_rate` | deny, unclassified | Keep denied until classifier explicitly marks safe read-only. |
| HTTP request counts | `http_requests` | deny, unclassified | Keep denied until classifier explicitly marks safe read-only. |
| HTTP latency | `http_response_time` | deny | Keep denied until classifier explicitly marks safe read-only. |
| Variable names/values | `list_variables` | deny, secret-sensitive | Deny or allow redacted only; never print raw values. |
| Deploy | `deploy` | deny, destructive | Deny by default; future explicit human approval only. |
| Environment variables write | `set_variables` | deny, secret-sensitive | Deny by default. |
| Reference variable write | `add_reference_variable` | deny, secret-sensitive | Deny by default. |
| Domain generation | `generate_domain` | deny, destructive | Deny by default unless explicitly approved. |
| Service/source mutation | `connect_service_source`, `disconnect_service_source`, `update_service`, `scale_service` | mixed | Treat as denied by Ewokbot delivery policy unless explicitly approved. |
| Resource creation/removal | `create_*`, `remove_*`, `update_volume` | deny | Deny by default. |

## Allowed Read Tools In `read_only`

- `connect_service_source`: Inspected as allowed, but Ewokbot should treat source mutation as unsafe despite the policy result.
- `disconnect_service_source`: Inspected as allowed, but Ewokbot should treat source mutation as unsafe despite the policy result.
- `docs_fetch`
- `docs_search`
- `environment_status`
- `get_logs`
- `get_service_config`
- `link_service`: Inspected as allowed, but Ewokbot should avoid mutating CLI link state unless explicitly approved.
- `list_deployments`
- `list_projects`
- `list_services`
- `list_workspaces`
- `search_templates`
- `service_metrics`

## Denied Or Unclassified Tools

Denied as secret-sensitive:

- `add_reference_variable`
- `list_variables`
- `set_variables`

Denied as destructive or human-approval required:

- `deploy`
- `deploy_template`
- `generate_domain`
- `remove_bucket`
- `remove_service`
- `remove_volume`
- `scale_service`

Denied as non-read:

- `create_bucket`
- `create_environment`
- `create_project`
- `create_service`
- `create_volume`
- `update_service`
- `update_volume`

Denied because no built-in AV classification was found:

- `http_error_rate`
- `http_requests`
- `link_environment`
- `whoami`

## AY Required Railway Input Schemas

These schemas come from `ewokbot mcp inspect railway --schema`.

Most Railway read tools accept optional `project_id`, `environment_id`, and `service_id` fields. If omitted, Railway uses the currently linked project, environment, or service. Ewokbot should prefer explicit IDs from workspace config when available and avoid mutating Railway CLI link state.

### `environment_status`

Use this for environment-wide staging status.

Optional arguments:

- `project_id`
- `environment_id`

```json
{
  "type": "object",
  "properties": {
    "environment_id": {
      "default": null,
      "description": "The environment ID or name. If omitted, uses the currently linked environment.",
      "nullable": true,
      "type": "string"
    },
    "project_id": {
      "default": null,
      "description": "The project ID. If omitted, uses the currently linked project.",
      "nullable": true,
      "type": "string"
    }
  },
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "EnvironmentStatusParams"
}
```

### `list_deployments`

Use this for recent deployment lookup.

Optional arguments:

- `project_id`
- `environment_id`
- `service_id`
- `limit`

```json
{
  "type": "object",
  "properties": {
    "environment_id": {
      "default": null,
      "description": "The environment ID or name. If omitted, uses the currently linked environment.",
      "nullable": true,
      "type": "string"
    },
    "limit": {
      "default": null,
      "description": "Maximum number of deployments to return (default: 20).",
      "format": "int64",
      "nullable": true,
      "type": "integer"
    },
    "project_id": {
      "default": null,
      "description": "The project ID. If omitted, uses the currently linked project.",
      "nullable": true,
      "type": "string"
    },
    "service_id": {
      "default": null,
      "description": "The service ID or name. If omitted, uses the currently linked service.",
      "nullable": true,
      "type": "string"
    }
  },
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ListDeploymentsParams"
}
```

### `list_projects`

Use this for project discovery.

Arguments: none.

```json
{
  "type": "object",
  "properties": {}
}
```

### `list_services`

Use this for service discovery.

Optional arguments:

- `project_id`

```json
{
  "type": "object",
  "properties": {
    "project_id": {
      "default": null,
      "description": "The project ID to use. If omitted, uses the currently linked project.",
      "nullable": true,
      "type": "string"
    }
  },
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ProjectParams"
}
```

### `get_service_config`

Use this for service build/source/start configuration summary. It returns variable count, not variable values.

Optional arguments:

- `project_id`
- `environment_id`
- `service_id`

```json
{
  "type": "object",
  "properties": {
    "environment_id": {
      "default": null,
      "description": "The environment ID or name. If omitted, uses the currently linked environment.",
      "nullable": true,
      "type": "string"
    },
    "project_id": {
      "default": null,
      "description": "The project ID. If omitted, uses the currently linked project.",
      "nullable": true,
      "type": "string"
    },
    "service_id": {
      "default": null,
      "description": "The service ID or name. If omitted, uses the currently linked service.",
      "nullable": true,
      "type": "string"
    }
  },
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "GetServiceConfigParams"
}
```

### `get_logs`

Use this for deploy/build/HTTP diagnostic logs.

Optional arguments:

- `project_id`
- `environment_id`
- `service_id`
- `deployment_id`
- `log_type`, enum `build | deploy | http`
- `level`
- `lines`
- `method`
- `path`
- `request_id`
- `search`
- `since`
- `status`
- `until`

```json
{
  "type": "object",
  "properties": {
    "deployment_id": { "default": null, "description": "Specific deployment ID to get logs for. If omitted, uses the latest deployment.", "nullable": true, "type": "string" },
    "environment_id": { "default": null, "description": "The environment ID or name. If omitted, uses the currently linked environment.", "nullable": true, "type": "string" },
    "level": { "default": null, "description": "Filter by log level: \"error\", \"warn\", or \"info\" (for build/deploy logs).", "nullable": true, "type": "string" },
    "lines": { "default": null, "description": "Number of log lines to return (default: 100).", "format": "int64", "nullable": true, "type": "integer" },
    "log_type": { "anyOf": [{ "$ref": "#/$defs/LogType" }, { "const": null, "nullable": true }], "description": "Type of logs: \"build\", \"deploy\", or \"http\" (default: \"deploy\")." },
    "method": { "default": null, "description": "Filter HTTP logs by request method: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS (requires log_type: \"http\").", "nullable": true, "type": "string" },
    "path": { "default": null, "description": "Filter HTTP logs by request path, e.g. \"/api/users\" (requires log_type: \"http\").", "nullable": true, "type": "string" },
    "project_id": { "default": null, "description": "The project ID. If omitted, uses the currently linked project.", "nullable": true, "type": "string" },
    "request_id": { "default": null, "description": "Filter HTTP logs by request ID (requires log_type: \"http\").", "nullable": true, "type": "string" },
    "search": { "default": null, "description": "Search string to filter logs (for build/deploy logs).", "nullable": true, "type": "string" },
    "service_id": { "default": null, "description": "The service ID or name. If omitted, uses the currently linked service.", "nullable": true, "type": "string" },
    "since": { "default": null, "description": "Start time filter. Supports relative (\"30m\", \"2h\", \"1d\") or ISO 8601 format.", "nullable": true, "type": "string" },
    "status": { "default": null, "description": "Filter HTTP logs by status code. Accepts: exact (200), comparison (>=400), or range (500..599) (requires log_type: \"http\").", "nullable": true, "type": "string" },
    "until": { "default": null, "description": "End time filter. Supports relative (\"30m\", \"2h\", \"1d\") or ISO 8601 format.", "nullable": true, "type": "string" }
  },
  "$defs": {
    "LogType": {
      "enum": ["build", "deploy", "http"],
      "type": "string"
    }
  },
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "GetLogsParams"
}
```

### `service_metrics`

Use this for CPU/memory/resource metrics.

Optional arguments:

- `project_id`
- `environment_id`
- `service_id`
- `hours_back`
- `measurements`
- `sample_rate_seconds`

```json
{
  "type": "object",
  "properties": {
    "environment_id": { "default": null, "description": "The environment ID or name. If omitted, uses the currently linked environment.", "nullable": true, "type": "string" },
    "hours_back": { "default": null, "description": "Number of hours back to query (default: 1).", "format": "int64", "nullable": true, "type": "integer" },
    "measurements": { "default": null, "description": "Metrics to fetch: CPU_USAGE, MEMORY_USAGE_GB, DISK_USAGE_GB, NETWORK_RX_GB, NETWORK_TX_GB. Defaults to CPU_USAGE and MEMORY_USAGE_GB.", "items": { "type": "string" }, "nullable": true, "type": "array" },
    "project_id": { "default": null, "description": "The project ID. If omitted, uses the currently linked project.", "nullable": true, "type": "string" },
    "sample_rate_seconds": { "default": null, "description": "Sample rate in seconds (default: 60).", "format": "int64", "nullable": true, "type": "integer" },
    "service_id": { "default": null, "description": "The service ID or name. If omitted, uses the currently linked service.", "nullable": true, "type": "string" }
  },
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ServiceMetricsParams"
}
```

### `whoami`

Arguments: none.

Policy note: currently denied because no built-in AV classification was found. Do not require it for default AY readiness until policy classification is corrected.

```json
{
  "type": "object",
  "properties": {}
}
```

### HTTP Observability Tools

The `http_error_rate`, `http_requests`, and `http_response_time` tools share this schema, but are currently denied or unclassified under the inspected policy. Do not map them into default staging verification until classification is explicitly fixed.

Optional arguments:

- `project_id`
- `environment_id`
- `service_id`
- `deployment_id`
- `lines`

```json
{
  "type": "object",
  "properties": {
    "deployment_id": { "default": null, "description": "Specific deployment ID. If omitted, uses the latest deployment.", "nullable": true, "type": "string" },
    "environment_id": { "default": null, "description": "The environment ID or name. If omitted, uses the currently linked environment.", "nullable": true, "type": "string" },
    "lines": { "default": null, "description": "Number of log entries to sample (default: 200).", "format": "int64", "nullable": true, "type": "integer" },
    "project_id": { "default": null, "description": "The project ID. If omitted, uses the currently linked project.", "nullable": true, "type": "string" },
    "service_id": { "default": null, "description": "The service ID or name. If omitted, uses the currently linked service.", "nullable": true, "type": "string" }
  },
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "HttpObservabilityParams"
}
```

## Policy Notes

- Default staging verification should use allowed read-only tools only.
- `list_variables` is secret-sensitive and must be denied or redacted-only.
- Do not call `deploy`, `set_variables`, `remove_*`, `scale_service`, or `generate_domain` by default.
- Treat source/link mutation tools conservatively even if current inspection marks some as allowed.
- Keep service URLs and smoke URLs configured in workspace/repository config unless a safe read-only tool reliably exposes them.
- Tests must remain fake-only and must not call Railway, network, provider deployments, or production operations.
