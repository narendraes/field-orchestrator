# AutoUp — standalone feature and rebuild plan

Baseline: **5.9.0 / 5f872dd**, reconciled **2026-09-24**. This plan is independent of Jira tracking: task IDs below are local to this document and do not mirror or require external ticket IDs. Read [the requirements](docs/requirements.md) for behavior and [runtime architecture](docs/runtime-architecture.md) for contracts.

## How to use this plan

- `[x]` means implemented in the baseline, not that all live acceptance has passed. For a rebuild, reproduce and verify checked tasks rather than skipping them.
- `[ ]` means work or evidence remains. **Preview** explicitly means activation must stay unavailable.
- Preserve task IDs, dependencies and acceptance criteria when updating status. Record the implementation commit, deployment and verification evidence when completing future tasks.
- Complete baseline reconstruction in phases P0–P7 before adding P8/P9 extensions. A fresh implementation must satisfy the specification, not reproduce known defects just because they exist in the baseline.
- Documentation-only changes do not require a new Forge deployment. Runtime/manifest changes do.

## Feature inventory

| Feature | Requirements | Source / entry point | Status |
| --- | --- | --- | --- |
| Native administration and unified policy list | R01 | `src/frontend/index.jsx` | Implemented |
| Metadata, custom fields, typed controls, project filters | R02 | Frontend metadata/options loaders | Implemented with catalog/context limits |
| Durable policies, revision validation and lifecycle | R03–R04 | `src/resolvers/index.js` | Implemented; storage/auth hardening pending |
| Assessment conditions and automatic updates | R05 | Resolver compiler; `src/runtime/issue-updated.js` | Implemented |
| Numeric relationship rollup, source routing and structural handling | R06, R10 | `relationship-rollup.js`, `relationship-routing.js`, `relationship-worker.js` | Implemented; one live points-change acceptance confirmed |
| Direct-parent inheritance | R07 | Frontend preview | Preview only |
| Protection, conflict checks, assessment chaining | R08 | Resolver graph checks and runtime handlers | Implemented with known concurrency limits |
| Ordered decisions for a shared target | R09 | No implementation | Pending |
| Manifest gates and queues | R11 | `manifest.yml`, `src/index.js` | Implemented; indexed no-scan dispatch pending |
| Optional initial population and progress | R12–R13 | `src/runtime/population.js`, resolvers, editor | Implemented; live acceptance pending |
| Done-target protection | R08, R12–R13 | Compiled expression, worker guards, editor | Implemented; live acceptance pending |
| Read-only test and source trace | R14 | Frontend preview and source-trace resolver | Implemented |
| Last run, histories and diagnostics | R15 | Resolver/runtime KVS records | Implemented; sampled, not an audit log |
| Cost/capacity measurement | R16 | UI usage display | Basic instrumentation only |
| Private distribution and portable identity | R01, R16 | Manifest and operational setup | Private baseline; console/history rename not verified |
| Goal/OKR/PR integrations, public launch | Section 11 | None | Deferred |

## P0 — Restore the project and establish the baseline

Dependencies: none. Exit: a reproducible private Forge app, with preserved identity where recovering an existing installation.

- [x] P0.01 — Maintain a private local Git repository and an existing private remote configuration. Baseline source is locally committed; later remote pushes are not confirmed.
- [x] P0.02 — Use JavaScript, native Forge UI Kit, backend resolvers and the lockfile dependencies. Keep the existing app ID/module keys/storage namespaces for a recovery.
- [x] P0.03 — Define the admin page, event handlers, queue consumers and index exports from the current manifest.
- [x] P0.04 — Keep reusable examples installation-neutral and application distribution private.
- [x] P0.05 — Rename heading/navigation to AutoUp; preserve technical identifiers for compatibility.
- [ ] P0.06 — Complete and verify Atlassian console/app-user history branding; a module-title deployment is not proof of actor renaming.
- [ ] P0.07 — Restore reliable GitHub synchronization after the existing destination-approval block is resolved. Never force-push or claim an unverified backup.
- [ ] P0.08 — Record a clean-machine install/build/restore exercise and dependency audit. Do not infer reproducibility from a previously installed local dependency tree.

Rebuild procedure:

1. Recover the source and lockfile; inspect `AGENTS.md`, manifest and storage contracts before editing.
2. For recovery of this app, preserve its identity; do not register a replacement and expect existing KVS/policies to appear. For an intentionally new app/site deployment, create/register the new identity explicitly and document data migration separately.
3. Use a supported Node/Forge CLI toolchain, install locked dependencies, and verify login to the intended developer account.
4. Run `npm test`, `npm run lint`, and `forge lint` from the app root. Inspect every failure.
5. Deploy to private development; upgrade the installation if scopes/egress change. Preserve active policy choices; deployment must not auto-activate drafts.
6. Execute A01–A17 on disposable fixtures; record actual target history, not only preview results.

