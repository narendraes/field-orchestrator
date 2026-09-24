# Recovery status

Recovered from the September 23 backup and recorded changes in the development conversation. Original Git history was unavailable; the private repository starts at the recovery baseline.

## Reconstructed

Revision-bound validation, failure invalidation, activation reviews and expiring tokens, manifest-filtered creation processing, correct protection trace classification, and regression coverage. The requested in-editor save/test/activate/deactivate flow is also implemented.

## Verification boundary

Local regression tests use mocked Jira and KVS; they do not prove live Jira event delivery, expression compatibility, or rendered UI behavior. Recovery and follow-up diagnostics were deployed to private development as version 5.4.0 on September 24, 2026. Deployment does not establish live acceptance. Before deploying, review these limitations and perform acceptance against a controlled Jira test project. Existing concurrent storage and cross-context option limitations remain. Ordered outcomes and live relationship/hierarchy processing were never completed and remain pending.
