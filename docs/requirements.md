# AutoUp — product requirements

Baseline: private development release **5.9.0**, source commit **5f872dd**, reconciled with source on **2026-09-24**. The last application change passed 58 automated tests, ESLint and Forge lint. Documentation changes do not imply a new deployment.

This is the current product specification. [plan.md](../plan.md) is the independent implementation and rebuild checklist; [runtime-architecture.md](runtime-architecture.md) describes the current technical contracts. These documents require neither Jira tickets nor this conversation to interpret. Earlier accumulated requirements are preserved in [the historical archive](history/requirements-before-reconciliation-2026-09-24.md) and are not the current specification.

## 1. Purpose and boundaries

AutoUp lets Jira and Jira Product Discovery administrators configure derived field values in one place, with readable rules, live previews, automatic recalculation and optional restoration after an external override. It provides a focused no-code alternative to maintaining many field-related automation rules or scripts. It is not a general scripting engine or a replacement for all ScriptRunner capabilities.

- Install privately on individual sites; no public Marketplace distribution unless the owner explicitly decides otherwise.
- Use real Jira metadata and stable IDs; do not embed a development site's fields, keys, projects or account details in the UI or reusable examples.
- Prefer custom target fields. Source conditions can use system or custom fields. A field appearing in a selector is not proof that every project context can read or edit it.
- Only the configured target field is written by a policy evaluation. Existing unrelated fields must not be changed.
- Use native Forge UI Kit, Jira REST/JQL and Jira Expressions. Arbitrary scripts, arbitrary user-supplied JQL, external data lookups and external integrations are outside the current editor.
- Product name is **AutoUp**. The heading and Jira admin navigation are renamed. The Atlassian developer-console name and history actor identity have not been verified as renamed; do not promise the actor label is already AutoUp.

## 2. Status and evidence

**Implemented** means present in the baseline source and deployed, not necessarily exhaustively tested on a live site. **Preview only** means the UI can calculate a result but activation is unavailable. **Pending** means required work remains; **Deferred** is intentionally outside the current MVP.

| Capability | Current delivery | Live evidence / limitation |
| --- | --- | --- |
| Metadata discovery, unified Policies editor, persistent drafts | Implemented | Used interactively; large catalog limits remain |
| Assessment rules, activation, restoration, assessment chains | Implemented | Automated coverage; full live acceptance matrix pending |
| Numeric linked-work rollups into Jira/JPD | Implemented | User confirmed a Story points edit updated an actual JPD target; broader structural cases still need live evidence |
| Relationship copy / unique union | Preview only | Numeric runtime accepts sum/count/min/max only |
| Direct child-to-parent inheritance | Preview only | Fix Version propagation is not automatic yet |
| Optional initial population and Done-target protection | Implemented in 5.9.0 | Automated coverage; live acceptance pending |
| Last run, validation history, temporary diagnostics | Implemented | Sampled diagnostics are not an exhaustive audit |
| Ordered cases producing different values for one target | Pending | Independent active writers for the same target and overlapping projects are rejected |
| Durable reconciliation, production-scale concurrency and throughput certification | Pending | Current code is a private pilot |
| Atlas Goals/KRs, OKRs and pull-request integrations | Deferred | No integration or activation support |

## 3. Administration and discovery

### R01 — Unified policy management

Provide **Policies**, **Executions**, and **Settings**. Do not reintroduce separate Fields and Configurations tabs that lead to the same editor. The policy list shows name, target, type, target-space count, protection, lifecycle state, last run and last change. Support search by policy or target, creation, editing, diagnostics and confirmed deletion. Active policies must be deactivated before editing or deleting.

Use grouped cards, compact side-by-side inputs, clear color/status cues, explanatory summaries and contextual help. Conditions and filters use a small end-of-row remove button. Generic key placeholders use `ABC-123`. Unsupported runtime features must not appear to be active merely because they have a form.

### R02 — Real metadata and target controls

Discover projects/spaces, product type, project category, system/custom fields, field schemas, relationship types and available root work types. Merge general field discovery with paginated custom-field search so newly created fields can appear. Provide **Refresh Jira metadata**. Sort custom fields prominently and show stable field IDs; distinguish system and custom fields.

Target-space selection can filter by product/type and category without discarding selections. Source spaces for relationship policies are selected separately and explicitly. Current root-type metadata excludes subtasks.