## P1 — Metadata and the no-code editor

Dependencies: P0. Exit: administrators can configure real fields and scopes without scripts. Acceptance: A01–A02.

- [x] P1.01 — Load fields by merging general metadata and paginated custom-field discovery; refresh manually.
- [x] P1.02 — Discover projects, product type/category, link descriptions/IDs and root issue types.
- [x] P1.03 — Implement unified Policies/Executions/Settings navigation, policy search, create/edit/delete and inactive/active presentation.
- [x] P1.04 — Group inputs on responsive rows, add help/summary text and compact condition/filter removal.
- [x] P1.05 — Keep target spaces and source spaces separate; filter target project choices without losing selections.
- [x] P1.06 — Resolve single/multi-select options from a representative context and reject invalid values.
- [ ] P1.07 — Replace silent metadata ceilings with complete pagination or explicit partial-result warnings. Confirm new/unused fields and subtasks are handled intentionally.
- [ ] P1.08 — Replace comma-separated option labels with stable typed selections plus a migration. Test commas, renamed options, disabled options and different contexts across projects.
- [ ] P1.09 — Finish date/datetime semantics and timezone guidance; reject invalid calendar dates in backend validation. Keep unsupported date conditions ineligible until implemented.
- [ ] P1.10 — Add accessibility/keyboard and rendered-layout verification for the editor and population controls.

## P2 — Storage, validation and policy lifecycle

Dependencies: P1. Exit: only a current validated revision can activate. Acceptance: A02–A03, A10.

- [x] P2.01 — Persist normalized policies with stable IDs, revisions and timestamps.
- [x] P2.02 — Save before preview; bind retained validation to the saved configuration/revision.
- [x] P2.03 — Generate expiring, single-use activation reviews and recheck readiness during activation.
- [x] P2.04 — Publish project dependency unions before active status; remove inactive contributions on deactivation.
- [x] P2.05 — Prevent edits/deletion of active policies; keep history across deactivation.
- [x] P2.06 — Handle empty successful project-property responses without JSON parsing; reject HTTP failures.
- [ ] P2.07 — Apply a consistent backend administrator guard to every administrative read/write resolver, including forged direct calls.
- [ ] P2.08 — Replace whole-policy-array read/modify/write races with conflict-safe per-policy updates or a validated concurrency mechanism.
- [ ] P2.09 — Reconcile partially published project indexes if activation/storage operations fail; expose a repair action/status.
- [ ] P2.10 — Replace silent condition/filter/scope truncation with explicit validation errors and document all schema limits.
- [ ] P2.11 — Add explicit schema migrations and legacy-fixture tests for all saved versions. Preserve policy IDs and histories or document transformations.

## P3 — Assessment, protection and ownership

Dependencies: P2. Exit: deterministic assessment outcomes and visible protection behavior. Acceptance: A04–A05, A10.

- [x] P3.01 — Implement AND/OR conditions and equals/notEquals/isEmpty/isNotEmpty.
- [x] P3.02 — Compile Boolean gates to Jira Expressions and typed results to Jira write values.
- [x] P3.03 — Leave targets unchanged on no match; compare before writes.
- [x] P3.04 — Restore externally changed protected targets only when the rule currently yields a result.
- [x] P3.05 — Reject overlapping active owners, direct/indirect assessment cycles and overly deep chains.
- [x] P3.06 — Evaluate affected assessment policies topologically in the same event invocation; suppress app-originated product events.
- [x] P3.07 — Add persistent Done-target exclusion and status dependency; recheck before writes.
- [ ] P3.08 — Unify preview/runtime typing for object-valued system fields, empty/numeric semantics, options and arrays. Use explicit adapters instead of generic string equality.
- [ ] P3.09 — Validate target schema/editability and option context across runtime contexts, not solely the representative item.
- [ ] P3.10 — Add lifecycle rechecks and concurrency controls consistently to assessment writes, matching or exceeding queued worker protections.
- [ ] P3.11 — Record live assessment, protection, chain and Done-target scenarios; avoid claiming locked fields or transaction-level exclusion.

## P4 — Relationship calculations and background processing

Dependencies: P2–P3. Exit: actual configured Jira/JPD targets update automatically. Acceptance: A06–A10.

