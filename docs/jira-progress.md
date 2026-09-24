# Jira delivery reconciliation

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