Use relationship descriptions users recognize (for example, **implements / is implemented by**) rather than only the internal link-type name. Store the link-type ID. The current relationship policy matches either direction; there is no outward/inward selector.

For assessment option targets, load allowed values using a representative work item's edit metadata. Single-select allows one option; multi-select allows multiple. Text fields retain text entry and numeric fields numeric validation. Reject invalid option values. Current drafts persist comma-separated labels and compile option IDs from the tested context; labels containing commas and multiple contexts need hardening before broad use.

## 4. Policy contract and lifecycle

### R03 — Durable policy schema

A policy has a stable ID, name, target field, target project IDs, behavior type, revision and timestamps. It additionally stores:

- Assessment: AND/OR mode, conditions (`fieldId`, operator, value), configured result.
- Relationship: source project IDs, link-type ID, related root issue-type IDs, hierarchy depth, source field, aggregation and related-work filters.
- Hierarchy preview: source field and copy/union aggregation; the direct parent is the target.
- `protect`: restore a computed target after an external override when a deterministic result exists.
- `skipDoneTargets`: leave a Done target's configured field unchanged. Defaults false for compatibility; not implicitly enabled on existing policies.
- Validation metadata: validated revision/key/value and trace information.
- Active runtime metadata: compiled dependencies and expression or relationship plan, target schema, activation timestamp.

See the architecture document for storage keys and exact source ownership. Runtime compilation is backend work; arbitrary frontend objects are not executable policies.

### R04 — Save, validate, activate, deactivate

1. **Draft:** editable and inactive. Saving creates a new revision and revokes prior validation.
2. **Save & validate:** saves first, reads Jira as the user, calculates the preview, records the revision-bound result; never writes a Jira work item.
3. **Validated / ready to activate:** a successful preview is followed by server activation checks. A single-use review token expires after 15 minutes. Validation and activation readiness are distinct; show actionable failures.
4. **Active:** requires the current review token and successful backend checks. Publish the project dependency projections before recording active state. Only implemented policy types can activate.
5. **Deactivated:** retains configuration and validation history, removes active dependencies and stops pending work when observed. An already in-flight Jira write may finish.

There is no separate implemented policy Paused or Retired lifecycle. Population jobs have their own states. Never equate a preview's `would-change` outcome with a real write.

## 5. Calculations and ownership

### R05 — Field assessment

Combine conditions with AND or OR. Operators are equals, does not equal, is empty and is not empty. If they match, set the configured target value; if none match, leave the target unchanged. There is no fallback/default outcome in the current schema.

Compile supported conditions to Jira Expressions and resolve option targets to typed option IDs. Numeric comparison/target values must be finite. Date and datetime target inputs have basic guidance/validation; date/datetime condition comparisons cannot activate. Do not describe date arithmetic or full timezone validation as implemented.

Object-valued system fields and schema variations are not universally covered by the current condition compiler. The rebuild must retain explicit unsupported cases and add parity tests rather than assuming any selectable field can be compared as plain text.

### R06 — Relationship rollups

Select target projects, source projects, relationship type, root work types, and root-only / children / children-and-grandchildren traversal. Root types filter linked entry items, not all descendants: Tasks and Stories beneath a Feature may both contribute unless additional filters exclude them.

Traverse source-scoped roots and descendants. Deduplicate candidates by key. Push supported candidate filters into Jira JQL before fetching source values. Filters are combined with AND; current operators match R05. Status category is derived from Status. Current runtime supports custom fields plus status, statusCategory, issuetype, priority, resolution, labels and assignee when Jira supports that comparison.

- **Sum:** total finite numeric values; empty values contribute zero. No matching values yields zero.
- **Count:** count matching candidates, including candidates without a source-field value.
- **Minimum / maximum:** ignore empty values; no numeric values yields null.
- **Copy (preview):** accept a single unambiguous present value; distinct values are an error.
- **Unique union (preview):** preserve distinct values with their typed representation.

Only sum/count/min/max into an editable numeric target can activate. Source must be numeric except for count. Never save a truncated or nonnumeric aggregate as though it were complete.

### R07 — Hierarchy inheritance