- [x] P4.01 — Store source/target project scopes, link ID, root types, source field, filters and hierarchy depth.
- [x] P4.02 — Match links in either direction using stable IDs while displaying human-readable descriptions.
- [x] P4.03 — Traverse roots/children/grandchildren with minimal fields; apply JQL candidate filters, deduplicate and calculate numeric totals.
- [x] P4.04 — Implement empty/count/min/max semantics and explicit incomplete/nonnumeric errors; retain copy/union as preview-only.
- [x] P4.05 — Compile source/status/parent/type/project dependencies and protected/Done target dependencies.
- [x] P4.06 — Manifest-filter creation, updates, link creation/removal and deletion; project link routes on both endpoints.
- [x] P4.07 — Reverse-route source updates without filtering out departed contributors.
- [x] P4.08 — Reconcile structural target scopes in pages; evaluate targets in separate serialized jobs.
- [x] P4.09 — Check current values, lifecycle and editability before writes; suppress no-change writes; distinguish retryable/permanent failures.
- [x] P4.10 — Remove the accidental ten-target project-size activation restriction. Keep ten rows solely as preview display.
- [x] P4.11 — User confirmed one real Story edit updated a JPD target field and history.
- [ ] P4.12 — Complete live tests for entering/leaving filters, empty points, creation, old/new parent totals, deletion and both link orientations.
- [ ] P4.13 — Cover moves into/out of unindexed projects and missed events through a supported reconciliation design.
- [ ] P4.14 — Add durable event/target coalescing and idempotency records where needed; prove behavior under duplicate, reordered and concurrent source changes.
- [ ] P4.15 — Replace global active-policy scans with direct dependency routing without weakening manifest gates.
- [ ] P4.16 — Remove/expand the 50-route, 500-candidate and five-policy pilot guards only after implementing bounded continuations and measuring capacity. These are not permanent user requirements.
- [ ] P4.17 — Measure queue self-continuation, backlog, retention and API retry behavior against current Forge limits; add recovery for exhausted delivery.
- [ ] P4.18 — Verify supported relation/JPD behavior across another private site, including project and issue-type differences.

## P5 — Opt-in existing-value population

Dependencies: P2–P4. Exit: informed selection before bulk writes, observable completion and safe resume. Acceptance: A11–A15.

- [x] P5.01 — Default activation to Future changes only; never populate implicitly.
- [x] P5.02 — Add selected target keys, target creation-date range and all-scoped-target modes.
- [x] P5.03 — Prepare a paginated fixed key list without writing fields; display count and require current-revision review.
- [x] P5.04 — Exclude Done targets by default; offer explicit initial inclusion, overridden by persistent Done protection.
- [x] P5.05 — Process assessments/numeric rollups one target per queued job, updating only the configured field.
- [x] P5.06 — Expose phase, count, updated/unchanged/skipped/blocked information and manual refresh.
- [x] P5.07 — Pause on failure; Retry remaining resumes the position with fresh values.
- [x] P5.08 — Cancel stale revision, replacement and activation-timestamp jobs; clean replaced snapshots in batches.
- [ ] P5.09 — Run live future-only/selected/date/all/Done/retry/deactivation acceptance. The 61-target automated fixture is not live scale evidence.
- [ ] P5.10 — Add reliable cleanup for abandoned, expired and deleted-policy runs; define TTL/retention and test cleanup retry recovery.
- [ ] P5.11 — Add explicit cancel and refresh-on-progress behavior, plus safe resume after queue/checkpoint outages. Decide whether retry should continue after individual permanent failures or stop as today.
- [ ] P5.12 — Improve failed-target inventory and counters while keeping storage bounded. Distinguish actual writes from replay-observed unchanged values.
- [ ] P5.13 — Evaluate an explicit Run now action for already-active policies as a proposed extension; do not silently auto-run on deployment/edit.

## P6 — Tests, observability and quota reporting

Dependencies: P1–P5. Exit: meaningful evidence and measurable costs, without noisy unbounded logging.

- [x] P6.01 — Show representative preview, affected target and at most ten matching source rows.
- [x] P6.02 — Add client duration/Jira request counts and retained validation trace IDs.
- [x] P6.03 — Retain bounded execution records and independent policy last-run metadata.
- [x] P6.04 — Add 24-hour per-policy diagnostics with twenty sampled slots, refresh/off/clear and safe telemetry failure handling.
- [x] P6.05 — Add source-route tracing without Jira writes.
- [x] P6.06 — Maintain 58 automated tests across lifecycle, routing, rollups, population and guards in the baseline.
- [ ] P6.07 — Build the remaining A01–A17 live evidence matrix; include source/target histories and version/revision/trace IDs.
- [ ] P6.08 — Make usage estimates include save, readiness, queue, population and storage work; replace misleading hard-coded per-test operations.
- [ ] P6.09 — Measure representative weekly-volume scenarios and bursts, including 100,000 updates/week, fan-out, target changes and diagnostics on/off. Report assumptions and actual usage rather than guaranteed free operation.
- [ ] P6.10 — Add low-volume aggregate metrics and end-to-end correlation across discovery, target jobs and population without storing full values.
- [ ] P6.11 — Audit all trace reads/mutations for site/admin isolation and bound retained orphan keys on policy deletion.

