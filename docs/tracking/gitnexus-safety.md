GitNexus safety note
====================

MUST run GitNexus impact analysis before editing delivery-related symbols.

Why
---

Several runtime delivery helpers (for example: runDevelopPullRequestHandoff and runRuntimeDevelopPullRequestHandoff) have a HIGH blast radius: they are called by multiple processes and touch the Delivery and Commands modules. Editing these symbols without impact analysis risks breaking many execution flows.

Required steps before editing any symbol in src/delivery/*
-----------------------------------------------------

1. Run impact analysis (upstream) for the symbol you plan to change:

   gitnexus_impact({ target: "<SymbolName>", direction: "upstream", repo: "ewokbot" })

   - Review `risk` (LOW/MEDIUM/HIGH/CRITICAL). If HIGH or CRITICAL, do NOT edit without explicit human approval.
   - Review `byDepth.d=1` results — these are direct callers that WILL BREAK.

2. If you proceed with a change, run `gitnexus_detect_changes()` locally before committing to see which execution flows and symbols are affected by your edits.

3. Add or update integration tests that exercise the impacted processes (mock providers, in-memory ledgers) so the change is covered by CI.

4. Open a PR listing the gitnexus_impact output and the mitigation plan (tests, rollback steps). Ask reviewers to sign off on the blast-radius and tests before merging.

Notes
-----

- Example: runDevelopPullRequestHandoff was analyzed and returned RISK=HIGH. See docs/tracking/progress-log.md for the impact snapshot. Regenerate the local, unversioned graphify-out/ directory when you need the structural graph. Use graphify query and gitnexus process views to understand the affected execution flows.
- This file is a short-form safety policy to keep in the repo. For more detail see gitnexus docs and the `gitnexus_impact` and `gitnexus_detect_changes` tool docs.
