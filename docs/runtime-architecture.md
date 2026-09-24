# Runtime architecture

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


## Current correction and source routing — September 24, 2026

This section supersedes earlier link-payload blocker notes. The official Jira events reference explicitly documents issueLinkType.id (a string) for both created/deleted issue-link events. The prior conclusion that link-type filtering was impossible was incorrect. Project-property filtering remains source-side, so a future active link index must cover both configured endpoint project scopes. No relaxation of the manifest-first rule is required on account of the link-type ID.

Implemented locally, not deployed: a pure relationship-plan compiler maps statusCategory dependencies to status, collects source/target scopes and protected-target dependencies, and records both endpoint project scopes for future indexing. The administrator-only traceRelationshipSource resolver reads the saved revision asUser, walks up to two ancestors with narrow fields, asks Jira to filter root types and target projects, and reports affected target keys. It does not filter out a source because it left a condition. The editor exposes Trace saved policy from source. Routing is limited to 50 targets and three ancestor reads plus up to two searches (and one administrator permission request, excluded from displayed data-request count). Incomplete pagination, cycles and out-of-scope sources fail explicitly. It traces current visible links only, not historical parents/deleted links.

Runtime activation remains disabled because full handlers, old/new structural coverage, compiled index persistence, concurrency-safe writes and end-to-end acceptance are unfinished—not because a link-type ID is missing. No manifest subscription, activation or Jira field write was added in this slice. Next: persist/project the compiled indexes; implement filtered link and structural event paths; invoke reverse routing and recalculation with safe target writes.

Official source verified September 24, 2026: https://developer.atlassian.com/platform/forge/events-reference/jira/#issue-link-events (IssueLinkType type reference and payload example); https://developer.atlassian.com/platform/forge/events-reference/product_events/#filtering-by-entity-properties .

## Earlier delivery records (see correction above)

Last reconciled with `manifest.yml` and runtime source: 2026-09-23.

Field Orchestrator uses a fail-closed event pipeline. Jira should discard an irrelevant event before Forge starts a function.


## Private no-code runtime boundary

The runtime executes typed policy data compiled by the administrator UI. It is a small, site-local rules engine, not a general-purpose ScriptRunner replacement. Policies can express supported conditions, Jira Expressions, relationship traversal, hierarchy limits, calculations, target schemas, protection, and priority. They cannot upload JavaScript, call arbitrary URLs, read Forge storage from a Jira Expression, or introduce an unbounded loop.

The compiler is the safety boundary:

1. Validate the policy schema and target field context.
2. Resolve every source, target, relationship, and structural dependency to stable IDs.
3. Compile Boolean gates to Jira Expressions where Jira can evaluate them.
4. Project the dependency union into Jira project entity properties used by manifest filters.
5. Reject missing trigger coverage, unsupported data dependencies, overlapping target ownership, cycles, and bounds violations before activation.
6. Store the compiled plan with the policy revision so a runtime event never interprets UI-only fields.

A policy that cannot be compiled into this plan remains a preview-only draft and must explain the missing adapter or platform limitation.

## Scale target and quota controls

The private MVP is designed around a target of 100,000 changed work items per week in one site. This is a capacity target for the architecture, not a guarantee about Forge quotas or customer billing. The relevant load is the number of events that pass the manifest filter, not the number of fields listed in the editor.

The implementation must enforce these controls:

- One manifest-qualified event creates one runtime invocation. Changed fields are coalesced before policy evaluation.
- The project dependency index routes the event to affected policies; inactive and unrelated policies are not scanned.
- Jira Expressions perform Boolean gates with small results. Full issue reads are reserved for values or graph traversal.
- Every calculation has explicit limits: ten conditions and related-work filters per policy in the current schema, hierarchy no deeper than grandchildren for the current relationship design, bounded candidate traversal, and ten displayed candidates in the UI.
- A normalized no-change result skips the Jira write and does not create a per-event KVS history record.
- Change, restore, error, conflict, cycle, and permission outcomes retain concise traces. High-volume no-change outcomes use counters or sampling, and Last run updates are coalesced.
- KVS writes use revision checks and idempotent keys where an operation can be retried. Concurrent policy/index updates must not erase another administrator's change.
- The UI reports response time, Jira request count, trace ID, and the applicable allowance category. It does not claim an exact dollar cost when the platform does not expose one.

