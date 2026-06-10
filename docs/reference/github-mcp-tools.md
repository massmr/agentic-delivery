# GitHub MCP Tool Reference

This document records the inspected GitHub MCP server surface that Ewokbot should use for Milestone AZ and later GitHub PR handoff work.

Source:

- Server: `github`
- Version banner: `GitHub MCP Server running on stdio`
- Server log version: `v1.2.0`
- Transport: `stdio`
- Command: `docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server`
- Discovered tools: 43
- Registry entries: 43
- Inspected policy mode: `read_only`
- Inspection mode only listed MCP tools; no MCP tool was called.

## AZ/BA GitHub Mapping

AZ should stop guessing GitHub MCP tool names and map Ewokbot's `CodeHostPort` to the inspected tools below.

| Ewokbot intent | GitHub MCP tool | Read/write | Expectation |
| --- | --- | --- | --- |
| Repository branch listing/readiness | `list_branches` | read | Read existing branches before handoff or diagnostics. |
| Commit listing/readiness | `list_commits` | read | Read branch commit state when needed. |
| Develop PR creation | `create_pull_request` | write/destructive-classified | Must stay policy-gated and human-approved where required. |
| PR lookup/listing | `list_pull_requests` | read | Find existing PRs and avoid duplicate handoff. |
| PR detail/status/files/checks | `pull_request_read` | read | Use method-specific reads, including `get_check_runs`, `get_status`, `get_files`, and `get_diff`. |
| PR or issue comment | `add_issue_comment` | write | Use for ordinary PR comments by passing the PR number as `issue_number`; policy-gated. |
| Copilot review request | `request_copilot_review` | read-classified by inspection | Optional later workflow; not required for AZ or BA unless explicitly approved. |
| Branch creation | `create_branch` | write | Use only if Ewokbot needs remote branch creation; local git push fallback may remain separate. |
| Production merge | `merge_pull_request` | destructive | Human-only for main/production. BC permits only the typed `CodeHostPort.mergePullRequest` develop auto-merge path when branch-scoped delivery config and MCP policy explicitly allow it. |

Remote file mutation tools exist but should not be used for Ewokbot's normal local-agent delivery flow:

- `create_or_update_file`
- `push_files`
- `delete_file`

## AZ/BA Required GitHub Input Schemas

These schemas come from `ewokbot mcp inspect github --schema`.

### `create_pull_request`

Use this for GitHub PR creation when the policy and milestone explicitly allow MCP PR handoff.

Required arguments:

- `owner`
- `repo`
- `title`
- `head`
- `base`

Optional arguments:

- `body`
- `draft`
- `maintainer_can_modify`

```json
{
  "type": "object",
  "properties": {
    "base": {
      "type": "string",
      "description": "Branch to merge into"
    },
    "body": {
      "type": "string",
      "description": "PR description"
    },
    "draft": {
      "type": "boolean",
      "description": "Create as draft PR"
    },
    "head": {
      "type": "string",
      "description": "Branch containing changes"
    },
    "maintainer_can_modify": {
      "type": "boolean",
      "description": "Allow maintainer edits"
    },
    "owner": {
      "type": "string",
      "description": "Repository owner"
    },
    "repo": {
      "type": "string",
      "description": "Repository name"
    },
    "title": {
      "type": "string",
      "description": "PR title"
    }
  },
  "required": ["owner", "repo", "title", "head", "base"]
}
```

Guidance:

- Use `develop` as the base for develop PRs unless workspace config says otherwise.
- Use `main` only for later production PR preparation and keep production merge human-only.
- Prefer `draft: true` for first safe handoff unless the milestone explicitly says otherwise.

### `pull_request_read`

Use this for PR detail, diff, files, reviews, comments, checks, and status reads.

Required arguments:

- `method`
- `owner`
- `repo`
- `pullNumber`

Optional arguments:

- `page`, minimum `1`
- `perPage`, minimum `1`, maximum `100`
- `after`, only for `get_review_comments`

Supported `method` enum:

- `get`
- `get_diff`
- `get_status`
- `get_files`
- `get_review_comments`
- `get_reviews`
- `get_comments`
- `get_check_runs`

```json
{
  "type": "object",
  "properties": {
    "after": {
      "type": "string",
      "description": "Cursor for pagination, used only by the get_review_comments method. Pass the endCursor from the previous page's PageInfo to fetch the next page."
    },
    "method": {
      "type": "string",
      "description": "Action to specify what pull request data needs to be retrieved from GitHub.",
      "enum": [
        "get",
        "get_diff",
        "get_status",
        "get_files",
        "get_review_comments",
        "get_reviews",
        "get_comments",
        "get_check_runs"
      ]
    },
    "owner": {
      "type": "string",
      "description": "Repository owner"
    },
    "page": {
      "type": "number",
      "description": "Page number for pagination (min 1)",
      "minimum": 1
    },
    "perPage": {
      "type": "number",
      "description": "Results per page for pagination (min 1, max 100)",
      "minimum": 1,
      "maximum": 100
    },
    "pullNumber": {
      "type": "number",
      "description": "Pull request number"
    },
    "repo": {
      "type": "string",
      "description": "Repository name"
    }
  },
  "required": ["method", "owner", "repo", "pullNumber"]
}
```

Guidance:

- Use `get_check_runs` and/or `get_status` for GitHub-side CI status reads.
- Use `get_files` or `get_diff` for PR review evidence, but keep local diff policy as the primary safety gate.

### `list_pull_requests`

Use this to find existing PRs before creating duplicates.

Required arguments:

- `owner`
- `repo`

Optional arguments:

