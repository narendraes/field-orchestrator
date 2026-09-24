# Jira delivery reconciliation

## Numeric relationship runtime pilot — September 24, 2026

Deployed privately to development as version 5.5.0 on September 24, 2026. All 39 automated tests, ESLint and Forge lint pass. Live acceptance remains pending; saved drafts were not automatically activated. This section supersedes the historical read-only relationship status below.

- Validated numeric relationship policies can activate from the editor. Source points/status changes trace affected targets and recompute sum/count/min/max. Creation, deletion, link changes and parent/type changes reconcile the bounded target scope, including totals that must decrease. Protection restores a changed target; equal values are not written.
- Manifest filters use projected project dependencies and link type/opposite-project pairs. Both endpoint projects receive the link projection. App-generated events are suppressed; relationship chaining is rejected at activation. Assessment Boolean checks continue using Jira Expressions; graph/value selection uses narrow REST reads and JQL.
- Relationship jobs use a Forge async queue serialized per installation, with a two-second initial delay. Jobs read current policies and values, and recheck status/revision before writing. Retryable Jira 429/5xx failures are retried; permanent failures are visible in Executions. No full event payload or field values are logged.
- Pilot limits: five active relationship policies; ten total work items across each policy's target projects; numeric editable targets; up to two hierarchy levels, 500 candidates and 250 Jira requests per policy job. Bounds fail explicitly rather than saving a truncated total. Activation checks the bounded target contexts. This is not a 100,000-updates/week scale certification.
- Source and target spaces are separate selections. Activation does not backfill existing values. Queue processing adds invocations and latency; optional diagnostics add bounded storage usage. Relationship results occupy up to twenty sampled slots per policy; the UI shows at most 100 merged traces.
- Known limits: moves into unconfigured projects may miss the manifest gate; use validation/reconciliation after such moves. Jira search indexing and event delivery are eventually consistent, so live correctness acceptance remains required. Queue serialization does not make administrator lifecycle edits or Jira writes atomic; an already in-flight write may finish after deactivation. Competing administrator edits and global storage concurrency remain future hardening. Runtime uses app permissions, which can differ from the validating user's permissions.

Acceptance: activate a validated policy on a small target project, enable diagnostics, change a matching child from 3 to 11 points and verify the actual target increases by 8. Move it out of the status filter and verify subtraction. Test blank points, link removal, reparenting within source scope, duplicate/no-change events, protected-target restoration, and deactivation. Keep field values and project keys installation-specific; generic example key: ABC-123. Do not mark delivery complete until these live checks pass.


## Current correction and source routing — September 24, 2026

This section supersedes earlier link-payload blocker notes. The official Jira events reference explicitly documents issueLinkType.id (a string) for both created/deleted issue-link events. The prior conclusion that link-type filtering was impossible was incorrect. Project-property filtering remains source-side, so a future active link index must cover both configured endpoint project scopes. No relaxation of the manifest-first rule is required on account of the link-type ID.

Implemented locally, not deployed: a pure relationship-plan compiler maps statusCategory dependencies to status, collects source/target scopes and protected-target dependencies, and records both endpoint project scopes for future indexing. The administrator-only traceRelationshipSource resolver reads the saved revision asUser, walks up to two ancestors with narrow fields, asks Jira to filter root types and target projects, and reports affected target keys. It does not filter out a source because it left a condition. The editor exposes Trace saved policy from source. Routing is limited to 50 targets and three ancestor reads plus up to two searches (and one administrator permission request, excluded from displayed data-request count). Incomplete pagination, cycles and out-of-scope sources fail explicitly. It traces current visible links only, not historical parents/deleted links.

Runtime activation remains disabled because full handlers, old/new structural coverage, compiled index persistence, concurrency-safe writes and end-to-end acceptance are unfinished—not because a link-type ID is missing. No manifest subscription, activation or Jira field write was added in this slice. Next: persist/project the compiled indexes; implement filtered link and structural event paths; invoke reverse routing and recalculation with safe target writes.

Official source verified September 24, 2026: https://developer.atlassian.com/platform/forge/events-reference/jira/#issue-link-events (IssueLinkType type reference and payload example); https://developer.atlassian.com/platform/forge/events-reference/product_events/#filtering-by-entity-properties .

## Earlier delivery records (see correction above)

Reconciled September 24, 2026 against private development deployment 5.4.0, source commits a36fd34 and 68fb2cc, and deployment record 0829fe4. This is development tracking, not a product configuration or example. No test work-item values were changed during reconciliation.

| Jira item | Status / evidence | Remaining work |
| --- | --- | --- |
| DO-88 Hierarchy and relationship event automation | In Progress; feature progress comment updated | Automatic event routing, full structural coverage, writes and live acceptance |
| DO-108 Source-project scope | In Progress; explicit selector, persisted IDs and scoped previews deployed | Runtime compilation and projection; discovery |
| DO-111 Link event handling | Backlog; blocker documented in comment | Documented payload lacks link-type ID; supported projection or approved filter-contract exception |
| DO-113 Automatic Jira/JPD rollups | Backlog; acceptance and implementation sequence updated in comment | Actual automatic target update, structural correctness, idempotency, scope and permissions |
| DO-89 Runtime reliability and observability | In Progress; temporary diagnostics deployed | Durable concurrency, counters, quota measurement and release acceptance |
| DO-104 Assessment end-to-end acceptance | Backlog; pending live evidence recorded | Verify real writes, protection, no-match and deactivation |

No items were moved to Done. Manual would-change outcomes are preview evidence only. Temporary diagnostics are sampled and cannot observe manifest-rejected events. Do not mistake enabling diagnostics for activation.

Workflow: for each functional change, update requirements and runtime architecture alongside code, run relevant checks, update the existing Jira item with implementation/deployment/live-acceptance evidence and remaining scope, transition only when that scope is met, then commit and sync the private repository. Keep older baseline counts labeled as historical; progress comments above supersede their delivery interpretation.
