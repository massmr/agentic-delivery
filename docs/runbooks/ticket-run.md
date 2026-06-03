# Ticket Run Runbook

## Purpose

This runbook defines how the orchestrator should execute one Jira ticket from backlog to production pull request.

## Steps

1. Fetch Jira ticket.
2. Validate ticket eligibility.
3. Identify affected repositories.
4. Create or resume run state.
5. Generate technical plan.
6. Create working branch from `develop`.
7. Invoke OpenCode with ticket and repository context.
8. Run required quality gates.
9. Retry OpenCode if quality gates fail and retry budget remains.
10. Commit changes.
11. Push working branch.
12. Open PR to `develop`.
13. Wait for GitHub checks.
14. Wait for Railway staging deployment.
15. Run staging smoke checks.
16. Open PR from `develop` to `main`.
17. Comment final status on Jira.

## Human Escalation

Move the run to `NEEDS_HUMAN` when:

- No repository can be inferred.
- Multiple repositories are possible but confidence is low.
- The ticket lacks enough acceptance criteria.
- A secret or credential is required.
- A destructive production operation is requested.
- Quality gates fail after retry budget.
- Staging verification fails after retry budget.

## Production Rule

The orchestrator may open a production PR but must not merge it.
