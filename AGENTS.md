# Project Workflow

## Model Roles
- Use GPT-5.5 high for project planning, architecture decisions, risk analysis, and final review.
- Use GPT-5.4 medium for implementation, test execution, and review-driven fixes.

## Required Flow
1. Plan: GPT-5.5 high defines the goal, scope, risks, implementation steps, and verification criteria.
2. Execute: GPT-5.4 medium implements the approved plan with minimal, focused changes.
3. Review: GPT-5.5 high reviews code, behavior, tests, edge cases, and documentation.
4. Fix: If review finds issues, GPT-5.4 medium fixes them, then return to review.
5. Finish: Only close the task after review passes or remaining risks are explicitly documented.

## Quality Rules
- Prefer small, reversible changes that match existing project patterns.
- Verify with relevant tests, builds, or manual checks before final delivery.
- Keep generated documentation concise, practical, and free of filler.
- Document only decisions, usage, risks, and verification details that matter.