Current preview reads a child source and calculates a value for its direct parent using copy or unique union. Automatic propagation, including Story Fix Version to parent, remains pending. Future implementation must handle conflicting siblings, version contexts, missing parents and parent moves; it must not silently invent a merge strategy.

### R08 — Protection, conflicts and cycles

`ignoreSelf` rejects app-originated product events globally; it is not restricted to the target field. To avoid losing legitimate assessment dependencies, current-event assessment chains are evaluated in topological order inside the handler, propagating changed target IDs internally. No-match/equivalent outcomes produce no writes.

Reject direct and indirect assessment cycles and chains deeper than the current supported bound. Reject competing active policies writing the same field in overlapping target projects. Relationship-to-relationship and relationship-to-assessment chaining is not supported and is rejected.

Protection is **eventual restoration**, not a Jira field permission lock. Assessment restoration only occurs while conditions match; otherwise leave the external value. Relationship restoration recomputes the current total. Done-target protection takes precedence over restoration.

### R09 — Ordered decisions (pending)

Support the requested case where field A implies one value for X, field B another, and X is protected. Implement one target-owning policy with ordered cases, visible precedence, overlap diagnostics and deterministic first-match behavior. Require an explicit no-match choice (leave unchanged or a typed default), explain what can be restored, and test all cases. Do not implement this through competing independent writers. Multi-select add/remove/replace semantics must be explicitly chosen before adding partial-value ownership.

## 6. Runtime events and scale

### R10 — Event coverage and recalculation

- External creation in an indexed active project is admitted through the manifest; assess matching policies and reconcile relationship targets as applicable.
- Updates are admitted when changed field IDs intersect the projected dependencies. Source points/filter/status changes must also recalculate when a source **leaves** a filter.
- Filter link creation/removal by link type and endpoint projects in the manifest; project properties cover both link orientations.
- Deletion and parent/type/project structural changes use paginated target reconciliation to account for removed contributions. Source updates otherwise reverse-route through the current hierarchy to affected targets.
- Empty points need not change a sum, but count and structural rules may still need evaluation. Skip unchanged totals after calculation.
- Moves into unconfigured source projects may miss the project gate; deletion/reparenting correctness depends on delivered events and current search visibility. These are explicit acceptance and reconciliation gaps, not guarantees.

### R11 — Architecture and performance requirements

Every product trigger must have `filter.expression`; use `ignoreSelf: true` for app-writing flows and fail closed on filter errors. Prefer supported payload/entity-property checks before invocation. Use `POST /rest/api/3/expression/evaluate` for Boolean field/status checks; use JQL and narrow REST reads for graphs, values and edit metadata. Never fetch full issue objects solely for Boolean checks.

KVS/external databases are inaccessible inside manifest/Jira expressions. Project supported dependencies into small Jira properties and name any unavoidable post-routing checks, such as a distant target's Done state. Existing creation gates are project-level, not exact per-rule value gates.

Process large target scopes in pages/queued work; the **ten-row preview limit must never become a ten-target processing or activation limit**. Suppress equivalent writes, serialize queued relationship/population work, re-read lifecycle/current values, and expose incomplete results. These controls do not imply atomic writes, guaranteed event ordering or complete concurrency safety.

The current handler still reads the saved-policy collection and selects relevant policies; a fully indexed no-scan runtime is pending. Queued relationship/population work uses multiple invocations. Do not claim one invocation per entire source event or guaranteed zero cost.

## 7. Optional initial population

### R12 — Choice and consent

Default to **Future changes only**: activation schedules no initial population. A later qualifying event can still change an existing target according to the policy.

Alternatively choose **selected target keys**, **target creation-date range**, or **all eligible targets** within the configured target spaces. Dates are inclusive and use Jira query timezone. Keys outside scope/visibility and targets excluded by Done settings are not selected. Do not accept arbitrary JQL.

**Prepare target list** is read-only: asynchronously discover app-visible keys in pages and show the count. The list is fixed once prepared; values/conditions are not frozen. Require completed preparation for the current policy revision and explicit activation with that list. Selection changes require preparing again. Show that only the configured target field may change and equal values will be skipped.

Initial population excludes Done targets by default. An explicit checkbox may include them unless persistent Done-target protection is enabled. Population mode never silently changes future-event scope or protection settings.

### R13 — Processing, progress and recovery

