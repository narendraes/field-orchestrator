# AutoUp — runtime architecture and recovery contracts

Current source baseline: **5f872dd**, private development **5.9.0**, reconciled **2026-09-24**. This document describes the implementation, not a production-scale guarantee. See [requirements](requirements.md) for product behavior and [plan](../plan.md) for independent rebuild tasks. Earlier evolving architecture notes are [archived](history/runtime-architecture-before-reconciliation-2026-09-24.md).

## 1. Module map

| File | Responsibility |
| --- | --- |
| `manifest.yml` | Native Jira admin page, filtered product triggers, two queue consumers, runtime/scopes |
| `src/index.js` | Exports resolver, issue handler, relationship ingress/worker and population worker |
| `src/frontend/index.jsx` | Metadata, policies/editor, typed options, read-only preview, activation/population controls, histories |
| `src/resolvers/index.js` | Policy normalization/storage, validation recording, activation compiler/review, project projections, admin diagnostic/population control |
| `src/runtime/issue-updated.js` | Admitted creation/update dispatch, in-process assessment chains, assessment write/trace |
| `src/runtime/relationship-routing.js` | Pure dependency-plan compilation and current source-to-target reverse traversal |
| `src/runtime/relationship-rollup.js` | Shared deterministic candidate/filter/aggregation functions |
| `src/runtime/relationship-worker.js` | Project dependency projection, narrow Jira adapter, queue ingress, structural routing and per-target writes |
| `src/runtime/population.js` | Structured selection, prepared key pages, explicit start, cursor/progress, cleanup and retryable position |
| `test/*.test.cjs` | VM-isolated mocks covering lifecycle, rollup, routing, queued workers and population |

Native runtime: `nodejs24.x`, `arm64`, 256 MB. Relationship/population consumer functions use 300-second timeouts. Current dependencies include `@forge/react`, `@forge/bridge`, `@forge/resolver`, `@forge/api`, `@forge/kvs`, and `@forge/events`; use the repository lockfile. App heading/module title is AutoUp; legacy technical names are compatibility identifiers.

## 2. Identity and installation

For recovery, preserve the `app.id`, environment, admin module key and all persisted namespaces. Do not create a replacement identity and expect existing Forge storage to follow. For intentionally new private installations/apps, resolve site metadata and plan configuration migration; user-visible labels are not portable field IDs. This document intentionally does not embed customer identifiers.

Scopes currently declared: `read:jira-work`, `read:jira-user`, `write:jira-work`, `manage:jira-project`, `storage:app`. No egress, public webtrigger, scheduled trigger or external database is configured. An install upgrade is required if scopes/egress change. A branding-only title change is not proof that the app-user history name has changed.

## 3. Manifest gate contract

All current product triggers set `ignoreSelf: true` and `onError: IGNORE_AND_LOG`. Gate paths use project property `field-orchestrator-runtime-v1`.

| Event | Manifest predicate | Handler |
| --- | --- | --- |
| `avi:jira:created:issue` | project `.active == true` | `handleFilteredIssueUpdate` |
| `avi:jira:updated:issue` | `.active == true` and some changelog `fieldId` in `.fieldIds` | `handleFilteredIssueUpdate` |
| `avi:jira:created:issuelink`, `avi:jira:deleted:issuelink` | `.linkRoutes` contains `issueLinkType.id + ':' + destinationProjectId` | `enqueueRelationshipEvent` |
| `avi:jira:deleted:issue` | project `.relationship == true` | `enqueueRelationshipEvent` |

`projectDependencies` constructs the union across active policies:

- `active`: true when any projected field dependencies/relationship participation exist.
- `fieldIds`: assessment condition dependencies, protected target dependencies, relationship source/structural dependencies and Done-guard status dependencies as applicable.
- `relationship`: participating source or target project of an active relationship policy.
- `linkRoutes`: strings joining link-type ID and opposite project ID; project both endpoint orientations because link-event project properties resolve on the source side.

There are four accessed property paths. These are compact projections, not complete policies. KVS is unavailable inside manifest expressions. Source-event gates cannot evaluate a distant target's status; after routing, Jira Expressions check that target. Creation gates intentionally admit external creation across participating projects, not exact per-rule matches. Reverify Preview property support and event payload contracts before changing this manifest.

## 4. Policy storage and compilation

Core saved schema is described in R03. `validatePolicy` keeps explicit fields, assigns a new revision/timestamp and an inactive state. Validation compares the normalized submitted configuration to the stored revision. For compatibility, absent legacy `skipDoneTargets` is interpreted as false. A frontend preview is not a trusted executable runtime plan.

