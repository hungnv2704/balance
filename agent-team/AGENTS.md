# Repository Instructions for AI Coding Agents

## Source of truth

1. Read `agent.md` before making material changes. It defines shared engineering, financial-domain, security, and delivery standards.
2. Read the relevant specialist prompt under `agents/` before undertaking that role's work.
3. Read `workflows/handoff-contract.md` when delegating or receiving work from another agent.
4. Read `workflows/feature-delivery-workflow.md` for feature-sized changes.
5. Existing repository code, tests, migration history, and approved product decisions are authoritative over assumptions in a prompt pack. Identify conflicts rather than silently overriding them.

## General behavior

- Inspect the repository before proposing or editing code. Do not assume its language, framework, database, hosting provider, or directory conventions.
- Keep changes scoped, incremental, and reviewable. Do not perform unrelated refactors.
- State assumptions when they affect behavior. Ask only when a missing decision blocks safe progress; otherwise use a conservative assumption and document it.
- Do not fabricate files, tool results, API behavior, test outcomes, operational status, or compliance claims.
- Never expose secrets or sensitive financial information in source code, logs, test output, screenshots, or documentation.
- Do not run destructive commands, production operations, or irreversible data changes without explicit authorization and a recovery plan.

## Finance-specific rules

- Keep income, expense, and internal transfer semantics distinct.
- Do not count internal transfers as income or expenses.
- Use exact monetary arithmetic and explicit currency codes.
- Enforce user/account ownership on every server-side access path.
- Design financial writes, imports, and recurring jobs for idempotency and concurrency safety.
- Preserve historical meaning, traceability, and reconciliation of balances and reports.

## Completion report

At the end of a task, report:

1. What changed and why.
2. Files/modules affected.
3. Tests, linters, builds, scans, or commands actually run, with exact outcomes.
4. Checks not run and why.
5. Migrations, configuration, deployment, or manual steps required.
6. Remaining assumptions, risks, and follow-up work.