- `base`
- `head`
- `state`, enum `open | closed | all`
- `sort`, enum `created | updated | popularity | long-running`
- `direction`, enum `asc | desc`
- `page`, minimum `1`
- `perPage`, minimum `1`, maximum `100`

```json
{
  "type": "object",
  "properties": {
    "base": { "type": "string", "description": "Filter by base branch" },
    "direction": { "type": "string", "description": "Sort direction", "enum": ["asc", "desc"] },
    "head": { "type": "string", "description": "Filter by head user/org and branch" },
    "owner": { "type": "string", "description": "Repository owner" },
    "page": { "type": "number", "description": "Page number for pagination (min 1)", "minimum": 1 },
    "perPage": { "type": "number", "description": "Results per page for pagination (min 1, max 100)", "minimum": 1, "maximum": 100 },
    "repo": { "type": "string", "description": "Repository name" },
    "sort": { "type": "string", "description": "Sort by", "enum": ["created", "updated", "popularity", "long-running"] },
    "state": { "type": "string", "description": "Filter by state", "enum": ["open", "closed", "all"] }
  },
  "required": ["owner", "repo"]
}
```

### `add_issue_comment`

Use this for ordinary issue comments and PR comments. For PR comments, pass the PR number as `issue_number`.

Required arguments:

- `owner`
- `repo`
- `issue_number`
- `body`

```json
{
  "type": "object",
  "properties": {
    "body": { "type": "string", "description": "Comment content" },
    "issue_number": { "type": "number", "description": "Issue number to comment on" },
    "owner": { "type": "string", "description": "Repository owner" },
    "repo": { "type": "string", "description": "Repository name" }
  },
  "required": ["owner", "repo", "issue_number", "body"]
}
```

Guidance:

- Keep comments policy-gated because `read_only` denies this tool.
- Do not use review-comment tools for normal PR status comments unless a later review workflow explicitly requires them.

### `list_branches`

Use this for branch readiness checks and diagnostics.

Required arguments:

- `owner`
- `repo`

Optional arguments:

- `page`, minimum `1`
- `perPage`, minimum `1`, maximum `100`

```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string", "description": "Repository owner" },
    "page": { "type": "number", "description": "Page number for pagination (min 1)", "minimum": 1 },
    "perPage": { "type": "number", "description": "Results per page for pagination (min 1, max 100)", "minimum": 1, "maximum": 100 },
    "repo": { "type": "string", "description": "Repository name" }
  },
  "required": ["owner", "repo"]
}
```

### `create_branch`

Use this only when remote branch creation is explicitly needed. Ewokbot may still use local git push for branch delivery depending on the handoff milestone.

Required arguments:

- `owner`
- `repo`
- `branch`

Optional arguments:

- `from_branch`

```json
{
  "type": "object",
  "properties": {
    "branch": { "type": "string", "description": "Name for new branch" },
    "from_branch": { "type": "string", "description": "Source branch (defaults to repo default)" },
    "owner": { "type": "string", "description": "Repository owner" },
    "repo": { "type": "string", "description": "Repository name" }
  },
  "required": ["owner", "repo", "branch"]
}
```

### `list_commits`

Use this for commit/branch diagnostics if needed.

Required arguments:

- `owner`
- `repo`

Optional arguments:

- `sha`
- `path`
- `author`
- `since`
- `until`
- `page`, minimum `1`
- `perPage`, minimum `1`, maximum `100`

## Tool Classification Notes

Read-classified tools allowed by `read_only` include:

- Repository/commit/file reads: `get_commit`, `get_file_contents`, `list_branches`, `list_commits`, `list_tags`, `get_tag`.
- PR reads: `list_pull_requests`, `pull_request_read`, `search_pull_requests`.
- Issue reads/searches: `issue_read`, `list_issues`, `search_issues`.
- Release reads: `get_latest_release`, `get_release_by_tag`, `list_releases`.
- Discovery/search: `get_me`, `get_team_members`, `get_teams`, `search_code`, `search_commits`, `search_repositories`, `search_users`, `list_repository_collaborators`, `list_issue_types`.
- `request_copilot_review` was classified as allowed by the inspected `read_only` policy, but Ewokbot should still treat it as an optional externally visible action that requires explicit milestone approval.
- `fork_repository` was classified as allowed by the inspected `read_only` policy, but Ewokbot should not use it in delivery flows unless separately approved.

Write or destructive tools denied by `read_only` include:

- Comments/reviews: `add_issue_comment`, `add_comment_to_pending_review`, `add_reply_to_pull_request_comment`, `pull_request_review_write`.
- Branch/file/repo mutations: `create_branch`, `create_or_update_file`, `push_files`, `delete_file`, `create_repository`, `fork_repository` if project policy decides to override the inspected read classification.
- PR mutations: `create_pull_request`, `update_pull_request`, `update_pull_request_branch`, `merge_pull_request`.
- Issue mutations: `issue_write`, `sub_issue_write`, `assign_copilot_to_issue`.

## Policy Notes

- `create_pull_request` and generic/raw `merge_pull_request` are destructive-classified by Ewokbot policy and require explicit human approval.
- `merge_pull_request` remains human-only outside BC's typed develop auto-merge path, which additionally requires develop `auto_merge: true`, `require_human_approval: false`, explicit MCP policy allow, and a PR targeting `develop` rather than main/production.
- `delete_file`, `push_files`, remote file writes, branch deletion, repository mutation, workflow mutation, and secrets must remain denied by default.
- AZ should preserve `github.mcp_tools` overrides for custom GitHub MCP servers.
- Tests must remain fake-only and must not call GitHub, Docker, the network, local git remotes, PR creation, or production operations.