Support both assessments and numeric relationship policies. Check target scope, conditions, schema/editability and current values at processing time. Recheck Done eligibility immediately before writing. Initial population of an assessment changes only its selected target field; it does not cascade into other policies.

Preparation expires after one hour. Population uses a persistent cursor and one target per job; show preparing, ready, running, complete, error or cancelled. Expose discovered total and updated/unchanged/skipped counts. An error pauses at the current position; Retry remaining resumes with fresh values. The UI reports one blocked position, not a complete error inventory. Refresh progress manually, including after reopening the policy.

Deactivation, revision changes, a replacement run or a new activation timestamp prevent old jobs from resuming. An in-flight Jira write may still finish. Counters are observational: if a write succeeds before checkpoint failure, retry may count it as unchanged. A fixed list from paginated search is not a transactional database snapshot.

Latest snapshot/progress is retained until replaced; obsolete snapshots are deleted in queued batches. There is no automatic TTL purge today. Improve cancellation, cleanup and failed-target reporting before treating this as a bulk-operation platform. To change population options for an already active policy, deactivate it first.

## 8. Validation, observability and cost

### R14 — Preview and evidence

Test with a visible representative key in the selected target scope. Show current/calculated values, affected target, matching source rows or condition outcomes, and no-write status. Show at most ten matching relationship rows; the aggregate uses all matching candidates within current traversal safeguards. Rows excluded by filters are not displayed as runtime failures.

Show response duration, Jira request count and trace ID. Read-only source routing can trace a changed source back to affected targets without updating them. Client validation plus backend readiness is useful but is not proof of all target contexts or production correctness.

### R15 — Executions and diagnostics

Keep last-run metadata separate from policy configuration. Retain bounded validation/assessment history and sampled relationship results. Temporary diagnostics are enabled per policy for 24 hours, with refresh, turn off and clear controls. Expose source/work-item identifiers, dependency fields, revision, outcome, duration, request count and trace identifiers without recording full event bodies or source values.

Manifest-rejected events are invisible to functions. Diagnostics are a bounded sample, not an audit guarantee. Ordinary unchanged outcomes are omitted from permanent execution history; optional diagnostic samples may show them. Logging failures must not turn a successful field write into a failure. Population progress is separate from the Executions trace list.

### R16 — Quotas and private operation

Keep invocations, compute time, storage and logs measurable and proportional to relevant work. Free allowances are a design target, never a guarantee. Current UI displays a conditional $0 estimate while within allowances; it does not read actual remaining quota or compute a reliable per-policy monthly bill. The hard-coded operation estimate does not fully account for save/readiness/population work and requires correction.

Re-verify Forge and Jira limits/pricing before capacity decisions; app-enforced bounds below are not vendor quotas. The earlier 100,000-updates/week scenario has not been capacity certified. Preserve privacy and site isolation; enforce admin authorization for administrative actions on the server, not only through page placement. Population and diagnostic controls check admin permission; a uniform authorization audit of all existing resolvers remains pending.

## 9. Current implementation bounds (not new product requirements)

| Area | Baseline bound | Required handling |
| --- | --- | --- |
| Saved policies | 100 per installation | Explain limit; future scaling is planned |
| Active relationship policies | 5 | Current pilot guard, not a tested platform maximum |
| Conditions / related filters | 10 each | Current backend normalization slices arrays; explicit overflow rejection should replace silent truncation |
| Hierarchy | root plus up to 2 descendant levels | Unsupported depth must not produce a partial total |
| Related candidates / bounded search | 500 | Fail explicitly; larger per-target calculations remain pending |
| Reverse-route targets | 50 | Current routing guard applies to source tracing/runtime, separate from project size |
| Project-wide target population | No ten-item cap | 25-key pages, target jobs/continuations |
| Jira requests through worker adapter | 250 per adapter/job | Stop rather than report incomplete totals |
| Assessment chain depth | 10 | Reject excessive/cyclic chains |
| Explicit population key selection | 100 keys | All/date modes use pagination instead |
| Review token / prepared list | 15 minutes / 1 hour | Require refresh/review after expiry |
| Preview result rows | 10 | Display only, never calculation scope |
| Validation/assessment history | Latest 50 records | Shared history updates are not transactionally safe |
| Relationship history / diagnostics | 20 random slots per policy each | Sampling may overwrite records; merged history displays at most 100 |
| Diagnostics capture | 24 hours | Stored slots persist until overwritten/cleared |
| Project / custom-field metadata loops | 500 projects / 1,000 custom results | Current discovery ceilings need paging/completeness work |

