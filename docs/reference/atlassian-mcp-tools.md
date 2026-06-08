# Atlassian MCP Tool Reference

This document records the inspected Atlassian MCP server surface that Ewokbot should use for Milestone AX.

Source:

- Server: `atlassian`
- Version banner: `Atlassian MCP server v2.1.0 running on stdio`
- Transport: `stdio`
- Command: `mcp-atlassian`
- Discovered tools: 40
- Registry entries: 40
- Inspected policy mode: `read_only`
- Inspection mode only listed MCP tools; no MCP tool was called.

## AX Jira Mapping

AX should stop guessing Jira MCP tool names and map Ewokbot's `TicketPort` to the inspected tools below:

| Ewokbot action | Atlassian MCP tool | Read/write | AX expectation |
| --- | --- | --- | --- |
| `TicketPort.listBacklog` | `search_jira_issues` | read | Use Jira Query Language (JQL). Empty `project_keys: []` means no project constraint. |
| `TicketPort.getTicket` | `read_jira_issue` | read | Read one issue by key/id and normalize fields into the existing ticket model. |
| `TicketPort.comment` | `add_jira_comment` | write | Keep denied in `read_only`; require supervised/trusted/custom policy before use. |

## AX Required Jira Input Schemas

These schemas come from `ewokbot mcp inspect atlassian --schema`.

### `search_jira_issues`

Use this for `TicketPort.listBacklog`.

Required arguments:

- `jql`

Optional arguments:

- `maxResults`, default `50`, minimum `1`, maximum `100`
- `startAt`, default `0`
- `fields`, default `*all`

```json
{
  "type": "object",
  "properties": {
    "jql": {
      "type": "string",
      "description": "A JQL query string. For example, to find all open issues in project \"PROJ\", use: `project = PROJ AND status = Open`."
    },
    "maxResults": {
      "type": "number",
      "description": "The maximum number of issues to return. Default is 50, maximum is 100.",
      "default": 50,
      "minimum": 1,
      "maximum": 100
    },
    "startAt": {
      "type": "number",
      "description": "The starting index for pagination. Default is 0.",
      "default": 0
    },
    "fields": {
      "type": "string",
      "description": "A comma-separated list of fields to include for each issue in the response. By default, it returns all fields (`*all`).",
      "default": "*all"
    }
  },
  "required": ["jql"]
}
```

AX argument guidance:

- Build JQL deterministically from the configured project-key constraints and backlog readiness policy.
- If `project_keys: []`, do not add a `project in (...)` constraint.
- Set `maxResults` to Ewokbot's configured or existing backlog limit, capped at `100`.
- Prefer a minimal `fields` list only if tests prove the response normalizer has everything it needs; otherwise keep the server default.

### `read_jira_issue`

Use this for `TicketPort.getTicket`.

Required arguments:

- `issueKey`

Optional arguments:

- `expand`, default `fields,transitions,changelog`

```json
{
  "type": "object",
  "properties": {
    "issueKey": {
      "type": "string",
      "description": "The unique identifier for the Jira issue (e.g., \"PROJ-123\")."
    },
    "expand": {
      "type": "string",
      "description": "A comma-separated list of additional properties to expand. Common options include `fields`, `transitions`, and `changelog`.",
      "default": "fields,transitions,changelog"
    }
  },
  "required": ["issueKey"]
}
```

AX argument guidance:

- Pass the requested ticket key as `issueKey`.
- Keep the default expand unless the existing fake tests require an explicit value.

### `add_jira_comment`

Use this for `TicketPort.comment`.

Required arguments:

- `issueKey`
- `body`

Optional arguments:

- `visibility`, with `type` enum `group | role` and `value`

```json
{
  "type": "object",
  "properties": {
    "issueKey": {
      "type": "string",
      "description": "The key of the issue to which the comment will be added (e.g., \"PROJ-123\")."
    },
    "body": {
      "type": "string",
      "description": "The text content of the comment."
    },
    "visibility": {
      "type": "object",
      "description": "An object that sets the visibility of the comment to a specific project role or group. Optional.",
      "properties": {
        "type": {
          "type": "string",
          "enum": ["group", "role"],
          "description": "The type of visibility restriction."
        },
        "value": {
          "type": "string",
          "description": "The name of the group or project role."
        }
      }
    }
  },
  "required": ["issueKey", "body"]
}
```

