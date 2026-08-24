# Agent Orchestration Plan

Use agents by responsibility, not by arbitrary file count.

## Orchestrator

Responsibilities:
- select milestone/task
- load only relevant architecture files
- delegate implementation
- collect changes
- trigger review/tests
- decide accept/rework
- prepare clean commit/PR

## Suggested agents

```text
domain-agent
backend-agent
database-agent
frontend-agent
pos-agent
storefront-agent
security-agent
qa-agent
review-agent
migration-agent
devops-agent
```

## Loop

```text
Task
 ↓
Context Selection
 ↓
Implementation Agent
 ↓
Domain/Architecture Review
 ↓
Tests
 ↓
Security Review if relevant
 ↓
Fix Loop
 ↓
Acceptance Gate
 ↓
Commit
```

## Context budget rule

Agent loads:
1. overview
2. target context
3. direct dependencies
4. relevant persistence/API/test files

Do not load all 70+ files by default.

## Example Inventory task

Load:
- 00-overview
- 15-inventory
- 31-inventory-persistence
- 34-reliability
- 40-workflows
- 51-api-conventions
- 74-security-test-checklist
- 95-test-scenario-catalog

## Review agent rule

Reviewer receives:
- task goal
- changed files
- architecture files relevant to change
- test output

Not the entire repository context unless necessary.
