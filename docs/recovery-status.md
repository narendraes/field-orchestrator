# Recovery status

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
