# Recovery status

> This file is a deployment/recovery journal. For the current rebuild specification use [requirements](requirements.md), [runtime architecture](runtime-architecture.md), and the independent [plan](../plan.md). Earlier entries below describe historical states.

## Optional population and Done-target protection — September 24, 2026

Deployed privately to development as 5.9.0. All 58 automated tests, ESLint and Forge lint pass. Live acceptance is pending. Activation defaults to **Future changes only**. Administrators may instead prepare a fixed list of targets by keys (up to 100 explicit keys per selection), inclusive target creation-date range, or all items in the configured target spaces. The date range uses Jira query timezone. Preparation reads the app-visible target keys in pages of 25 and stores the list without writing Jira fields. The UI reports the prepared target count, not a promise that every field value will change. A completed, current-revision list must be explicitly included in activation; changes to the selection require preparing again. Prepared lists expire after one hour. Refreshing a ready preview refreshes activation readiness without resaving the policy.

Initial population excludes targets in the Done status category by default. Including them requires the explicit checkbox. The independent **Do not update the target field when the target work item is Done** policy setting overrides inclusion and applies to future updates/restorations as well. It is off for existing policies unless selected, preserving existing behavior. Jira Expressions use `issue.status.category.key`, not the REST response's statusCategory shape. The guard and project scope are rechecked before writes; Jira writes and status transitions cannot be atomic, so an in-flight write may finish during a concurrent transition/deactivation.

Both active assessment and numeric relationship policies support population. Only the selected policy's target field is written; unrelated fields are untouched. Conditions are re-evaluated, equivalent values skipped, and target editability checked at runtime. Initial assessment population does not cascade into other policy fields. Relationships use the existing per-target calculation safeguards. No arbitrary JQL input or public endpoint is introduced.

A separate `population-jobs` consumer shares the installation concurrency key with relationship workers. It handles preparation and then one target per invocation, with persistent position and updated/unchanged/skipped counters. No issue values are queued or stored in population metadata. Failure pauses at the current position and exposes the error; **Retry remaining** resumes with fresh values. Deactivation, replacement or revision changes cancel pending processing. Review and control resolvers require Jira administrator permission. The latest run is accessible through **Refresh population progress** even after reopening the editor. Replaced target snapshots are cleaned in small queued batches; the latest snapshot and summary are retained until replaced (not automatic TTL deletion). A queued cleanup failure can leave old data until retried; no unlimited diagnostic event history is added.

Quotas: this opt-in operation adds queue invocations, Jira requests, and KVS reads/writes proportional to targets and hierarchy size. Future-only activation schedules no population. Product-trigger manifest filters remain unchanged; user-requested preparation and population are explicit admin actions, not unfiltered Jira event handlers. Done state on a distant related target cannot be checked in a source-event manifest expression, so Jira evaluates it after routing. This does not confer production-scale certification. Retry after a write/checkpoint interruption can count that target as unchanged; counters describe observed worker outcomes, not transactional accounting. Jira search is eventually consistent and preparation is a traversal-time snapshot, not a single-time database snapshot.

Verification source: https://developer.atlassian.com/cloud/jira/platform/jira-expressions-type-reference/#issuestatus . Live acceptance still required: future-only activation writes nothing initially; prepare selected targets reads only; explicit activation populates target fields; Done targets remain unchanged by default; explicit Done inclusion and future Done protection behave independently; deactivation and retries stop/resume pending work.


## AutoUp branding — September 24, 2026

Product name is now AutoUp. Jira admin navigation and in-app heading deployed privately in development version 5.8.0; Forge lint passed. Existing app ID, storage keys, module keys and repository identity are preserved. Atlassian-managed developer-console name and Jira app-user/history identity are separate from module titles and are not yet verified as renamed. User confirmed a live Story points change updated the JPD target (empty to 86). Next proposed feature: initial calculation on activation with progress, failure counts and retry, reusing paginated target jobs; not implemented by this branding change.


## Activation response parsing fix — September 24, 2026

Deployed privately to development as 5.7.0. All 45 tests, ESLint and Forge lint pass. Project-property PUT responses are status-only commands and no longer parsed as JSON on success, including empty 200/201/204 responses. HTTP failures still block activation; data-reading endpoints still require valid JSON. This fixes the observed activation failure in writeProjectIndex after readiness review passed. An interrupted earlier activation may have written some project indexes, but did not commit active status; retrying activation overwrites the projections before saving active state. No permissions, filters, rule scope or automatic activation behavior changed. Regression coverage includes empty success responses and a rejected property write. Live activation acceptance remains pending.