## Compiled policy plan

The durable plan for an active policy contains:

- `policyRevision` and lifecycle status;
- selected project IDs and, for relationship policies, every source project whose changes can affect the target;
- condition, source, target, filter, relationship, hierarchy, and protection dependency IDs;
- a Jira Expression for Boolean gates when supported;
- a schema-normalized target writer;
- bounds, no-match behavior, and priority;
- trace and last-run policy.

Only this compiled plan is read by the event handler. An active policy revision is immutable. Editing creates a new draft revision and removes activation eligibility until validation and activation review complete again.

## Structural event coverage

Field updates use the changed-field dependency union. Work-item creation has a separate filtered trigger because it has no changelog. Hierarchy inheritance requires parent/child structural coverage. Relationship rollups require source-project scope plus separately filtered issue-link create/delete events and relevant issue updates. A policy cannot activate while one of those event paths is missing.

- Live validation now calls the shared evaluator after Jira-side filtering. The event handler does not call it; automatic relationship processing remains blocked by the trigger limitation below.

The first relationship implementation will use the ABC-123 pattern as its acceptance case: a JPD target field rolls up Story Points from linked Jira Features through the configured `implements / is implemented by` link, traversing children and grandchildren and filtering candidates by Status category. Empty Story Points contribute zero, and an unchanged total produces no write. The runtime must discover source projects during configuration, project their dependency index, and recalculate on source-value, status, parent, and link changes.

## Protection and conflict model

`ignoreSelf` is event-wide. It rejects the later product event created by any app-generated target write; it is not a per-field switch. Valid downstream derived-field policies therefore run in topological order within the original invocation. Protection adds the target to the dependency union so an external target edit can be restored, while the app's own restoration cannot re-enter the runtime.

Activation rejects direct self-dependencies, indirect cycles, chains deeper than ten policies, and overlapping active writers for the same target and project scope. Ordered decision policies are the supported way to express several outcomes for one protected target; independent writers are never resolved by timing or “last write wins.”

## Private installation and data boundary

All policy, metadata, activation, trace, and quota state is scoped to the installing Atlassian site. No runtime path crosses sites. The app uses the minimum Jira and Forge scopes needed for the configured capabilities and does not put customer policy data in GitHub. Export/import, backup, and migration are future administrator features and must preserve site-specific IDs and require revalidation on the destination site.


## Event path

1. A Jira project property records whether Field Orchestrator has an active dependency index for that project and contains the small list of field IDs that can affect active policies.
2. The product trigger in `manifest.yml` checks that property and the issue-update changelog. Forge invokes the function only when at least one changed field is in the dependency list.
3. `ignoreSelf: true` prevents the app's own Jira updates from recursively invoking the runtime.
4. The handler receives an already-qualified event. It must not repeat the manifest gate as a JavaScript early return.
5. Jira Expressions REST API v3 evaluates supported Boolean conditions in Jira and returns a small result. REST issue reads are reserved for values and graph traversal that Jira expressions cannot provide.
6. The runtime suppresses unchanged writes and records a bounded execution result.

`ignoreSelf` applies to the entire app-generated issue-update event. It is not scoped to one target field. Therefore, derived-field chaining is completed inside the original qualified invocation rather than waiting for another product event.

The first runtime pilot implements this path for field-assessment policies. Hierarchy and relationship policies remain read-only because their structural event coverage is incomplete.

## Dynamic policy boundary

