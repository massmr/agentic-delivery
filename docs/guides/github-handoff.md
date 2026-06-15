# GitHub Handoff

GitHub handoff is a typed CodeHostPort boundary for branch and PR evidence.

## Current Behavior

Ewokbot can use GitHub MCP-backed operations where configured and allowed by policy. The current user-facing handoff target is a develop/staging branch path, not autonomous production merge.

## Typical Develop PR Flow

1. Local ticket work produces evidence.
2. Quality gates pass.
3. CodeHostPort checks branch/PR state.
4. Ewokbot creates or updates a develop-targeted PR where configured.
5. Reports link local evidence to the handoff.

## Production Boundary

Production/main PRs are human-gated. Ewokbot may record local approval or rejection decisions, but it does not autonomously merge or deploy production.

## Policy-sensitive Operations

GitHub operations such as creating PRs or adding comments require configured provider access and policy permission. Destructive or production-sensitive actions are denied or escalated by default.

For MCP tool mapping, see [GitHub MCP Tools](../reference/github-mcp-tools.md).
