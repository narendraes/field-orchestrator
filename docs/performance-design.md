# AutoUp processing and scale design

## Diagnosis and decision

Combined field writes remove inconsistent intermediate values, but do not by themselves remove scheduling delay or repeated discovery. The previous path enqueued a flush while still holding its installation-wide concurrency slot. A flush delivery attempt can then contend with its producer. Forge concurrency delivery is not a FIFO latency guarantee. The exact cause of any individual delay needs phase timing, not inference from calculation duration alone.

The safe immediate change is a durable inbox before discovery. Each manifest-admitted event stores one immutable, uniquely keyed identifier record and queues a wake-up. A serialized worker reads its own record directly plus up to nine others from a prefix query, shares discovery reads across them, combines affected policies per target, and performs the first target write in the current worker. Other targets retain durable continuations. No deliberate sleep or debounce is introduced.

This reduces full calculations during a burst without giving unrelated workers permission to race over one pending record. It also removes the secondary queue handoff for the primary target. Query visibility is not trusted for the waking record; records absent from a query retain their own wake-up. Acknowledgement follows successful processing or durable continuation dispatch. Failed queue dispatch leaves the immutable record available to a later wake/retry.

## What is and is not improved

- One target with several affected fields: one combined edit after all checks.
- A backlog of many events reaching the same target: groups of up to ten share routing and calculate the target once per group, reading current values. No claim that an entire live burst always fits one group.
- Many independent targets: still serialized by the existing writer key. This is not yet scale-ready parallel execution.
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