The manifest is fixed at deployment time, while policies are created at runtime. Forge trigger expressions cannot access Forge KVS, Forge SQL, or an external database. Active dependency data therefore has to be projected into supported Jira entity properties before a policy can be activated.

The first runtime gate uses the project entity property `field-orchestrator-runtime-v1`:

```json
{
  "active": true,
  "fieldIds": ["status", "customfield_10016"]
}
```

The manifest reads only the primitive `active` value and primitive `fieldIds` array. Activation writes the union of active assessment dependencies. Deactivation rewrites that union and removes the property when the project has no active dependencies.

The recovered manifest handles assessment updates and creation with separate filters. The recovery code still requires deployment and live-site acceptance testing. Deletion, cross-project parent effects, and link events remain incomplete.

## Dependency routing and no-change suppression

- `fieldIds` is the union of fields that can affect an active policy in that project. It contains condition fields, source fields, filter fields, and structural fields such as Status or Parent when the policy depends on them.
- A target field belongs in the dependency index only when external-override protection is active or when another policy explicitly uses that field as an input. Merely being a derived target does not make it a trigger dependency.
- One Jira update containing several relevant changelog items produces one qualified Forge invocation. It must not create one invocation per configured field.
- After the manifest gate, the runtime uses the changed field IDs to select only affected policies from a precompiled dependency index. It must not scan or evaluate every policy in the installation.
- A qualifying source-field change can calculate the same derived value that is already stored. The runtime still has to calculate enough to establish equality, but it must normalize values by Jira field schema and skip the Jira update when the current and calculated values are equivalent.
- `ignoreSelf: true` is the first recursion barrier. Every Jira product trigger that can observe app writes must use it.
- No-change suppression is the second recursion and cost barrier. The app must never write an equivalent target value.
- Idempotency is the final barrier. A retry or duplicate event for the same policy, affected item, dependency state, and calculated value must not create another write or execution side effect.
- Protection reacts only to external target changes. A restoration write made by Field Orchestrator is self-generated and must be rejected by the manifest before another invocation.
- In the assessment pilot, a protection event restores the configured result only when the Jira expression still matches. A no-match condition is a deliberate no-op because the current policy schema has no default result.
- Before activation, the app builds a directed graph for each selected project. An edge exists when one active policy writes a field consumed by another active policy. Direct self-dependencies, indirect cycles, and chains deeper than 10 policies are rejected with the policy path.
- At runtime, policies are sorted topologically. When an upstream policy writes a changed value, its target field is added to the invocation's in-memory changed-field set so downstream policies can run once in dependency order. This does not bypass the manifest gate: the original external event must first qualify through the project property filter.
- Each policy runs at most once per invocation. Equivalent values add no downstream change, and failed writes do not advance the chain.
- Numeric aggregation treats a missing source value as non-contributing. A newly created matching Story with empty Story Points leaves the aggregate unchanged and therefore produces no target write.
- Source-value changes, configured filter-field changes such as Status, Parent changes, and relevant issue-link changes are separate dependency categories. Each category needs a manifest-filtered event path before its policy type can activate.
- Issue creation has no update changelog. A separately filtered `avi:jira:created:issue` trigger is required so a Story created with Story Points and a qualifying status is not missed. This trigger must fail closed using project activation properties and event fields available to the manifest; it must not be replaced with an unfiltered JavaScript gate.

For 20–30 configured dependency fields, the relevant cost driver is the number of Jira update events whose changelog intersects the project-level dependency union. The number of configured fields does not independently multiply invocations.

## Multiple outcomes for one protected target

A target such as Field X may depend on several source fields and produce a different value for each condition. This must compile as one ordered decision policy:

1. The manifest dependency union contains every source field used by a case.
2. The runtime routes a qualifying update to the single decision policy for X.
3. Jira-expression-compatible case conditions are evaluated in priority order, and the first match determines X.
4. A protected policy must define a deterministic default or no-match action.
5. The current value and computed value are normalized by field schema. Equal values produce no write.
6. When an external actor changes X, X is a manifest dependency for the protected policy. The policy recomputes from A/B/C and restores X only if necessary.
7. The restoration event is app-generated and is discarded by `ignoreSelf: true`, preventing a loop.