Activation obtains a single-use 15-minute review. It rechecks current revision, supported type, field metadata, ownership/cycles and applicable runtime restrictions. Relationship activation checks the representative target's editable numeric field and recalculates it server-side; it no longer enumerates all project targets. Assessment activation compiles the tested option IDs/result and a Boolean expression. Date/datetime conditions remain rejected.

Activation publishes the updated project properties, then stores active policies, then consumes the review. Property PUT is a status-only command: empty successful 200/201/204 responses must not be parsed as JSON. HTTP failure still stops activation. This multi-system sequence is not transactional: partial property writes may remain after a later failure. Runtime active/revision checks mitigate but do not repair every partial index state.

Deactivation updates project unions and removes active runtime configuration. Active records cannot be edited/deleted through the normal resolver. Full-array policy writes and some resolver authorization paths require hardening; do not describe page placement as a server authorization guarantee.

## 5. Assessment path

1. Read the saved collection and select active assessments in the changed project.
2. On creation, treat all those policies' dependencies as relevant; on update, use changed IDs.
3. Sort active policies topologically; evaluate only affected policies. Add a written target to the changed set so supported downstream assessments can run within this invocation.
4. Evaluate compiled conditions via `POST /rest/api/3/expression/evaluate` as the app. Done protection uses `issue.status.category.key != 'done'`.
5. On match, fetch only the target field; normalize current/desired values and skip equivalents.
6. For Done-protected policies recheck the guard before writing; PUT only the target field.
7. Retain changed/restored/error outcomes; optional diagnostics can sample no-match/no-change outcomes.

The runtime has no full transactional lock. Assessment events are not serialized by the relationship queue; lifecycle/context/schema checks are less comprehensive than the newer queued workers. These are explicit plan items. `ignoreSelf` prevents later app events, so unrelated downstream policies will not automatically run unless included in the supported in-process assessment path.

## 6. Relationship path

The compiler stores source/target project IDs, link ID, related root types, depth and dependency IDs. `statusCategory` filter dependencies map to `status`; structural dependencies include `parent`, `issuetype`, `project`. Protection adds the target field; Done exclusion adds target status. The diagnostic plan's `activationReady: false` is overridden in the activated runtime copy.

Ingress stores identifiers only: event type, source issue key/project, destination project/link type and changed field IDs. It pushes to `relationship-jobs` with installation concurrency key `relationship-writes-v1`, limit 1 and no artificial delay. An ingress timestamp supports latency measurement.

Dispatch reads active policies and filters to the event's dependencies/projects. For ordinary updates, reverse traversal reads source and up to two ancestors, uses JQL root-type filtering and discovers linked targets. It must not apply value/status filters during reverse routing: a departed contributor still affects its former aggregate. Current reverse routing caps linked targets at 50.

Creation/deletion/link/parent/type/project events discover all targets in the configured target projects in 25-key pages. Each target is queued separately, with continuation pages; there is no ten-target project cap. Broad structural discovery covers removed links/parents without relying on old payload fields, at the cost of more work. Moving outside indexed source scope can still evade delivery.

Discovery merges affected policy references into a durable per-target record and queues a flush. The flush computes all current participating policies, shares identical hierarchy reads, and sends one Jira edit for changed fields. This supersedes the 5.10 first-target-inline optimization. Each target evaluation rechecks policy ID/revision, calculates current desired value, suppresses equality, rechecks active/revision and edit metadata, checks Done when configured and writes only the target. Current lifecycle check is not an atomic fence against concurrent Jira changes. 429/5xx failures are retried; permanent errors are recorded. Queue-dispatch failures are retryable. Repeated delivery can rediscover work, but fresh values suppress already-applied writes.

## 7. Narrow Jira adapter and calculation

`jiraAccess(asUser=false)` uses app context by default and counts requests. It provides:

- Narrow issue reads with explicit `fields`.
- Edit metadata reads for target applicability/editability.
- Boolean `/expression/evaluate`; non-Boolean responses fail.
- POST `/search/jql` with page tokens, explicit fields and incomplete-result detection.
- A 25-key target-page operation and bounded candidate searches.
- Target-field-only PUT.

Jira Expressions expose `issue.status.category`, whereas REST issue data uses `fields.status.statusCategory`; do not interchange these shapes. Project membership comparisons use known project IDs. JQL restricts roots/descendants to source spaces and filters candidates before detailed source-value reads. Allowed runtime filter fields are listed in R06. Each candidate is deduplicated by key; empty sums/count/min/max follow R06. Source hierarchy and request bounds are current safeguards, not hidden partial totals.

