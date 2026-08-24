# Release Strategy

## Release Principle

Deploy small, reversible changes.

## Flow

```text
Feature Branch
→ PR
→ Quality Gates
→ Merge main
→ Build immutable artifact
→ Deploy Staging
→ Integration/Smoke Tests
→ Production rollout
→ Post-deploy verification
```

## Deployment Techniques

Start with rolling deployments.

For high-risk changes consider:

```text
canary
feature flag
dark launch
percentage rollout
```

## Database Compatibility

Use:

```text
Expand
→ Deploy compatible application
→ Backfill/Migrate
→ Switch reads/writes
→ Contract old schema later
```

Never require all application instances to change schema expectations atomically.

## Release Metadata

Track:

```text
releaseId
gitCommit
artifactDigest
migrationVersion
deployedAt
deployedBy
environment
```

## Emergency Release

Hotfixes still require:

- traceable commit
- minimum critical tests
- immutable artifact
- post-deployment verification

Do not manually patch production source files.
