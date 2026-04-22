## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: none

---

## Testing

Three test layers:

| Layer | Command | What it covers |
|---|---|---|
| Unit | `npm test` | Vitest unit tests |
| E2E — API | `npm run test:e2e` | 28 Playwright API-level tests (`e2e/api.spec.ts`) |
| E2E — UI | `npm run test:e2e` | 13 Playwright browser tests (`e2e/features.spec.ts`) |

E2E tests run against a production preview build (`npm run build && npm run preview` on port 4173). Tests run serially (`workers: 1`) because they share a single SQLite database and each `beforeEach` clears state.

E2E API coverage: Entities CRUD, Relationships CRUD, Canvas Positions upsert — all valid types, error cases (400/404), and ordering.

E2E feature coverage: Wiki (create/edit/preview/search), Timeline (create acts & events, expand rows), World Map (create locations, linked entity chips).

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
