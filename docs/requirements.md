# Field Orchestrator requirements and delivery state

Last reconciled with the application code and manifest: 2026-09-20.

Original product discussion: https://chatgpt.com/share/6aaacb7d-4c38-83ea-9cbc-3a24a476cb3c

Field Orchestrator is currently a private Forge development app. It must remain private. Marketplace publication, public distribution, or a go-to-market release requires explicit owner authorization. Product UI, help text, sample keys, and distributable documentation must remain installation-neutral.

## Product objective

Give Jira and Jira Product Discovery administrators one maintainable place to define, inspect, test, and eventually enforce derived-field policies that otherwise become scattered Jira Automation or ScriptRunner rules.

The policy model is target-first:

1. Select the target field and Jira/JPD space scope.
2. Select the source path: conditions, direct hierarchy, or linked work.
3. Configure evaluation and filtering.
4. Review the readable policy summary and protection intent.
5. Test against a representative work-item key before activation.

## Recovered implementation (deployment pending)

### Administration experience

- Native Forge UI Kit Jira administration page with Policies, Executions, and Settings views.
- Responsive card layout places related inputs on the same row when space permits.
- Live Jira metadata discovery for fields, spaces, issue-link types, and non-subtask work types, with an administrator-triggered refresh action.
- Field discovery merges Jira's generally visible field endpoint with paginated custom-field search so newly created custom fields can appear before they are associated with a used screen or field configuration.
- Field selectors contain system and custom fields, with custom fields sorted first and labels showing the stable field ID.
- Listing a field does not prove it is usable in every selected scope. Validation and future activation must still verify that the field has an applicable Jira context and is readable or editable for the relevant project and work type.
- Relationship selectors show Jira's outward/inward wording, such as `implements / is implemented by`, while policies store the stable link-type ID.
- Policies is the single management view. Administrators can create, search, edit, and confirm deletion of policies.
- The table shows policy name, target field, type, number of spaces, protection intent, draft status, configuration update time, and actions.
- Help text, policy-type explanations, validation messages, summaries, status messages, and date-format guidance are included in the editor.
- Example work-item keys use installation-neutral values such as `ABC-123`; the product must not embed keys, project names, site URLs, or other identifiers from a development installation.
- Condition and related-work filter rows use compact end-of-row remove buttons to preserve vertical space.
- Space scope selection can be filtered by Jira product/type and project category. Option labels show name, key, product/type, and category, and changing a filter preserves existing selections.

### Policy schema

- Policies persist in Forge KVS under `field-policies:v1` and are validated again in the backend resolver.
- Maximum 100 saved policies per installation.
- Every saved policy remains a `draft`; saving never activates it.
- A policy requires a name, target field, and at least one Jira or JPD space.
- Up to 10 assessment conditions and up to 10 relationship filters are accepted per policy.
- Protection intent can be saved, but protection is not enforced while the policy is a draft.

### Supported policy types

**Field assessment**

- Combines conditions using AND or OR.
- Operators: equals, does not equal, is empty, and is not empty.
- Sets a configured result when conditions match.
- Date targets require `YYYY-MM-DD`; date-time targets require a parseable date/time including a timezone.
- Read-only validation is schema-aware for Jira single-option and multi-option targets. It reads the tested work item's edit metadata, verifies that the target field is applicable/editable, rejects unknown options, and normalizes valid values into Jira option objects.
- Selecting an option-based assessment target replaces the free-text result control with a Jira-backed option picker. A representative work-item key loads options from the applicable project, work type, and field context.
- Single-select targets permit exactly one option. Multi-select targets permit one or more options. Text and numeric targets retain their normal text input.
- The saved draft continues to store option labels for compatibility, while validation resolves and normalizes the selected values to Jira option IDs/objects for the tested context.
- The deployed draft schema currently supports one result value per assessment policy. It does not yet provide ordered outcomes where different trigger conditions produce different values for the same target field.

**Required decision-policy extension**

- One target field may derive different values from different source-field conditions, for example: when A matches set X to Value 1; when B matches set X to Value 2; when C matches set X to Value 3.
- Represent this as one decision policy containing ordered cases, rather than independent writers competing for the same target.
- Evaluate cases from highest to lowest priority and apply the first matching case. The editor must show the order and the readable outcome for every case.
- Detect overlapping conditions during validation and show which case wins. Do not activate ambiguous same-priority writers.
- A protected decision policy requires a deterministic fallback: either a configured default value or an explicitly selected no-match behavior. Protection cannot restore a value when the desired no-match state is undefined.
- Changes to any case dependency field request evaluation. The target field itself becomes a dependency only while protection is enabled or when another policy consumes it.
- An external change to protected Field X requests evaluation and restores the computed case value only when it differs. The restoration write is app-generated and must be rejected by `ignoreSelf` before another invocation.

