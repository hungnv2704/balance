# Personal Finance Multi-Agent Engineering Team

A framework-neutral prompt pack for building a personal finance application with **separate income and expense capabilities**. It combines a shared engineering constitution, one coordinating Orchestrator, and six specialist agents.

## Package contents

```text
personal-finance-agent-team/
├── agent.md                         # Shared Senior Software Engineer standards
├── README.md                         # Setup and operating guide
├── AGENTS.md                         # Repository-wide instructions for coding agents
├── agents/
│   ├── orchestrator.md               # Coordinates the team and integrates results
│   ├── product-manager.md            # Product discovery, requirements, prioritization
│   ├── software-architect.md         # Architecture, domain boundaries, technical decisions
│   ├── backend-engineer.md            # APIs, domain logic, persistence, integrations
│   ├── frontend-engineer.md           # Web/mobile UI, accessibility, client integration
│   ├── qa-engineer.md                 # Test strategy, automation, quality assessment
│   └── security-engineer.md           # Threat modeling, secure design, security verification
├── workflows/
│   ├── feature-delivery-workflow.md   # End-to-end delivery lifecycle and quality gates
│   └── handoff-contract.md            # Standard agent-to-agent handoff format
└── config/
    └── agent-routing.yaml             # Framework-neutral role and routing map
```

## 1. Install in your repository

Copy the contents of this folder into the root of your application repository. Keep the paths above so relative references remain valid.

```text
my-finance-app/
├── AGENTS.md
├── agent.md
├── agents/
├── workflows/
├── config/
├── backend/
├── frontend/
├── database/
└── tests/
```

If your coding environment supports project-level instructions, configure it to load `AGENTS.md` and the relevant role prompt. The exact mechanism differs by AI coding product; this pack does not assume a vendor-specific syntax or runtime.

## 2. Team operating model

- **Orchestrator** is the single coordination and integration point. It receives the request, selects agents, resolves dependencies, tracks decisions, and presents the consolidated result.
- **Product Manager** owns problem definition, scope, user journeys, business rules, prioritization, and acceptance criteria.
- **Software Architect** owns technical design, module boundaries, contracts, architecture decisions, and cross-cutting technical trade-offs.
- **Backend Engineer** owns server-side implementation, financial domain services, APIs, persistence, jobs, and integrations.
- **Frontend Engineer** owns user-facing interfaces, client state, accessibility, interaction behavior, and API integration.
- **QA Engineer** owns test strategy, test design, automation, regression assessment, and evidence-based quality reporting.
- **Security Engineer** owns threat modeling, security requirements, security reviews, and verification of mitigations.

`agent.md` is the shared engineering constitution. Every agent must follow it. Specialist prompts add role-specific responsibilities; they do not override the shared financial, privacy, security, or data-integrity rules.

## 3. Recommended execution sequence

For a new feature, use this sequence (the Orchestrator may skip roles when their work is genuinely irrelevant and must explain why):

1. Product Manager: problem statement, scope, workflows, business rules, acceptance criteria, edge cases.
2. Software Architect: impacted modules, domain model, API/data contracts, architecture decisions, migration and operational implications.
3. Security Engineer: threat review for sensitive data, authorization, imports/exports, attachments, authentication, or other material attack surfaces.
4. Backend and Frontend Engineers: implement against agreed contracts. They may work in parallel once interfaces are stable.
5. QA Engineer: derive and execute tests against acceptance criteria and financial invariants.
6. Security Engineer: verify high-risk controls and remediation evidence where applicable.
7. Orchestrator: review integration, inspect the diff and evidence, report remaining risks, and decide whether the task meets its Definition of Done.

Do not force every task through every agent. A copy-only change may need only the relevant engineer and a lightweight review. A change to balance computation, authentication, data isolation, or financial imports requires deeper cross-functional review.

## 4. How to invoke the team

### Start a feature

> Orchestrator: Deliver the feature described below. Read `AGENTS.md`, `agent.md`, and the relevant repository code first. Delegate requirements to Product Manager, design to Software Architect, implementation to the relevant engineers, and validation to QA/Security as required. Follow `workflows/feature-delivery-workflow.md`. Do not claim checks passed unless you actually ran them. Feature: ...

### Ask for product discovery only

> Product Manager: Turn this idea into a concise PRD, user stories, business rules, edge cases, and testable acceptance criteria. Do not prescribe the technical architecture unless a product constraint requires it. Idea: ...

### Ask for an architecture proposal

> Software Architect: Inspect the current repository and produce an architecture proposal for this requirement. Include alternatives, trade-offs, domain boundaries, data/API contracts, migration implications, security considerations, and an ADR draft. Do not implement code. Requirement: ...

### Ask for implementation

> Backend Engineer / Frontend Engineer: Read the shared standards and relevant project files. Implement only the agreed scope and contracts. Add appropriate tests and documentation. Report changed files, commands actually run, results, and unresolved risks. Task: ...

### Ask for an independent quality review

> QA Engineer: Review the requirement and implementation independently. Identify coverage gaps, design risk-based tests, run available checks, and report evidence. Do not alter production behavior merely to make tests pass.

### Ask for a security review

> Security Engineer: Threat-model this change and review the implementation for authorization, isolation, injection, secrets, privacy, abuse cases, and data-integrity risks. Rank findings by severity and give reproducible evidence and remediation guidance.

## 5. Financial product invariants

These principles apply across all roles:

- Income, expenses, and transfers have distinct business semantics and must not be conflated.
- Internal transfers between a user's own accounts are not income or expenses.
- Money must use integer minor units or exact decimal arithmetic, never binary floating point as the source of truth.
- Every monetary amount has an explicit currency; cross-currency totals require an explicit conversion policy.
- Every financial read and write must enforce authenticated ownership and authorization on the server.
- Financial writes and recurring jobs must be safe against duplicates, retries, and concurrent requests.
- Historical records and reports must remain explainable and auditable.
- Tests and reports must state what was actually verified; do not invent balances, rates, test results, or compliance claims.

## 6. Suggested first project milestone

Before building a large feature set, ask the team to produce and review:

1. A concise MVP PRD and domain glossary.
2. A context diagram and modular architecture proposal.
3. A domain model and initial ER diagram.
4. A decision on how income, expenses, transfers, accounts, and opening balances are represented.
5. API contracts for the first vertical slice.
6. A threat model and authorization matrix.
7. A test strategy with explicit financial invariants.
8. A deployable thin vertical slice: sign-in, create/list income, create/list expense, account balance, and a reconciled summary.

Avoid implementing every report, chart, budget, recurring rule, and import workflow before the core transaction and balance semantics are proven.

## 7. Configuration notes

`config/agent-routing.yaml` is a human-readable role map, not a guaranteed executable configuration. Adapt it to the agent framework you use. Preserve the role boundaries and handoff requirements even if your platform uses different names for agents, tools, or workflows.
