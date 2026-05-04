## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: none

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask until you reach at least 95% confidence.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## Testing

All tests live under `tests/`, split into three buckets by use pattern. Two Vitest projects (`unit` and `integration`) plus Playwright for `e2e`.

```
tests/
  unit/           Pure logic, no DB, no I/O. Mocked fetch where needed.
  integration/    DB-backed (in-process PGlite via tests/helpers/test-db.ts)
                  or handler-level via vi.mock of $lib/server/db/index.js.
  e2e/            Playwright against the running preview server.
  helpers/        Shared fixtures: test-db.ts (createTestDb, seedActs, SCHEMA_DDL).
```

| Layer | Command | What it covers |
|---|---|---|
| Unit (Vitest) | `npm test -- --project unit` | Pure math, store logic, navigation routing |
| Integration (Vitest) | `npm test -- --project integration` | DB-backed + API handlers via vi.mock |
| All Vitest | `npm test` | Both projects above |
| E2E | `npm run test:e2e` | Playwright tests against `npm run preview` |

E2E tests build and serve a production preview (`npm run build && npm run preview`) on port 4173, with `tests/e2e/global-setup.ts` booting an in-process PGlite over a localhost socket and stamping `DATABASE_URL` before the preview spawns. Tests run serially (`workers: 1`) because they share a single PGlite instance and each `beforeEach` clears state.

**Coverage as of Phase 1A PR 1**: 215 Vitest tests (83 unit + 132 integration) across 17 files, plus 53 Playwright tests across 4 e2e specs. Critical regression cases for the appears_in hijack, polymorphic FK type-safety, migration idempotency, malformed-row policy, and Delete-Act cascade are all in `tests/integration/`.

**Vitest config pattern**: `vite.config.ts` declares two named projects under `test.projects[]`. Both extend the same base config but include different glob patterns (`tests/unit/**` vs `tests/integration/**`). Run them separately or together via `--project <name>`.

---


## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **betwixt-and-between** (1850 symbols, 2463 relationships, 68 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/betwixt-and-between/context` | Codebase overview, check index freshness |
| `gitnexus://repo/betwixt-and-between/clusters` | All functional areas |
| `gitnexus://repo/betwixt-and-between/processes` | All execution flows |
| `gitnexus://repo/betwixt-and-between/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
