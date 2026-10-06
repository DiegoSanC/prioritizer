# Prioritizer

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels are used as-is (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Development doctrine

These rules govern the inner development loop for any change in this repo. They complement — never replace — code review and CI.

### Working loop
1. **Seams before tests.** Before writing any test, identify the public interfaces (seams) where behavior will be verified — as few and as high as possible — and state them in your plan.
2. **TDD in vertical slices.** Red → green: one failing test, then the minimal implementation that passes it, then repeat. Never write all the tests upfront and the code afterwards.
3. **Test observable behavior only,** through public interfaces. Do not test internals or mock internal collaborators; a good test survives refactors.
4. **Expected values come from an independent source** — a known-good literal, a worked example, the spec — never recomputed the same way the code computes them (a tautological test passes by construction).
5. **Verify continuously.** Typecheck and run the touched test files frequently; run the full test suite once at the end.
6. **Refactor outside the red-green loop.** Refactoring belongs to the review stage, not mid-cycle.
7. **Use the domain vocabulary** from the project's glossary (`CONTEXT.md`) and respect ADRs in the area you touch (`docs/adr/`).
8. **Self-review before delivering, on two axes:** does the change follow this repo's standards, and does it faithfully implement what was asked — nothing missing, nothing extra.

### Acceptance tests as oracles
9. **Acceptance criteria become executable tests before implementing.** The acceptance test is the stop condition: done is when it passes, not when the implementation looks right.
10. **No orphan criteria.** Every acceptance criterion maps to at least one test assertion; a criterion no test asserts is a silent "passes-but-wrong" gap.
11. **Validate against the real boundary.** Acceptance/validation tests run against the real infrastructure the change integrates with, not an in-process mock of the seam under test. Use Docker containers for everything that can be containerized: databases, message queues/brokers, caches, object stores and cloud APIs (e.g. MinIO for S3-compatible storage, LocalStack for AWS services). For external functionality that cannot be containerized, build small scripts or record-replay simulators outside the product code to stand in for it. Fake only what the change does not own.
12. **Golden manifests for deterministic transforms.** Expected outputs are fixed externally (golden files/hashes); the implementation must match the manifest, never the other way around.
13. **Acceptance tests are extend-only.** Never weaken or delete an existing assertion to make a change pass; if an assertion looks wrong, raise it as a decision instead of editing it.
14. **Shared contracts are read-only.** Interfaces other code consumes are never mutated silently; changing one is a decision to surface, not a refactor.
15. **Stop loudly, never loop silently.** If an acceptance test stays red after honest attempts, report the failing assertions and stop, rather than iterating indefinitely or weakening tests.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