## P7 — Release and rebuild acceptance gate

Dependencies: P0–P6. Exit: baseline recovered and verified; future work can proceed from a documented state.

- [x] P7.01 — Preserve source/manifest/lockfile and known deployment baseline in Git locally.
- [x] P7.02 — Provide this independent plan, a reconciled requirement specification and architecture/storage contracts.
- [ ] P7.03 — Demonstrate a clean rebuild and controlled deployment using only these documents and source, with no conversation/Jira dependency.
- [ ] P7.04 — Exercise backup/restore of configuration with context validation. Export/import is a proposed recovery enhancement, not an implemented feature.
- [ ] P7.05 — Record installation upgrades, permission changes, rollback procedure and policy index recovery. Restoring old source does not roll back stored schema or Jira writes automatically.
- [ ] P7.06 — Close live acceptance gaps, confirm safe rollback and obtain owner approval before broader/private production use or distribution.

Release checklist for each application change:

1. Update requirement IDs, plan tasks, runtime/storage docs and UI claims together.
2. Run targeted meaningful regression tests, then the required suite, ESLint and Forge lint.
3. Review source, manifest permissions and documentation diff; no unexplained identity/storage migration.
4. Deploy privately; record actual version and installation/upgrade outcome.
5. Record live acceptance separately from automated results. Never mark a future feature complete because it has a schema or button.
6. Commit the intended files; push only to the authorized private destination. Report failure/approval blocks without pretending a remote backup exists.

## P8 — Next functional capabilities

Dependencies: complete relevant P2/P3/P4 hardening and acceptance before enabling new writers.

### Ordered decisions — required next capability (R09)

- [ ] P8.01 — Add ordered condition cases for one target, readable precedence and explicit no-match/default behavior.
- [ ] P8.02 — Define single-value and multi-select replacement semantics; keep partial option ownership out until specified.
- [ ] P8.03 — Validate overlapping cases, typed outcomes and all dependencies; prevent independent conflicting writers.
- [ ] P8.04 — Compile/evaluate first matching case, include protection and Done guards, and expose the winning case in preview/trace.
- [ ] P8.05 — Test A→X, B→X, overlapping cases, no match and external override with deterministic expected values.

### Direct-parent inheritance — required (R07)

- [ ] P8.06 — Define copy versus union behavior for one-level Story-to-parent Fix Version.
- [ ] P8.07 — Map version IDs/contexts across projects; define siblings with conflicting values and clear/remove semantics.
- [ ] P8.08 — Add manifest dependencies, old/new parent routing, safe writes and lifecycle checks.
- [ ] P8.09 — Verify actual parent updates, source clearing, parent moves, duplicates, protection and deactivation before activation support is exposed.

### Additional typed calculations and health rules

- [ ] P8.10 — Promote relationship copy/union from preview only after type/context/conflict validation and runtime tests.
- [ ] P8.11 — Add explicitly defined date comparisons/arithmetic with timezone/calendar behavior and boundary tests.
- [ ] P8.12 — Provide reusable no-code examples for flagged/PDLC status and health assessments using real metadata; avoid implying absent checklist integrations.
- [ ] P8.13 — Design safe mixed-policy/relationship chaining and cross-work-item cycle detection before relaxing current rejection.

## P9 — Deferred or optional work

These do not block the current private MVP and are not automatically authorized for deployment.

- [ ] P9.01 — Atlas Goals/KRs/OKRs: adapter, relationship semantics, permissions and missing-alignment outcomes.
- [ ] P9.02 — Pull-request/development signals: supported API, freshness and explicit Testing-without-PR semantics.
- [ ] P9.03 — Public Marketplace readiness only if requested: distribution, licensing, support, security and compatibility work.
- [ ] P9.04 — External data/code execution only after a separate requirement decision; do not substitute it for the no-code model.
- [ ] P9.05 — Optional template library and validated portable configuration import/export; no current schema/API guarantee.

## Acceptance record template

For each A01–A17 test, record:

- Date, app version, source commit and environment.
- Policy revision, configuration and representative target/source fixture IDs.
- Initial target/source values; the single action performed.
- Expected result, observed actual target/history, trace or population run ID.
- Pass/fail, limitations and follow-up local task IDs.

Current evidence: baseline automated suite has 58 passing tests; user confirmed one actual linked Story-points-to-JPD update. New population/Done behavior is deployed but awaiting live confirmation. No additional acceptance is inferred.

## Documentation maintenance

Update this plan with requirements and architecture whenever code or configuration changes. Keep historical notes in `docs/history/`, and keep Jira progress separate. A task may be implemented but still have an unchecked acceptance/hardening task. Future agents must be able to understand exactly that distinction without external tracking access.
