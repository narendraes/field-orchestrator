# Runtime architecture

Last reconciled with `manifest.yml` and runtime source: 2026-09-20.

Field Orchestrator uses a fail-closed event pipeline. Jira should discard an irrelevant event before Forge starts a function.

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

The recovered manifest handles assessment updates and creation with separate filters. This recovery has not been deployed. Deletion, cross-project parent effects, and link events remain incomplete.

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
