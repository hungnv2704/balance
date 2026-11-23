# Feature Delivery Workflow

This workflow defines how the Orchestrator coordinates a feature from idea to verifiable delivery. Scale the ceremony to the risk and size of the change; never skip essential financial-integrity or security checks.

## Phase 0 — Intake and repository discovery

**Owner:** Orchestrator

- Classify the request and identify the expected user outcome.
- Read `AGENTS.md`, `agent.md`, relevant docs, code, tests, configuration, and prior decisions.
- Identify affected modules, constraints, dependencies, data sensitivity, and risk level.
- Record confirmed facts separately from assumptions.

**Output:** task brief, initial risk assessment, agent plan.

## Phase 1 — Product definition

**Owner:** Product Manager

- Define problem, users, desired outcome, workflow, MVP scope, and non-goals.
- Specify business rules, states, validations, permissions, date/currency semantics, and failure behavior.
- Write user stories and testable acceptance criteria.
- Resolve product decisions or list them as blocking open questions.

**Gate 1:** no implementation until behavior is sufficiently clear. A tiny bug fix may use existing acceptance criteria.

## Phase 2 — Technical design

**Owner:** Software Architect

- Identify domain modules and source-of-truth data.
- Define affected interfaces, API/data contracts, persistence, transaction boundaries, and integration behavior.
- Document financial invariants and idempotency/concurrency needs.
- Plan migrations, compatibility, observability, rollout, and recovery.
- Write an ADR for consequential decisions.

**Gate 2:** Backend and Frontend contracts must be stable enough for parallel work. Orchestrator records unresolved decisions.

## Phase 3 — Security review

**Owner:** Security Engineer; mandatory for material sensitive-data or trust-boundary changes

- Threat-model new or changed attack surfaces.
- Review authentication, authorization, ownership, data exposure, imports/exports, attachments, secrets, and abuse cases as relevant.
- Create actionable requirements and tests.

**Gate 3:** high-risk security requirements are assigned before implementation. A release-blocking finding must not be waived by an implementation agent.

## Phase 4 — Implementation

**Owners:** Backend Engineer and/or Frontend Engineer

- Implement only the approved scope and agreed contracts.
- Keep changes incremental and reviewable.
- Add unit and appropriate integration/component tests alongside code.
- Update schema migrations, docs, API contracts, and operational configuration.
- Avoid concurrent edits to the same files unless coordinated.

**Output:** implementation, tests, migration(s), documentation, implementation handoff.

## Phase 5 — Quality verification

**Owner:** QA Engineer

- Trace acceptance criteria to tests.
- Execute risk-based unit, integration, API/contract, E2E, regression, accessibility, and performance checks as relevant.
- Validate financial invariants, cross-user isolation, retries, and failure handling where relevant.
- Distinguish code defects from test/environment failures.

**Gate 4:** report exact commands, environment, results, failures, and coverage gaps. A green suite does not prove untested behavior.

## Phase 6 — Security verification

**Owner:** Security Engineer; required when Phase 3 applied or implementation changed sensitive controls

- Verify that agreed mitigations are present.
- Review actual code/configuration and evidence, not only design statements.
- Confirm high-risk findings are fixed or explicitly remain release blockers.
- Record residual risk and testing limitations.

## Phase 7 — Integration and release readiness

**Owner:** Orchestrator

Check:
- Product acceptance criteria are met.
- Architecture and API contracts are consistent.
- Income, expense, transfer, balance, and report semantics reconcile.
- Authorization and user isolation are enforced and tested.
- Migrations are safe and deployment sequencing is clear.
- QA and Security evidence is reviewed.
- Monitoring, rollback, and recovery plans exist where needed.
- Documentation and Definition of Done are satisfied.

**Output:** one consolidated delivery report and a readiness recommendation: Ready, Ready with documented risks, Not ready, or Unable to assess.

## Risk-based shortcuts

- **Low risk:** a small copy/style change may skip architecture and security agent involvement; run relevant UI checks.
- **Medium risk:** a new form or API endpoint usually needs product, implementation, and QA review; include security if data access changes.
- **High risk:** authentication, authorization, balances, transfers, currency conversion, imports, exports, recurring writes, attachments, or migrations require architecture, security, and QA review.
- **Critical risk:** ledger/balance model changes, cross-user data boundaries, cryptographic/session design, or destructive migration require explicit user-visible risk disclosure and a recovery plan before action.

## Incident and bug-fix path

1. Reproduce safely and assess user/data impact.
2. Preserve evidence without exposing sensitive data.
3. Identify containment needs before a broad fix.
4. Patch the smallest safe scope and add a regression test.
5. Verify financial reconciliation and access boundaries.
6. Document root cause, affected scope, corrective/preventive actions, and any recovery steps.
