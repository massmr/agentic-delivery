# Tracking

This folder is the source of truth for project progress.

Use it to track what has been decided, what is done, what is in progress, what is blocked, and what OpenCode should do next.

## Files

- `roadmap.md`: milestone-level progress.
- `decision-log.md`: architectural and product decisions.
- `progress-log.md`: chronological implementation notes.
- `risks-and-blockers.md`: open risks, blockers, and required human actions.
- `next-actions.md`: immediate execution queue.

## Update Rules

Every autonomous implementation pass should update:

- `progress-log.md`
- `next-actions.md`

When a meaningful decision is made, update:

- `decision-log.md`

When a milestone changes state, update:

- `roadmap.md`

When blocked, update:

- `risks-and-blockers.md`

When a milestone intentionally keeps a capability on a local/native fallback instead of MCP, record that boundary in `progress-log.md` and the relevant user-facing README so the accepted contract stays explicit.