## 10. Acceptance fixtures for an independent rebuild

Use disposable Jira/JPD test projects and generic IDs resolved from metadata. Each test records application version, policy revision, target/source keys, expected value, observed Jira history and trace/progress result.

| ID | Scenario | Expected result |
| --- | --- | --- |
| A01 | Discover a new custom field and category-filtered projects | Refresh finds metadata; existing selections survive filtering |
| A02 | Single/multi-select assessment with invalid then valid options | Invalid rejected; correct typed cardinality retained |
| A03 | Save after validation; attempt stale activation | Old review rejected; active policy edits/deletion rejected |
| A04 | Numeric source matches assessment, then no longer matches | Matching result written; no-match leaves current target |
| A05 | Override protected target; repeat an equivalent update | Restoration only when eligible; no repeated writes/loop |
| A06 | Linked child changes 3 to 11 points | Actual JPD total increases by 8 without manual validation |
| A07 | Source enters/leaves status filter; blank/zero/cleared points | Recompute both directions; zero/empty semantics correct |
| A08 | Source created, reparented, deleted; link added/removed | Correct old/new target totals, or explicit unsupported case |
| A09 | Duplicate/reordered events and multiple changes | Convergent total, no unnecessary write; measured execution evidence |
| A10 | Overlapping writers / direct and indirect cycles | Activation rejects conflict with actionable explanation |
| A11 | Future-only activation | No initial population or bulk writes |
| A12 | Prepare keys/date/all, including more than 25 targets | No writes during preparation; count/list scoped correctly |
| A13 | Activate prepared list, including more than 10 targets | Only selected target field changes; equal/nonmatching values skipped |
| A14 | Done exclusion, explicit inclusion, persistent Done guard | Defaults and override precedence honored for target, not source |
| A15 | Failure/retry, deactivation/reactivation, revision replacement | Resume correct cursor; stale work cancelled; no unintended scope expansion |
| A16 | Diagnostics expiry/clear and storage failure | Capture bounded; field outcome unaffected by telemetry failure |
| A17 | Reinstall/new site/rebuild | No sample-site assumptions; preserve or deliberately migrate storage and app identity |

A06 has user-confirmed live evidence for the baseline. Most other scenarios have partial automated coverage but require recorded live acceptance before broad deployment. No undocumented test should be marked passed by inference.

## 11. Remaining capabilities and non-goals

Pending: ordered decisions; automatic one-level hierarchy inheritance; typed relationship copy/union; robust field-context mapping; full date rules; uniform backend authorization; durable reconciliation for missed/out-of-scope events; conflict-safe storage and writes; indexed routing, coalescing, backpressure and measured capacity; reliable snapshot cleanup and stronger progress/audit records; site-portable export/import with validation.

Deferred: Atlas Goals/KRs/OKRs, PR/development integrations, external databases and arbitrary code execution, public Marketplace launch. Broad ScriptRunner parity is not a requirement. None of these become active merely because a UI selector or historical note mentions them.

## 12. Documentation contract

Every functional, storage, security, runtime, lifecycle or quota change updates this file, the architecture document where applicable, and the standalone plan in the same commit. Keep **implemented**, **preview-only**, **pending** and **live-verified** separate. Archive obsolete notes rather than accumulating contradictory current claims. Jira can be updated independently, but must never be needed to rebuild or understand this specification.

## Processing latency improvement (2026-09-25)

BUG-001: ordinary relationship updates now calculate the first discovered target for each affected policy inside the existing serialized discovery job. Additional targets and structural scans retain paginated queue jobs. Relationship enqueue operations no longer add an artificial two-second delay. The shared writer lock (including population), revision checks, Done guards, filters and unchanged-write suppression remain. Trace records add `sinceIngressMs` and `beforeJobMs`; these start at Forge ingress, not at the original Jira edit, and continuation timing includes prior processing. Live latency improvement remains to be verified after deployment.

Verification update (2026-09-25): latency simplification deployed privately as development **5.10.0**. All **61 tests**, ESLint and Forge lint passed. Earlier 5.9.0/58-test references describe the reconstruction baseline; live latency comparison remains pending.
