# AutoUp

A private Forge app for no-code Jira/JPD field assessments, linked-work numeric rollups, target protection and optional initial population.

## Start here

- [Product requirements](docs/requirements.md): current behavior, limits, pending features and acceptance scenarios.
- [Standalone feature and rebuild plan](plan.md): independent task IDs, implemented work, remaining tasks, dependencies and rebuild sequence.
- [Runtime architecture](docs/runtime-architecture.md): manifest gates, modules, schemas, storage, queues and recovery contracts.
- [Historical notes](docs/history/): superseded requirements/architecture retained for context, not current specifications.

Current application baseline: private development **5.9.0**, source **5f872dd**. Automatic numeric rollups have user-confirmed live evidence for one Story-to-JPD update. Optional population and Done protection are implemented; their live acceptance remains pending. Hierarchy inheritance is preview-only; ordered decisions and external integrations remain pending/deferred as specified.

## Work locally

Read `AGENTS.md`. Use the repository lockfile and a currently supported Node/Forge CLI setup. From the app root:

```sh
npm ci
npm test
npm run lint
forge lint
```

The baseline suite contains 58 automated tests. UI uses native Forge UI Kit. Runtime code lives under `src/runtime/`, admin resolvers under `src/resolvers/`, and the editor in `src/frontend/index.jsx`.

## Deploy and recover

Deploy to the intended private development environment only after checks pass. Preserve the existing Forge app identity and storage namespaces when recovering this installation. A deliberately new app/site requires explicit identity/configuration setup. Follow the detailed steps and acceptance gates in [plan.md](plan.md); do not recreate the app merely to rename it.

Deployment does not automatically activate drafts or populate existing values. Population is opt-in, prepared/reviewed before activation. Only the configured target field is written. The app's history actor name is managed separately from its UI title.

## Keep records current

Every functional change updates requirements, runtime architecture as needed, and `plan.md`. Jira tracking is separate and is not required to rebuild the app. Commit completed changes; synchronize only to the authorized private remote. A failed push is not a backup. Never commit credentials or local dependency folders.

## Contribute and report bugs

See [CONTRIBUTING.md](CONTRIBUTING.md) for picking up unfinished work, proposing new features, and integrating GitHub changes. Record discoveries and fixes in [the bug register](docs/bugs.md). GitHub issue and pull-request templates are included; repository access remains private and owner-controlled.

Verification update (2026-09-25): latency simplification deployed privately as development **5.10.0**. All **61 tests**, ESLint and Forge lint passed. Earlier 5.9.0/58-test references describe the reconstruction baseline; live latency comparison remains pending.