Independent active policies must not compete to write the same target in overlapping scope. Activation must either consolidate them into an ordered decision policy or reject the conflict with an explanation. The editor does not yet implement ordered cases.

The pilot implements the rejection path: only one active policy may own a target field in an overlapping project scope. Ordered decision policies remain pending.

## Known limitations

- Entity-property event filtering is an Atlassian Preview feature. Values can be a few seconds stale, and unresolved paths evaluate to `null`.
- Forge permits at most five distinct entity-property paths across trigger definitions.
- A relationship rollup can be affected by work in projects other than the target JPD project. Activation must know and index every source project; target scope alone is insufficient.
- Issue-link create/delete events have a different payload from issue updates. They need their own manifest expression, including the configured link-type IDs, before relationship policies can react to link changes.
- Jira expressions cannot read Forge storage or arbitrary external data. Such rules remain drafts unless their gate can be projected into a supported Jira entity property or encoded statically and deployed.
- Product-trigger delivery is asynchronous and can be delayed. The runtime must be idempotent and recalculate from current Jira state rather than trust event ordering.

## API rule

Use `POST /rest/api/3/expression/evaluate` for Jira-expression checks. Do not use the deprecated `/rest/api/3/expression/eval` endpoint. Ask Jira to return a Boolean whenever the decision is Boolean, and avoid full issue REST responses used only for gating.

The draft preview currently uses user-context Jira REST requests because it must display source values, hierarchy, linked items, and calculated results. Runtime Boolean gates must use Jira expressions where supported; value retrieval and graph traversal may use narrow REST field selections when an expression cannot return the required calculation data.

For assessment targets whose schema is `option` or an `array` of `option`, draft validation requests `/rest/api/3/issue/{key}/editmeta`. The target must exist in that work item's editable field metadata, and every configured option must match an allowed ID or value. A text match alone is insufficient evidence that Jira would accept the write. Runtime activation must compile the selected option IDs per applicable field context and revalidate configuration drift without fetching a full issue object.

The assessment editor uses the same edit metadata to populate its result control. It renders a single-choice picker for `option` and a multi-choice picker for `array` of `option`; free-text controls remain for non-option schemas. Because option sets can differ by Jira context, the administrator supplies a representative work-item key before loading choices.

Administration metadata merges `GET /rest/api/3/field` with paginated `GET /rest/api/3/field/search?type=custom`. Jira documents that `/field` omits fields not associated with a used screen or field configuration; custom-field search ensures newly created fields remain discoverable. Selection does not bypass context or editability checks required before activation.

Draft validation measures client-observed elapsed time and counts its Jira REST requests. These are diagnostic indicators, not an invoice calculation. The validation path does not invoke the product-event runtime and performs no Jira write.

Saved-policy validations receive a `fo-...` trace ID. The latest 50 records are retained in Forge KVS under `policy-runs:v1`, shown in Executions, and logged by the backend resolver with the same trace ID. Unsaved-policy validation is not retained. Runtime changes, protection restorations, and errors use `fo-runtime-...` trace IDs in the same bounded history. Equivalent and no-match runtime outcomes are neither stored nor logged.

Manual validation displays its result before starting trace persistence, so the extra resolver and KVS operations are outside the calculation's critical path. At runtime, full traces must be retained for changes, protection restores, loops, and errors. High-volume no-change outcomes must be aggregated or sampled, and per-policy Last run metadata must be coalesced. A KVS history write for every qualifying event is prohibited because it would add latency and storage cost without equivalent diagnostic value.

Forge log writes are metered. As of the last documentation reconciliation, the app-level monthly allowance is 1 GB and overage is priced per additional GB. Validation therefore reports the small log operation as part of its quota-based estimate, and runtime logging must remain structured, concise, and sampled for high-volume no-change outcomes.

