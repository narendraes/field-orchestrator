# Field Orchestrator requirements and delivery state

Last reconciled with the application code and manifest: 2026-09-23.

Original product discussion: https://chatgpt.com/share/6aaacb7d-4c38-83ea-9cbc-3a24a476cb3c

Field Orchestrator is currently a private Forge development app. It must remain private. Marketplace publication, public distribution, or a go-to-market release requires explicit owner authorization. Product UI, help text, sample keys, and distributable documentation must remain installation-neutral.


## TL;DR: private no-code rule engine

Field Orchestrator is a site-local, administrator-controlled rules engine for Jira and Jira Product Discovery. It provides a bounded, no-code subset of the work that teams otherwise implement in ScriptRunner or Jira Automation: derive a target field from typed conditions, hierarchy, or related work; protect the derived result; preview the result on a real work item; and explain every change.

The product is intentionally configuration-driven rather than a general-purpose scripting platform. A policy is made from typed building blocks (fields, operators, values, relationships, hierarchy depth, filters, calculation, target write, protection, and priority). It does not accept arbitrary JavaScript, arbitrary network calls, hidden JQL, or a user-provided script. When a requirement cannot be represented by a supported block or a Jira Expression, the policy remains a draft with a visible limitation instead of silently falling back to JavaScript.

The private installation boundary is part of the product design:

- Each Atlassian site owns its policies, metadata, activation state, traces, and quota budget.
- The app is installed and updated per site by an administrator. It is not a shared Marketplace service and has no cross-site policy execution.
- Examples, test keys, project names, and documentation remain installation-neutral (`ABC-123`, not a development-site key).
- GitHub is a source-control backup for this implementation, not a product data store or a channel for sharing customer policy data.

The scale target for the private MVP is 100,000 changed work items per week in one site. This is a design target, not a platform guarantee. Manifest filtering, a compiled dependency index, one invocation per qualifying event, Jira Expressions for Boolean gates, narrow reads, idempotent writes, and bounded traces are required before a policy type can be activated at that scale.

## Supported no-code capability model

Every capability must fit this pipeline: **trigger dependencies → optional Jira Expression gate → source graph → typed conditions and filters → deterministic evaluation → schema-aware target value → protection and write policy → trace**.

The initial capability families are:

1. **Field assessment** — set one target value when conditions match.
2. **Ordered decision** — set different values for ordered condition cases targeting the same field, with explicit overlap and no-match behavior.
3. **Hierarchy inheritance** — copy or union a value from a parent, child, or bounded descendant path.
4. **Relationship rollup** — traverse a configured Jira relationship and bounded hierarchy, filter candidates, then copy, count, sum, min, max, or union a source value.

Later families may add scheduled reconciliation, status/health assessments, and additional Jira/JPD relationship adapters. They must use the same typed model and lifecycle. Atlas goals, OKRs, pull requests, external databases, and arbitrary custom code remain deferred integrations rather than implicit capabilities.

The editor must expose the effective rule in readable language and show the exact fields and structural events that can cause it to run. A rule is not considered complete merely because its form can be saved: metadata context, target schema, permissions, trigger coverage, overlap, cycles, and quota impact must be reviewable.

## Scale and operational requirements

- **Filter before invocation.** Every product trigger must have a manifest expression that checks the active project property and the relevant changed field, created-item condition, or link type. JavaScript may evaluate a qualified event but may not replace a missing manifest filter.
- **Compile once, route cheaply.** Activation compiles a per-project dependency index. A runtime invocation selects only policies affected by the event's changed fields or structural dependency; it does not scan every saved policy.
- **One event, one invocation.** Several changed dependency fields are coalesced into one policy evaluation. Downstream derived fields run in topological order inside that invocation.
- **No-op is a first-class result.** Missing numeric values do not contribute to sums, and an equivalent target value never creates a Jira write. No-change traces are sampled or aggregated rather than retained per event.
- **Bounded work.** Each policy declares limits for conditions, relationship filters, hierarchy depth, candidate traversal, and target size. Activation rejects an unbounded graph, an unsupported value shape, a cycle, or a chain deeper than the configured maximum.
- **Idempotent and concurrency-safe.** A retry recalculates from current Jira state, compares normalized values, and writes only when needed. Runtime writes carry a trace and are rejected by `ignoreSelf`; competing active policies cannot own the same target in overlapping scope.
- **Quota-aware visibility.** The UI shows estimated Jira requests, response time, retained trace operations, and the relevant Forge allowance category. It must not present an exact dollar invoice when Atlassian does not expose one.
- **Bounded observability.** Changes, restores, errors, activation reviews, and cycle/permission failures are traceable. High-volume no-change events are not individually written to KVS or Forge logs.
- **Eventual consistency is explicit.** Product-trigger delivery may be delayed or duplicated. The UI and help text describe the last run and current-value reconciliation model; activation never promises transaction-level ordering.

## Lifecycle and administration requirements

The lifecycle is **Draft → Validated → Review ready → Active → Paused/Deactivated → Retired**. Saving creates a new revision and invalidates prior validation. Validation is read-only and revision-bound. Activation requires a fresh review token that lists dependencies, scope, conflict/cycle checks, and estimated request counts. Active policies cannot be edited; the administrator deactivates them first. Deactivation removes their projected dependency index and stops future processing without deleting history.

Each active rule must show its owner scope, target, source dependencies, protection behavior, last run, last change, status, and a bounded execution trace. Permission or metadata drift must move the rule to an actionable error state rather than silently changing a field.

## No-code boundary and unsupported rules

Jira Expressions are used for Boolean checks that Jira can evaluate. Forge storage, Forge SQL, arbitrary external data, and calculations that Jira Expressions cannot access are not treated as hidden runtime inputs. Such a rule can remain a preview-only draft until its dependency is projected into a supported Jira entity property or a dedicated adapter is implemented. The UI must name that limitation and the event or quota consequence.

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
- Saving creates a new revision and leaves the policy inactive. A saved revision becomes eligible for activation only after a successful read-only validation and activation review.
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
- The first implementation slice includes a bounded, schema-neutral relationship evaluator used by tests. It filters candidates by typed values, supports Status category and multi-select comparisons, excludes empty numeric values from sums, and caps traversal at 500 candidates and grandchildren. It is not wired to activation or product events yet; source-project discovery, link triggers, and Jira writes remain pending.


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

## Implementation roadmap

The next code slice is the relationship-rollup runtime, delivered behind the same lifecycle gate as field assessment:

1. Add source-project discovery and scope to the relationship policy schema. The target JPD space alone cannot identify every Jira project whose linked work can change the total.
2. Add separately filtered issue-link create/delete triggers and a source-update dependency index. The manifest must carry the configured link-type and project checks before a relationship policy can activate.
3. Compile relationship plans with explicit traversal, candidate, filter, and value bounds. The MDP-2 acceptance case is a linked Feature rollup through children and grandchildren, filtered by Status category.
4. Evaluate only matching candidates, treat empty numeric values as non-contributing, compare normalized totals, and suppress equivalent writes.
5. Add ordered decision cases and deterministic default/no-match behavior for multiple outcomes targeting the same field.
6. Extend the same compiler and runtime plan to hierarchy inheritance.
7. Add stronger event idempotency and concurrent-update serialization beyond current-value no-change suppression and `ignoreSelf` recursion prevention.
8. Aggregate high-volume counters and coalesce Last run updates without storing individual no-change traces.
9. Measure quota and free-allowance consumption with representative event volumes and complete live-site acceptance testing before production readiness.

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