A worker adapter caps requests at 250; candidate aggregation caps at 500 and depth at 2. The frontend preview has its own paginated 500-result search guard and ten-row result display. Preview and runtime use different retrieval/typing paths, so parity tests matter.

## 8. Initial population state machine

`population-jobs` uses the same installation concurrency key as relationship jobs. No new product-trigger subscription is needed: preparation/population is an explicit administrator action.

1. `preparePopulation`: verify admin and activation readiness; accept only structured all/keys/date input. Build scoped JQL; Done exclusion is default, and persistent Done protection takes precedence.
2. Create a run and make it the policy's current pointer. Superseded snapshots are queued for cleanup. The run starts `preparing`.
3. Worker discovers 25 keys per page, stores key pages and accumulates count without Jira writes. On completion the state is `ready`; one-hour expiry is measured from creation.
4. Activation must explicitly supply the ready current run ID, matching policy/revision and expiry. Publish active policy first, bind run to its activation timestamp, then start `running`.
5. Worker reads the stored page/cursor, checks current pointer/revision/activation, scope and Done with Jira Expressions. It evaluates only the chosen policy, compares current values, checks editability and rechecks eligibility/lifecycle immediately before PUT.
6. Advance offset/page and counters, persist the checkpoint and enqueue continuation. Complete after all prepared keys. No initial assessment chaining is performed.
7. On error, pause in `error` with resume phase and current key. Admin retry returns to the same position; queue failures are surfaced. Deleted/stale/deactivated/replaced/new-activation runs become cancelled or ignored.

Counters are updated/unchanged/skipped plus a displayed blocked position. If a write succeeds before a storage checkpoint fails, the replay may observe unchanged; no exactly-once accounting claim. Target search is eventually consistent, not an atomic snapshot. New keys appearing after preparation are outside the prepared list; current conditions/Done eligibility are always re-evaluated.

## 9. Storage namespaces

| Namespace / key | Contents and retention |
| --- | --- |
| `field-policies:v1` | Installation policy array, including active compilation; max 100 saved policies |
| `activation-review:v1:<policyId>` | Revision/token/expiry; consumed on activation, superseded on review; expiry checked, not automatic purge |
| `policy-runs:v1` | Latest 50 validation/assessment run records; shared array can lose concurrent history updates |
| `policy-last-run:v1:<policyId>` | Independent latest outcome/time/trace metadata |
| `relationship-run:v1:<policyId>:<0..19>` | Random fixed slots for relationship changed/restored/error records |
| `diagnostics:v1:<policyId>` | Capture deadline/settings; 24-hour enablement |
| `diagnostic-run:v1:<policyId>:<0..19>` | Bounded random diagnostic samples; not guaranteed last 20 events |
| `population-current:v1:<policyId>` | Latest population run ID |
| `population:v1:<runId>` | Policy/revision/activation identity, selection JQL/exclusion, expiry, phase, page cursor, totals, current key/error |
| `population-page:v1:<runId>:<page>` | Prepared target keys (25 per normal page), no field values |
| Jira project property `field-orchestrator-runtime-v1` | Manifest gate projection; delete if no active dependencies remain |

The latest population snapshot persists until replaced; cleanup removes obsolete pages in batches of 25. Policy deletion does not comprehensively purge all related trace/snapshot keys. KVS TTL, orphan cleanup and robust cleanup retries remain planned. Metadata discovery is frontend state, not a portable backup. Preserve namespaces during recovery or supply explicit migrations.

## 10. Observability and capacity

Validation/assessment history plus sampled relationship records are merged and displayed up to 100 rows with paginated UI. Diagnostics read up to twenty slots per policy. Manifest-rejected events cannot emit function diagnostics. Population has its own progress view; it does not create an exhaustive per-target execution ledger.

Current duration/request metrics are useful indicators; UI dollar/operation estimates are not comprehensive billing telemetry. Queue stages multiply invocations. KVS/log use increases with diagnostics and population. Whole-policy scans, shared serial concurrency and target fan-out can limit throughput. Measure API/storage/queue behavior and reverify platform quotas before expanding pilot limits or making weekly-volume claims.

## 11. Known recovery and hardening gaps

- Whole-policy and history arrays are not conflict-safe; project-property publication and Jira writes are not transactions.
- Uniform server administrator authorization, context-aware typed compilation and assessment lifecycle/write parity need review.
- Relationship/assessment mixed chaining, parent inheritance and ordered decisions are not implemented runtime features.
- Out-of-scope moves, missed events and search-index lag require reconciliation and live acceptance.
- Queue continuation/delivery exhaustion, orphan cleanup, snapshot retention and large-target throughput need testing.
- Do not restore the removed ten-target activation restriction or treat the ten-row preview display as a calculation bound.
- Preserve the fix for empty successful project-property responses.
- Restore a backup's schema and source together; a rollback cannot undo already-written Jira values automatically.

