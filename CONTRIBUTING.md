# Contributing to AutoUp

AutoUp remains private. Contributors with repository access may propose bug fixes, unfinished features, or new features through branches and pull requests. This workflow does not grant access, change repository visibility, or authorize production deployment.

## Pick up the work

1. Read README.md, AGENTS.md, docs/requirements.md, plan.md and docs/runtime-architecture.md. The repository must contain enough context to continue without this chat or Jira.
2. Check docs/bugs.md and open pull requests/issues for related work. Choose an existing plan task ID or add a new stable task ID with requirements and acceptance criteria. New ideas remain proposed until their scope is agreed.
3. Fetch the latest origin, check your working tree, and create a feature branch from the intended current base. Preserve local changes; never reset them or force-push to synchronize.
4. Install locked dependencies with npm ci. Run npm test and npm run lint; run pwd in the app root before forge lint. Read the private deployment/rebuild instructions in plan.md. Never reuse another contributor's credentials.

## Track every change

- Features: update plan.md and the relevant requirement IDs in the same pull request. Separate implemented, deployed, and live-verified status.
- Bugs: add a stable BUG-NNN record in docs/bugs.md when discovered, including expected/actual behavior, reproduction, impact, affected version, evidence, and related task. Mark uncertain reports as investigating, not confirmed.
- Fixes: record cause, changed behavior, regression evidence, commit/PR, and deployment/live verification. A local fix is not a deployed fix. Reopen the record if the bug recurs.
- Runtime, manifest, storage, permission, or quota changes: update docs/runtime-architecture.md with limitations and migration/recovery implications.
- Tests: add meaningful regression coverage for behavior fixes. Record required checks and remaining live acceptance. Documentation-only changes need link/diff checks, not deployment.
- Keep Jira optional. GitHub issue numbers can supplement local IDs but must not replace the repository's requirements, tasks, or reproducible bug details.

## Submit and integrate

Keep pull requests focused. Use the provided template to describe the problem, outcome, requirements/task/bug IDs, tests, and operational effects. Propose new features with the feature-request template before a large implementation. Include no credentials, customer payloads, or customer-specific example keys; use ABC-123.

Review incoming GitHub changes against the same architecture and acceptance rules before merging or deploying. Resolve conflicts by preserving intended behavior and rerun affected checks. Update plan and bug records with the integrated result. Do not assume external contributions are verified because they compile.

Manifest filters come first; Boolean gates use Jira Expressions where supported. Preserve narrow reads, unchanged-write suppression, cycle/ownership checks, private distribution and opt-in population. Explain unsupported conditions explicitly.

Commit completed work and push to the authorized private remote. Report any push failure; never claim local work is backed up remotely until verified. Repository access is controlled by the owner. Publishing, adding collaborators and production deployment require their own authorization.
