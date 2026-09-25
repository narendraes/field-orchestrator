# AutoUp bug register

This repository-local register is independent of Jira. Record new bugs here as development and testing reveal them. Cross-link plan tasks and optional GitHub issues/PRs. Existing hardening and live-test gaps remain in plan.md; they are not automatically confirmed bugs.

Statuses: investigating → confirmed → in progress → fixed locally → deployed → verified. Also allow deferred or closed-not-a-bug with a reason. Reopen regressions; do not delete their history.

No new bug was investigated in this documentation change. Historical fixes are recorded in docs/recovery-status.md and Git history; this is not a claim that the app has no defects.

## Record template

Copy this section and allocate the next unused BUG-NNN ID.

- ID / title:
- Status / impact / affected version:
- Related requirement and plan task:
- Reproduction (generic fixtures, configuration and action):
- Expected behavior:
- Actual behavior and sanitized trace/evidence:
- Cause (or investigation notes):
- Fix and regression checks:
- Commit / pull request:
- Deployment version / environment:
- Live verification result and date:
- Remaining limitations / follow-up:
