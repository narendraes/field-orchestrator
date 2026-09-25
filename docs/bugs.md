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

## BUG-001 — Related rollup updates complete noticeably apart

- Status: investigating; correctness converged, latency needs measurement.
- Reported: 2026-09-25. Related tasks: P4.14, P4.17, P6.10.
- Reproduction: two active status-filtered rollups share a target work item; move a contributing Story between status categories, then externally override a protected target field.
- Expected: both affected totals converge promptly; protection restores the override. Do not require unrelated fields to recalculate from an override.
- Observed: runtime logs at 11:32:20 UTC and 11:32:45 UTC show both rollups updated from the same source status change, about 25 seconds apart. Protection restored its field at 11:32:38 UTC. Screenshot indicates about eight seconds from external edit to restoration.
- Evidence: successful changed/restored outcomes; individual worker durations 2247ms, 1562ms and 2022ms respectively. No error in these runs.
- Investigation: relationship discovery/target jobs and population share installation-wide queue concurrency 1, with two-second enqueue delays. Queue wait is a plausible contributor; event arrival/enqueue/start timestamps are not retained, so the precise delay breakdown is unproven.
- Fix/verification: no runtime change yet. Add end-to-end queue timing and verify same-event multi-policy latency before choosing a concurrency or batching change.

### BUG-001 implementation update — 2026-09-25

Removed relationship queue delays and the extra queue hop for each policy's first target on ordinary updates. Fan-out and structural scans remain queued; concurrency remains one. Added ingress-to-result and pre-job timing for measurement. Regression verification and private deployment recorded separately; live latency acceptance remains pending.

BUG-001 status: deployed for live verification in private development 5.10.0. All 61 tests, ESLint and Forge lint passed. No measured post-deployment speed claim yet.
