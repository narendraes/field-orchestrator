# AutoUp processing and scale design

## Diagnosis and decision

Combined field writes remove inconsistent intermediate values, but do not by themselves remove scheduling delay or repeated discovery. The previous path enqueued a flush while still holding its installation-wide concurrency slot. A flush delivery attempt can then contend with its producer. Forge concurrency delivery is not a FIFO latency guarantee. The exact cause of any individual delay needs phase timing, not inference from calculation duration alone.

The safe immediate change is a durable inbox before discovery. Each manifest-admitted event stores one immutable, uniquely keyed identifier record and queues a wake-up. A serialized worker reads its own record directly plus up to nine others from a prefix query, shares discovery reads across them, combines affected policies per target, and processes up to three distinct targets in the current worker, at most two concurrently. Excess targets retain durable continuations. No deliberate sleep or debounce is introduced.

This reduces full calculations during a burst without giving unrelated workers permission to race over one pending record. It also removes the secondary queue handoff for this bounded target group. Query visibility is not trusted for the waking record; records absent from a query retain their own wake-up. Acknowledgement follows successful processing or durable continuation dispatch. Failed queue dispatch leaves the immutable record available to a later wake/retry.

## What is and is not improved

- One target with several affected fields: one combined edit after all checks.
- A backlog of many events reaching the same target: groups of up to ten share routing and calculate the target once per group, reading current values. No claim that an entire live burst always fits one group.
- Many independent targets: queue invocations still share one writer key. Within an inbox invocation only, up to two distinct targets overlap. This is not yet scale-ready independent writer lanes.
- Ingress invocations and wake-ups still exist per event. Additional KVS writes/reads trade storage work for fewer calculations. Redundant wakes do no Jira work when the inbox is empty.
- Broad structural changes and opt-in population remain potentially expensive. Existing traversal/request limits remain in place.
- Abandoned records after exhausted retries and no future wake still need an explicit repair/retention design. Do not drop unacknowledged work just to meet a latency target.

## Capacity model

For N independent targets, average service time S and C coordinated writer lanes, idealized service demand is approximately N × S / C, before routing, throttling and queue delivery. Example only: 100 targets at 3 seconds on one lane require about 300 seconds of service. This is not a measured production forecast. For 100 source events affecting one target, target calculations depend on observed batch grouping rather than 100 independent target writes.

Weekly averages cannot establish burst capacity. Record peak admitted events/minute, source-to-target fan-out, distinct targets, hierarchy size, number of policies, Jira request counts, KVS operations and population overlap. Current documented async limits include 500 queued events/minute per installation and invocation-chain limits; splitting work into more jobs is not free capacity.

## Next architecture gate: bounded independent writer lanes

1. Separate read-only discovery from target writing with bounded concurrency and an explicit request budget.
2. Use a small fixed set of target-hashed writer lanes (start with four as a test candidate, not a promised capacity). Every writer of a target, including population, must choose the same lane.
3. Persist immutable signals before wake-up; reduce/acknowledge only under the owning lane. Do not increase concurrency on the existing shared pending-record code.
4. Keep policy generation/lifecycle guards, target ownership, full-batch validation, no-change suppression, retry and follow-up when events arrive during a write.
5. Make population yield between targets so bulk work cannot monopolize interactive work; queue labels alone do not create priority scheduling.
6. Plan migration/draining of old global-lock jobs before enabling new lane writers. Mixed locking schemes must never write concurrently.
7. Add deduplicated route indexing only with invalidation for link/parent/project changes. Never cache derived values as authoritative source data.
8. Bound API load with measured limits and backoff; stop increasing concurrency when rate limiting or backlog grows.

## Acceptance before claiming scale readiness

Run synthetic tests and then controlled live fixtures for single updates, 100 events on one target, 100 independent targets, multi-target fan-out, mixed population/live traffic, concurrent protection overrides, retries, reordered delivery and deactivation. Check final values and histories as well as p50/p95/max ingress-to-result latency, discovery time, target service time, backlog age, requests, storage and duplicate writes.

The current mocked 100-source inbox fixture demonstrates ten hierarchy calculations and one changed target write with all source values already current. It does not model network latency, Jira search consistency, Forge backoff, or prove a live one-second SLA.

## Sources

- [Forge async event concurrency and delivery](https://developer.atlassian.com/platform/forge/runtime-reference/async-events-api/)
- [Async event limits](https://developer.atlassian.com/platform/forge/limits-async-events/)
- [Atlassian staff explanation of concurrency backoff](https://community.developer.atlassian.com/t/questions-about-the-new-concurrency-limits-async-events/93837)

## Two-iteration performance goal

Experimental target: all three affected targets in a controlled 13-source burst converge within 15 seconds of app ingress, with exact totals and original test values restored. This is not a production SLA. Iteration one increases the bounded inline target group from one to three under the existing global lock; excess targets remain queued. Iteration two processes at most two distinct inline targets concurrently inside the same global writer slot. Each target retains independent request accounting and pending state; all siblings settle before a failure is retried. Additional target groups wait. Population and other queue invocations remain serialized. This increases instantaneous API pressure to two target requests and does not establish general scale readiness. Verify meaningful unit tests and live reversible edits; retain private fixture keys/logs outside Git. Reassess strategy if latency or correctness regresses. Independent-target lane migration remains separate work.


### Two-iteration delivery status

Private development **5.14.0** contains both refinements. **83 automated tests**, ESLint and Forge lint passed. Two controlled live edit/restore cycles verified all expected rollup fields across the fixture's three targets; all original source values and target totals were restored and verified after each run. The second increment sample met the experimental ingress-to-result target, but its restoration exceeded it. The latency objective is therefore not consistently achieved. This is finite sample evidence, not a percentile/SLA or a capacity claim. Private keys, timestamps and raw logs remain outside Git.

The next performance gate is repeated comparable bursts, many independent targets and population overlap. If queue wait dominates again, pursue coordinated writer lanes (including population and migration), rather than raising the global concurrency limit on shared pending state. If API throttling increases, reduce within-worker overlap. No unattended recurring test is enabled.


### Reproduce a controlled live test

1. Snapshot an administrator-approved set of source keys, numeric values, statuses, hierarchy and current target values outside the repository. Ensure no one else is editing the fixture.
2. Independently calculate expected target totals for a small reversible numeric increment. Include a nonmatching source to verify filters; do not change its status.
3. Deploy only after regression tests and lint pass. Apply the increment using issue edits, recording their individual completion timestamps. Connector-driven edits can arrive more gradually than a native bulk operation.
4. Verify every target field, then correlate unique target batch IDs with ingress, discovery, service and completion times. Do not sum shared per-policy request counts twice. Report Jira-edit-to-result separately from app-ingress timing; trace completion is slightly after the Jira write.
5. Restore every original source value, verify all sources and target totals, and check for runtime errors. An interrupted test must prioritize restoration before another experiment.
6. Compare repeated runs with equivalent arrival shape before treating the result as a performance guarantee. Keep private fixture/telemetry artifacts out of Git.