**Hierarchy inheritance**

- Reads a value from a changed child and previews its direct parent as the affected item.
- Supports one parent level.
- Supports copy and unique-union evaluation.
- Covers the planned story Fix Version to parent use case, but no automatic write occurs yet.

**Relationship rollup**

- Treats the selected Jira link type as bidirectional.
- Selects linked roots by one or more configured work types.
- Traverses the linked root only, its children, or its children and grandchildren.
- Supports copy, sum, count, minimum, maximum, and unique-union evaluation.
- Supports Jira-field filters and the virtual Status category value derived from Status.
- Operators: equals, does not equal, is empty, and is not empty.
- Pushes configured filters into JQL before detailed values are retrieved.
- For numeric rollups, an empty source value contributes nothing. Creating a matching child with empty Story Points does not increase the calculated total.
- Setting or clearing Story Points later, moving the item into or out of a configured Status/Status category, changing its parent, or changing the relevant Jira relationship must request recalculation.
- Creating a work item with a qualifying source value already populated must also request recalculation. Creation and structural events require their own manifest-filtered triggers before activation.
- After any recalculation, an unchanged aggregate must not produce a Jira target-field write.

### Read-only validation

- Accepts a representative Jira or JPD work-item key.
- Requires the test item to be visible to the current user and inside a selected policy space.
- Reads only the fields needed by the draft calculation.
- Field assessment reports condition outcomes, current target, calculated target, and whether it would change.
- Hierarchy inheritance reports the source and direct parent, current target, calculated target, and whether it would change.
- Relationship validation discovers matching links and roots, traverses minimal key/parent metadata, filters through JQL, then reads detailed values only for matching candidates.
- Jira search pages contain at most 100 items and validation stops after 500 accumulated search results per query path.
- Relationship result tables display at most 10 matching items and ask the administrator to refine filters when more match.
- Empty numeric source values do not contribute to a sum; if all matching source values are empty, the previewed sum is `0`.
- Validation reports elapsed client-observed response time and the number of Jira REST requests made by that test.
- Option-target validation includes one narrow Jira edit-metadata request so an invalid configured option cannot report a passing test.
- Testing a saved policy assigns a trace ID, records the latest run on the policy, and retains a bounded validation history in the Executions view.
- Validation history retains the latest 50 traces with time, policy, work-item key, outcome, response time, Jira request count, and trace ID.
- The backend emits the same trace ID to Forge logs so administrators can correlate an Executions row with platform logs. Unsaved-policy tests remain local and are not retained.
- Manual trace persistence runs after the validation result is displayed, so diagnostic storage does not extend the calculation's critical path.
- Validation usage presents a quota-based estimate of `$0.00` while monthly free allowances remain, identifies the metered resolver/KVS/log operations used by a retained test, and states that testing does not invoke the policy event runtime or write Jira data.
- Validation never updates a Jira work item or activates a policy.

### Runtime pilot

- `manifest.yml` contains an `avi:jira:updated:issue` product trigger.
- The manifest expression requires the Jira project entity property `field-orchestrator-runtime-v1.active` to be `true` and requires at least one `changelog.items[].fieldId` to be in `field-orchestrator-runtime-v1.fieldIds`.
- `ignoreSelf: true` rejects app-generated issue updates, and `onError: IGNORE_AND_LOG` fails closed.
- The event handler receives only events that passed the manifest expression and deliberately does not repeat the same gate in JavaScript.
- A saved field-assessment policy with a successful representative validation can be activated by an administrator. Hierarchy and relationship policies remain read-only drafts.
- Activation compiles assessment conditions and a schema-aware target value, rejects overlapping active ownership of the same target and space, and writes the project dependency property used by the manifest filter.
- Active conditions are evaluated by Jira Expressions. A match reads only the target field, suppresses an equivalent write, and otherwise updates the target through Jira REST as the app.
- Protection adds the target field to the manifest dependency index. An external target edit is restored only while the assessment conditions match; a no-match assessment leaves the value unchanged.
- Deactivation removes the policy from the project dependency union and deletes the project property when no active dependencies remain.
- Runtime changes, restorations, and errors are retained in bounded execution history and Forge logs. No-change outcomes are deliberately not persisted or logged.
- Editing and deletion are disabled while a policy is active.
- Draft validation rejects a policy that uses its own target as a condition. Activation builds the active dependency graph per project and rejects indirect cycles and chains deeper than 10 policies.
- `ignoreSelf` rejects the later Jira event for every app-generated field update. To preserve valid derived-field chaining, one qualified invocation evaluates affected active policies in topological order and adds each changed target to its in-process dependency set.