AX argument guidance:

- Pass the ticket key as `issueKey`.
- Pass the rendered Ewokbot comment as `body`.
- Do not set `visibility` unless a later explicit policy/config milestone adds it.
- Keep this write path blocked by policy in `read_only`.

Jira project discovery can use:

- `list_jira_projects`

Sprint/backlog helper tools are available but are not required for AX unless explicitly needed by tests or mapping quality:

- `list_agile_boards`
- `list_sprints_for_board`
- `get_sprint_details`
- `get_my_current_sprint_issues`
- `get_my_unresolved_issues`

## Jira Tools

Read-classified tools allowed by `read_only`:

- `get_jira_current_user`: Get details of the authenticated Jira user.
- `get_jira_user`: Get details for a specific Jira user by username, account ID, or email.
- `search_issues_by_user_involvement`: Search for issues based on assignee, reporter, creator, watcher, or any involvement.
- `list_issues_by_user_role`: List issues where a user has a specific role.
- `get_user_activity_history`: Get recent user activity such as comments, status changes, and field updates.
- `get_user_time_tracking`: Retrieve time tracking work logs for a specific user.
- `read_jira_issue`: Retrieves detailed information about a specific Jira issue, including fields, status, and transitions.
- `search_jira_issues`: Searches for Jira issues using Jira Query Language (JQL).
- `list_jira_projects`: Lists all Jira projects the authenticated user can view.
- `list_agile_boards`: List accessible Scrum and Kanban boards.
- `list_sprints_for_board`: List sprints for a board.
- `get_sprint_details`: Get sprint details including dates, goal, and included issues.
- `get_my_current_sprint_issues`: Get issues assigned to the authenticated user in active sprints.
- `get_my_unresolved_issues`: Get unresolved issues assigned to the authenticated user.

Write-classified tools denied by `read_only`:

- `create_jira_issue`: Creates a Jira issue.
- `add_jira_comment`: Adds a comment to an existing Jira issue.

## Confluence Tools

Confluence is intentionally out of AX delivery scope. These tools are documented so the provider boundary stays Atlassian-first, but AX should not implement Confluence workflows.

Read-classified tools allowed by `read_only`:

- `get_confluence_current_user`: Get details of the authenticated Confluence user.
- `get_confluence_user`: Get details for a specific Confluence user.
- `search_pages_by_user_involvement`: Search pages by creator and/or last modifier.
- `list_pages_created_by_user`: List pages created by a user.
- `list_attachments_uploaded_by_user`: List attachments uploaded by a user.
- `read_confluence_page`: Retrieve Confluence page content by ID or by title and space key.
- `search_confluence_pages`: Search pages using Confluence Query Language (CQL).
- `list_confluence_spaces`: List Confluence spaces visible to the user.
- `get_confluence_space`: Get details for a Confluence space.
- `list_attachments_on_page`: List attachments for a Confluence page.
- `get_page_with_attachments`: Download page content, metadata, and optionally attachments.
- `list_confluence_page_children`: List child pages under a page.
- `list_confluence_page_ancestors`: Retrieve page ancestry.
- `find_confluence_users`: Search Confluence users.
- `list_confluence_page_labels`: Retrieve labels for a Confluence page.
- `get_my_recent_confluence_pages`: List pages recently created or updated by the authenticated user.
- `get_confluence_pages_mentioning_me`: Search pages mentioning the authenticated user.

Write or sensitive tools denied by `read_only`:

- `download_confluence_attachment`: Denied because the inspected tool had no built-in AV classification.
- `upload_confluence_attachment`: Denied because the inspected tool had no built-in AV classification.
- `create_confluence_page`: Denied as non-read.
- `update_confluence_page`: Denied as non-read.
- `add_confluence_comment`: Denied as non-read.
- `add_confluence_page_label`: Denied as non-read.
- `export_confluence_page`: Denied because the inspected tool had no built-in AV classification.

## Policy Notes

- `read_only` allows read-classified Jira and Confluence tools.
- `read_only` denies Jira comments, Jira issue creation, Confluence writes, and tools without built-in classification.
- AX should keep `add_jira_comment` policy-gated and covered by fake-only tests.
- AX should not call MCP tools during tests.
- AX should preserve `jira.mcp_tools` overrides for custom Atlassian MCP servers.
- AX should keep production merge and production deployment human-only.
