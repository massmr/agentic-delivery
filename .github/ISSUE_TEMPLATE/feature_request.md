---
name: Feature request
about: Propose a new Ewokbot workflow, connector, policy, or CLI capability
title: "feat: "
labels: enhancement
assignees: ""
---

## Goal

What user outcome should this enable?

## Scope

What should be included?

## Non-goals

What should stay out of scope?

## Affected Area

- [ ] CLI / UX
- [ ] Init / doctor
- [ ] Ticket provider
- [ ] Code host
- [ ] Deployment monitor
- [ ] Dev runner
- [ ] Review provider
- [ ] Policy / safety
- [ ] Worker / resume
- [ ] Documentation

## Proposed Config

If this changes `.ewokbot/workspace.yml`, sketch the desired shape.

```yaml
# Example only
```

## Safety Model

What should require human approval? What should be denied by default?

## Acceptance Criteria

- [ ] Tests can run without live providers or secrets.
- [ ] Documentation explains the operator-facing behavior.
- [ ] Production merge/deploy remains human-only unless explicitly discussed.