## Documentation synchronization

Any change to triggers, filters, entity-property paths, scopes, APIs, lifecycle states, writes, retries, execution history, or quota controls must update this document and `docs/requirements.md` in the same change. Scaffolded behavior must remain labeled separately from active behavior.

## Recovery and editor lifecycle — September 23, 2026

Recovered locally; not yet deployed or live-site acceptance tested:
- Saves assign a fresh revision and clear activation eligibility. Successful validation must match the saved revision and configuration; failures revoke eligibility.
- Activation review returns a single-use token with a 15-minute expiry, dependencies, scope, chain neighbors, and estimates of 1/2/3 Jira requests for no match/no change/change. Activation rechecks the configuration and dependency graph.
- Separate creation trigger uses the active project property and ignoreSelf. All assessment dependencies in that project are evaluated on creation because there is no changelog. This means one invocation for each external creation in an active project, even when conditions subsequently do not match.
- Protection traces classify restoration only when the original external changelog includes the protected target.
- Save draft stays in the editor. Save & validate saves first and tests the returned snapshot. After validation retention and readiness review succeed, Activate becomes available in the editor. Active policies can be opened and deactivated there; edits are blocked until deactivation. Back to policies replaces Cancel.
- Existing fields, option pickers, project filters, assessment conditions, hierarchy and relationship previews, bounded results, and execution history are preserved. Ordered outcomes and automatic hierarchy/relationship processing remain pending.
- Concurrent KVS array updates, cross-context option validity, and live expression compatibility still require acceptance/hardening; passing local mocks is not production certification.

## Source-scope and evaluator integration — September 23, 2026

Implemented locally; not deployed:
- Relationship policies persist separate source project IDs. The editor selects source spaces explicitly; legacy drafts require that selection before testing. Selection is manual, not automatic discovery.
- Target scope identifies the work item receiving the derived value; source scope restricts linked roots and every traversed descendant through Jira JQL. Descendants outside source scope do not contribute and are not traversed.
- Live relationship tests now use the shared calculation module after Jira applies configured filters in JQL. No extra product trigger or event invocation has been added.
- Search pagination and the combined hierarchy fail validation above 500 items. The evaluator rejects excessive depth/candidates rather than certifying a partial total. Duplicate work-item keys contribute once, invalid numeric values fail, conflicting copy values fail, union preserves typed objects, and empty min/max results are null.
- Relationship activation remains blocked in the resolver and editor. The documented link-event payload has source/destination issue and project IDs, but no link-type ID. Entity-property filtering on link events resolves the source side only. Consequently the previously planned dynamic link-type manifest filter cannot be built from documented data. No broad event subscription has been substituted.
- Automatic rollups require a revised, explicitly accepted trigger contract (for example source-project/pair filtering with relationship resolution after invocation), or a platform-supported link-type projection. Creation/deletion, old/new parent effects, permission/context checks, concurrent target writes and recovery must also pass acceptance tests before enabling writes.