## Target project size restriction removed — September 24, 2026

Deployed privately to development as 5.6.0. All 41 automated tests, ESLint and Forge lint passed. Supersedes the ten-target limit in historical pilot notes below. Ten rows is a test-display limit only; activation no longer searches or rejects the whole target project. Activation checks the representative work item; runtime independently checks each target's project, editable numeric field, policy status and revision before writing.

Structural reconciliation discovers targets in pages of 25 with continuation jobs. Each target is evaluated in a separate serialized job with its own request budget. Ordinary source routing also queues each affected target separately. This adds queue invocations but avoids a project-sized evaluation in a single invocation. No target-project item-count cutoff is imposed. Pagination failures are explicit. Retries may rediscover targets; fresh calculation and unchanged-write suppression prevent duplicate writes. Old revision/deactivated jobs are ignored. No backfill on activation is added.

Per-target hierarchy safeguards (500 candidates, two descendant levels, 250 requests), reverse-route diagnostic limits and five active relationship policies remain separate pilot constraints. No full-scale throughput guarantee is implied. Live activation and JPD write acceptance remain pending. Jira search indexing and concurrent scope changes are still eventually consistent.


## Numeric relationship runtime pilot — September 24, 2026

Deployed privately to development as version 5.5.0 on September 24, 2026. All 39 automated tests, ESLint and Forge lint pass. Live acceptance remains pending; saved drafts were not automatically activated. This section supersedes the historical read-only relationship status below.

- Validated numeric relationship policies can activate from the editor. Source points/status changes trace affected targets and recompute sum/count/min/max. Creation, deletion, link changes and parent/type changes reconcile the bounded target scope, including totals that must decrease. Protection restores a changed target; equal values are not written.
- Manifest filters use projected project dependencies and link type/opposite-project pairs. Both endpoint projects receive the link projection. App-generated events are suppressed; relationship chaining is rejected at activation. Assessment Boolean checks continue using Jira Expressions; graph/value selection uses narrow REST reads and JQL.
- Relationship jobs use a Forge async queue serialized per installation, with a two-second initial delay. Jobs read current policies and values, and recheck status/revision before writing. Retryable Jira 429/5xx failures are retried; permanent failures are visible in Executions. No full event payload or field values are logged.
- Pilot limits: five active relationship policies; ten total work items across each policy's target projects; numeric editable targets; up to two hierarchy levels, 500 candidates and 250 Jira requests per policy job. Bounds fail explicitly rather than saving a truncated total. Activation checks the bounded target contexts. This is not a 100,000-updates/week scale certification.
- Source and target spaces are separate selections. Activation does not backfill existing values. Queue processing adds invocations and latency; optional diagnostics add bounded storage usage. Relationship results occupy up to twenty sampled slots per policy; the UI shows at most 100 merged traces.
- Known limits: moves into unconfigured projects may miss the manifest gate; use validation/reconciliation after such moves. Jira search indexing and event delivery are eventually consistent, so live correctness acceptance remains required. Queue serialization does not make administrator lifecycle edits or Jira writes atomic; an already in-flight write may finish after deactivation. Competing administrator edits and global storage concurrency remain future hardening. Runtime uses app permissions, which can differ from the validating user's permissions.

Acceptance: activate a validated policy on a small target project, enable diagnostics, change a matching child from 3 to 11 points and verify the actual target increases by 8. Move it out of the status filter and verify subtraction. Test blank points, link removal, reparenting within source scope, duplicate/no-change events, protected-target restoration, and deactivation. Keep field values and project keys installation-specific; generic example key: ABC-123. Do not mark delivery complete until these live checks pass.


Recovered from the September 23 backup and recorded changes in the development conversation. Original Git history was unavailable; the private repository starts at the recovery baseline.

## Reconstructed

Revision-bound validation, failure invalidation, activation reviews and expiring tokens, manifest-filtered creation processing, correct protection trace classification, and regression coverage. The requested in-editor save/test/activate/deactivate flow is also implemented.

## Verification boundary

Local regression tests use mocked Jira and KVS; they do not prove live Jira event delivery, expression compatibility, or rendered UI behavior. Recovery and follow-up diagnostics were deployed to private development as version 5.4.0 on September 24, 2026. Deployment does not establish live acceptance. Before deploying, review these limitations and perform acceptance against a controlled Jira test project. Existing concurrent storage and cross-context option limitations remain. Ordered outcomes and live relationship/hierarchy processing were never completed and remain pending.
