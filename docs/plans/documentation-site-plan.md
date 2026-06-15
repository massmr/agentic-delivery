# Documentation And Site Plan

This plan exists to guide documentation and public-site work without weakening the current source-of-truth material already present in `docs/`.

## Principle

The repository `docs/` tree remains the canonical source of truth.

That means:

- existing specs, plans, references, runbooks, and tracking material are authoritative inputs,
- new documentation should reorganize, clarify, summarize, and link this material,
- the public documentation site and landing page must be downstream of this source material,
- the public site must not become a parallel truth source with invented or drifted behavior.

## Content Layers

### 1. Canonical Source Docs

Current categories that remain authoritative:

- `docs/specs/`
- `docs/plans/`
- `docs/reference/`
- `docs/runbooks/`
- `docs/tracking/`
- `docs/prompts/`

These documents may be edited for clarity, but they should remain the deep factual layer.

### 2. Consolidated Product Docs

New end-user and developer-facing documentation should be organized into:

- Getting Started
- Core Concepts
- Guides
- Reference
- Architecture
- Runbooks
- Roadmap / Limits

Suggested structure:

```text
docs/
  getting-started/
  concepts/
  guides/
  reference/
  architecture/
  runbooks/
  tracking/
  plans/
  specs/
```

This layer should explain Ewokbot clearly without removing the original technical material.

Canonical mapping for this layer is maintained in `docs/README.md` and `docs/architecture/documentation-architecture.md`. Those files define how new Getting Started, Concepts, Guides, Reference, Architecture, Runbooks, and Roadmap/Limits pages trace back to existing source docs.

### 3. Public Site

The site should present:

- landing / overview,
- install,
- docs navigation,
- capability summary,
- provider coverage,
- current supervision model,
- roadmap boundaries.

It should link back to the canonical repo docs where appropriate.

## Mandatory Documentation Pages

The consolidated docs should include at least:

### Overview

- What Ewokbot is
- What problem it solves
- Why MCP-first
- Why supervised autonomy

### Getting Started

- Install
- `ewokbot init`
- `ewokbot doctor`
- `ewokbot auth`
- first workspace setup

### Core Concepts

- workspace
- run
- ticket lifecycle
- provider adapters
- MCP policy modes
- local-only vs real-provider execution

### Guides

- scan backlog
- inspect one ticket
- inspect ticket relationships and blockers
- dry-run planning
- local `run-dev`
- real `smoke`
- GitHub develop handoff
- Railway mapping
- invocation control UI

### Reference

- CLI command reference
- workspace config reference
- provider config reference
- MCP registry and policy reference
- run states and next actions

### Honest Product State

- What Ewokbot can do today
- What Ewokbot does not do yet
- What still requires human approval
- What is experimental

## README Role

`README.md` should become:

- short,
- open-source friendly,
- installation-oriented,
- linked to the deeper docs.

It should not try to carry the entire product explanation by itself.

## Source Relationship

Documentation surfaces have this authority order:

1. Deep canonical docs in `docs/specs/`, `docs/reference/`, `docs/runbooks/`, `docs/plans/`, `docs/tracking/`, and `docs/prompts/`.
2. Consolidated product docs under the new taxonomy.
3. Repository `README.md`.
4. Future public docs and landing pages.

Downstream surfaces may improve navigation and wording, but they must not introduce unsupported behavior or contradict the canonical source docs.

## Feature Status Language

Use these labels consistently:

- **Today** means implemented in the CLI/runtime.
- **Supervised** means implemented but gated by explicit confirmation, policy, or human approval.
- **Experimental** means implemented or partially implemented for narrow validation.
- **Roadmap-only** means planned but not implemented.

Roadmap-only behavior must stay out of quickstarts and current-capability summaries.

## Provider Documentation Rules

Each provider section should clearly state:

- whether it is implemented,
- whether it is mock-only, read-only, supervised, or partially real,
- which typed business surface it powers,
- what remains intentionally disallowed.

The initial public docs should explicitly cover:

- Atlassian / Jira
- GitHub
- Railway
- Vercel (setup presence if applicable, with honest status)
- OpenCode as current dev runner

## Tone Rules

The public docs and landing should:

- be precise rather than overclaiming,
- distinguish current behavior from roadmap ideas,
- explain supervision and safety constraints directly,
- read like a serious operator/developer tool, not marketing vapor.

## Out Of Scope For Documentation Work

Documentation/site work must not:

- change product behavior without approved milestones,
- invent unsupported provider capabilities,
- describe production autopilot that does not exist,
- hide supervision boundaries,
- turn `docs/` into a thin marketing wrapper.
