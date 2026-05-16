## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: none

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
