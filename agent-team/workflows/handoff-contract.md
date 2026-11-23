# Agent-to-Agent Handoff Contract

Use this format whenever one agent delegates work to another or returns a deliverable. Keep it brief for small tasks and detailed for high-risk changes.

## Handoff request

```markdown
### Handoff
- From:
- To:
- Task / feature:
- Requested outcome:
- Relevant files, modules, links, or decisions:
- Approved scope:
- Out of scope:
- Constraints and invariants:
- Dependencies:
- Required deliverable:
- Acceptance / review criteria:
- Risk level: Low | Medium | High | Critical
- Questions requiring a decision:
```

## Handoff response

```markdown
### Handoff result
- Agent / role:
- Status: Complete | Partially complete | Blocked
- Summary:
- Decisions made:
- Files / artifacts changed:
- Contracts or assumptions used:
- Tests / checks performed:
- Exact results and evidence:
- Checks not performed and why:
- Risks / limitations:
- Open questions:
- Recommended next owner / action:
```

## Rules

1. Do not mark a task complete if the required artifact or evidence is missing.
2. Separate facts from assumptions and recommendations.
3. Do not silently change approved product semantics or public contracts.
4. Identify breaking changes, migrations, security impact, and data-integrity implications explicitly.
5. Use synthetic examples; never place real credentials or private financial data in handoffs.
6. Include exact test commands and outcomes; "tests passed" without evidence is insufficient.
7. The receiving agent must acknowledge contract gaps before implementing against ambiguous behavior.
8. The Orchestrator owns cross-agent integration and the final user-facing report.