## Required runtime architecture

- Apply manifest filters before function invocation for every product trigger.
- Use Jira Expressions REST API v3 `POST /rest/api/3/expression/evaluate` for supported Boolean workflow, permission, and field checks.
- Do not retrieve full issue JSON merely to make a Boolean gating decision.
- Keep trigger payloads and entity-property projections small.
- Suppress unchanged writes and make processing idempotent before any policy can activate.
- Compile condition, source, filter, and structural dependencies by project. A Jira update with several relevant field changes must produce one invocation and evaluate only policies indexed to those changed fields.
- Do not include a derived target field as a trigger dependency unless protection is enabled or another policy consumes it as a source.
- Normalize the existing and calculated values using the Jira field schema and skip equivalent writes.
- Use manifest `ignoreSelf: true`, no-change suppression, and idempotency together so app-originated writes, retries, and duplicate events cannot create processing loops.
- Rules that depend on Forge KVS, Forge SQL, or external data cannot be read by manifest/Jira expressions. Keep them ineligible for activation until a supported Jira entity-property projection or static deployed filter exists, and explain the limitation in the UI.
- Preserve the free monthly allowance as a design target and measure event, compute, storage, and Jira API usage before activation. No zero-cost guarantee is made.

See `docs/runtime-architecture.md` for the event pipeline, entity-property schema, and platform limitations.

## Pending beyond the runtime pilot

1. Add ordered decision cases and deterministic default/no-match behavior for multiple outcomes targeting the same field. The pilot rejects overlapping active target ownership.
3. Add source-project scope for relationship rollups. Target JPD scope alone cannot identify every Jira project whose child changes should trigger recalculation.
4. Add separately filtered issue-link create/delete triggers with configured link-type dependency indexes.
   Add a separately filtered issue-created path for work created with a qualifying source value; empty-value creation must not cause a target write.
5. Extend Jira-expression evaluation and runtime writes to hierarchy and relationship calculations.
6. Add stronger event idempotency and concurrent-update serialization beyond current-value no-change suppression and `ignoreSelf` recursion prevention.
7. Aggregate high-volume counters and coalesce Last run updates without storing individual no-change traces.
9. Measure quota and free-allowance consumption using representative event volumes.
10. Complete acceptance testing before production readiness.

## Deferred

- Atlas Goals and OKR relationships.
- Pull-request and development-status integration.
- Hierarchy traversal deeper than grandchildren.
- Cross-product orchestration outside Jira/JPD.
- Detailed cost analytics and Marketplace packaging.

## Recovery and editor lifecycle — September 23, 2026

Recovered locally; not yet deployed or live-site acceptance tested:
- Saves assign a fresh revision and clear activation eligibility. Successful validation must match the saved revision and configuration; failures revoke eligibility.
- Activation review returns a single-use token with a 15-minute expiry, dependencies, scope, chain neighbors, and estimates of 1/2/3 Jira requests for no match/no change/change. Activation rechecks the configuration and dependency graph.
- Separate creation trigger uses the active project property and ignoreSelf. All assessment dependencies in that project are evaluated on creation because there is no changelog. This means one invocation for each external creation in an active project, even when conditions subsequently do not match.
- Protection traces classify restoration only when the original external changelog includes the protected target.
- Save draft stays in the editor. Save & validate saves first and tests the returned snapshot. After validation retention and readiness review succeed, Activate becomes available in the editor. Active policies can be opened and deactivated there; edits are blocked until deactivation. Back to policies replaces Cancel.
- Existing fields, option pickers, project filters, assessment conditions, hierarchy and relationship previews, bounded results, and execution history are preserved. Ordered outcomes and automatic hierarchy/relationship processing remain pending.
- Concurrent KVS array updates, cross-context option validity, and live expression compatibility still require acceptance/hardening; passing local mocks is not production certification.
