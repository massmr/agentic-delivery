# Risks And Blockers

## Open Risks

- Jira ticket quality may be inconsistent, requiring `NEEDS_HUMAN` handling.
- Repository inference from Jira text may be unreliable without explicit repo fields or labels.
- Quality gates may differ significantly across repositories.
- Railway deployment verification may require project/service mapping not yet captured in config.
- Real OpenCode behavior may vary by local installation even though the runner contract is now typed and guarded.

## Current Blockers

- Real Jira credentials are not configured.
- Real GitHub token and repo permissions are not configured in `.env`.
- Real Railway token and service mappings are not configured.

## Required Later

- Decide how Jira statuses map to orchestrator states.
- Decide whether the orchestrator should auto-merge PRs to `develop` after checks pass.
- Decide where the worker should run once local CLI mode is stable.