References: [Jira link events](https://developer.atlassian.com/platform/forge/events-reference/jira/#issue-link-events), [entity-property event filtering](https://developer.atlassian.com/platform/forge/events-reference/product_events/#filtering-by-entity-properties).

## Temporary per-policy telemetry — September 24, 2026

Implemented locally, pending deployment and live acceptance:
- Policies have a Diagnostics action opening a policy selector in Executions. A Jira administrator can enable capture for 24 hours, turn it off, refresh, or turn it off and clear. Enabling does not change the policy revision or activate a draft. Default is off.
- Captures no-match, unchanged, successful write, evaluation error, unrelated dependency, and invalid dependency graph outcomes for runtime events that reached the handler. Draft/unsupported configurations have no runtime processing; their existing manual validation traces remain available.
- Captures policy revision, event type, work-item key, changed field IDs, duration, Jira request count and correlation trace. No field values or full event bodies are included in diagnostic records.
- Uses separate per-policy settings and 20 randomly selected fixed record slots per policy. This is a bounded sample, not the last 20 guaranteed events or an exhaustive audit. Concurrent records can replace a slot, but diagnostics never rewrite policy configuration. Existing execution history remains separate.
- Capture expires after 24 hours; stored records persist until cleared or overwritten. Clearing disables capture and deletes all slots; an already-running capture can still finish. Deleting a policy does not yet purge diagnostic keys.
- Each scoped active policy checked by an admitted invocation adds one settings KVS read, even with diagnostics off. Enabled outcomes add one record write and one concise Forge log. Viewing records reads up to 20 slots. No new Jira product subscriptions or diagnostic Jira reads are added to runtime processing.
- Diagnostic persistence failures are swallowed and cannot turn a successful calculation/write into a runtime failure. Handler crashes before recording are visible only in platform logs. Manifest-rejected and ignoreSelf-rejected events cannot be observed by the function; absence of a record is not proof an event never occurred.
- Relationship-trigger architecture remains unresolved; this telemetry change does not authorize a broader link subscription or enable relationship writes.

## Development deployment — September 24, 2026

Forge CLI successfully deployed version 5.4.0 to the private development environment from source commit 68fb2cc. The existing development Jira installation was confirmed on app major version 5. No new scopes were introduced by the telemetry changes. All 25 local tests and Forge lint passed. This supersedes earlier pending-deployment notes for the recovered assessment runtime, source-scoped relationship preview and temporary diagnostics; live-site behavior has not yet been acceptance tested. Relationship and hierarchy automatic writes remain unavailable.

Acceptance sequence: in a dedicated test project, configure a field assessment using a numeric custom source equal to 11 and a text target set to Ready, with protection enabled. Save and validate, activate, enable Diagnostics for 24 hours, change source from 0 to 11, then verify the target and refresh diagnostics. Overwrite the protected target while source stays 11 to test restoration. Set source to 0 to test no-match behavior (target is not cleared). Deactivate and verify later changes are not processed. Validation and activation do not backfill existing work items.

## Live target-update acceptance — September 24, 2026

The next delivery milestone is automatic relationship rollup into the configured Jira/JPD target field. A passing preview, a would-change trace, telemetry being enabled, or a successful deployment does not satisfy this milestone.

Implementation order:
1. Compile explicit source and target project dependencies and route relevant source changes to affected target items. Keep available project/changed-field gates in the manifest.
2. Complete event coverage: point/filter changes, creation, old/new parent moves, deletion, and link creation/removal. Resolve the documented link-event filtering limitation before enabling the full policy type. No exception to the strict filter contract has been approved.
3. Recalculate from current Jira state with bounded traversal and Jira-side candidate filtering. Deduplicate items, exclude empty numeric values, and fail on incomplete totals.
4. Verify target schema/context and permissions; serialize competing writes, handle retries, compare normalized values, then update only changed totals. Account for app-originated downstream dependencies without event recursion.
5. Enable activation only with complete event coverage, revision-bound validation and conflict/cycle checks. Prove the result on the actual target, and retain runtime evidence.

Acceptance fixture: target ABC-123 in the selected JPD space, one matching linked root and child with 3 points. Change the child to 11 points without running manual validation. The selected JPD field must rise by 8. Check the target's actual history and correlated runtime trace. Then test entering/leaving the status filter, empty values, unrelated edits, parent moves, link removal, issue deletion, duplicate delivery, protection and deactivation. Verify old and new affected totals for structural moves. Do not mark runtime delivery Done without recorded live evidence.

Current delivery: development 5.4.0 includes manual relationship validation and assessment runtime plus diagnostics. Automatic relationship/hierarchy writes remain unavailable; live acceptance is pending. Jira tracking references and reconciled statuses are in docs/jira-progress.md.