## 12. Change discipline and evidence

Maintain requirements, architecture and standalone plan in the same change. Current baseline passed 58 automated tests plus ESLint/Forge lint; only the documented live Story-points-to-JPD update is confirmed. Population and the broader live matrix remain open.

Platform contracts to reverify when changing APIs/manifest: [Jira events](https://developer.atlassian.com/platform/forge/events-reference/jira/), [Jira expression types](https://developer.atlassian.com/cloud/jira/platform/jira-expressions-type-reference/), [Forge async events](https://developer.atlassian.com/platform/forge/runtime-reference/async-events-api/). These sources explain API contracts; they do not certify this implementation.

## Processing latency improvement (2026-09-25)

BUG-001: ordinary relationship updates now calculate the first discovered target for each affected policy inside the existing serialized discovery job. Additional targets and structural scans retain paginated queue jobs. Relationship enqueue operations no longer add an artificial two-second delay. The shared writer lock (including population), revision checks, Done guards, filters and unchanged-write suppression remain. Trace records add `sinceIngressMs` and `beforeJobMs`; these start at Forge ingress, not at the original Jira edit, and continuation timing includes prior processing. Live latency improvement remains to be verified after deployment.

Verification update (2026-09-25): latency simplification deployed privately as development **5.10.0**. All **61 tests**, ESLint and Forge lint passed. Earlier 5.9.0/58-test references describe the reconstruction baseline; live latency comparison remains pending.

## Consolidation storage and failure contract — R17

`relationship-pending:v1:<targetKey>` stores generation token, policy revision/activation references, latest source context per policy, restoration flag, first ingress time, merged-signal count and scheduled timestamp. It stores no source field values. Only `relationship-jobs` workers mutate it under the unchanged installation concurrency key shared with population. Completed/stale/permanently failed batches delete it. Policy count is bounded by existing configuration limits; source identities are replaced, not appended.

Discovery persists a dirty record before enqueue, then marks it scheduled. If enqueue or checkpoint fails, retries can repeat safely. A duplicate flush checks its generation token; a successful PUT followed by failed cleanup retries from current values, suppressing duplicate writes. A later admitted event requeues records whose scheduled timestamp is over five minutes old. This is event-driven recovery, not a scheduled repair service; exhausted queue retention with no later event remains an operational gap.

A flush uses current active policies whose revisions and activation timestamps match its references. All calculations and ownership/editability checks precede the PUT. Fresh Jira Expressions check scope/Done and KVS rechecks lifecycle. The guard/read/write sequence is not an atomic transaction with external Jira edits. Permanent failures are logged for all participating policies without writing a subset; a later event can retry fresh. Transient API and storage failures retain the dirty record and propagate for queue retry.

Pending consolidation is opportunistic: no FIFO or debounce assumption, and no artificial delay. New source events already queued during a flush are routed afterward and create/merge follow-up work. Old target jobs from the previous version are converted to pending work. Initial population remains separately consented, one-policy work; assessments retain their separate runtime.

Trace `batchId`, `batchPolicyCount`, `mergedSignals`, and `requestCountScope: shared-target-batch` identify one shared request count repeated on per-policy records. `beforeJobMs` includes prior discovery/queue time and `sinceIngressMs` starts at app ingress, not the original Jira edit. Neither field is an exact pure queue-wait measure. Discovery still costs requests per event; the 100-signal simulation demonstrates calculation/write reduction, not elimination of event invocations.

Platform contracts checked against [Forge async events](https://developer.atlassian.com/platform/forge/runtime-reference/async-events-api/) and [Jira issue edits](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/): the concurrency key spans queues within an installation, and an issue edit accepts a fields map. No new scopes, triggers, or installation upgrade are required.

Rollback: stop/deactivate affected policies and drain pending work before reverting to a worker that does not understand `flushTarget`. Do not blindly roll back while new-format queue messages remain. Forward recovery is preferred; deployment does not toggle policy status.

R17 release evidence (2026-09-25): deployed privately to development as **5.11.0**. All **73 automated tests**, ESLint and Forge lint passed. The controlled 100-distinct-source pending burst produced one target calculation/write; two policies produced one fields-map edit. Live combined-history and burst-capacity acceptance remain pending. GitHub destination/payload approval resolved by the owner on 2026-09-25; implementation commit 2628824 successfully pushed to origin/main.
