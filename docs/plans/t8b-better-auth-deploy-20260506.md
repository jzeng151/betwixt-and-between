# T8b: Better-Auth + Neon Deploy + Multi-User

## Context

The app currently has zero auth — every API endpoint is open, all data is global. T8b adds multi-user support via Better-Auth (magic-link + Google OAuth), gates all routes by `session.user.id`, adds isolation tests, and deploys to Fly.io with Neon Postgres. This is the final major infrastructure milestone before the app can be shared.

**Branch**: `feat/oauth` off `main` at `adc3b3e`
**Locked decisions**: CONSIDERATIONS.md `[2026-05-01] T8 split`

---

## Slices

### S1: Better-Auth library + schema + hooks (invisible)

No visible changes. Auth handle is a no-op when no session cookie exists.

**Create**:
- `src/lib/server/auth.ts` — Better-Auth config (Drizzle pg adapter, magic-link plugin, Google OAuth provider, test mode when `BETWIXT_E2E_PGLITE=1`, `basePath: '/api/auth'`, `generateId: () => crypto.randomUUID()`)
- `src/lib/auth-client.ts` — `createAuthClient()` for browser-side

**Modify**:
- `src/lib/server/db/schema.ts` — Add `user`, `session`, `account`, `verification` tables (Better-Auth convention, uuid PKs). Column names match what Better-Auth's Drizzle adapter expects.
- `src/hooks.server.ts` — Wrap Better-Auth SvelteKit handler into `sequence()`. Sets `event.locals.user` / `event.locals.session` from cookie, or `null`.
- `src/app.d.ts` — Populate `App.Locals` with `{ user, session }` types.
- `package.json` — Add `better-auth` dep.
- Run `npm run db:generate` → `drizzle/0004_*.sql` (auth tables migration)

**Verify**: `npm run check && npm test` pass (auth handle is passive; no handler reads locals yet).

---

### S2: Auth pages + API route + /app redirect

**Create**:
- `src/routes/api/auth/[...all]/+server.ts` — Catch-all delegating to Better-Auth handler
- `src/routes/auth/+layout.svelte` — Minimal auth layout (centered container, dark background, no app chrome)
- `src/routes/auth/login/+page.svelte` — Email input for magic-link, optional Google button
- `src/routes/auth/verify/+page.svelte` — "Check your email" post-submit page

**Modify**:
- `src/routes/app/+layout.server.ts` (new) — `load` returns `{ user: locals.user }`, throws `redirect(302, '/auth/login')` if null
- `.env.example` — Add `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

**Verify**: `npm run check && npm test` pass. Manual: `/app` redirects to `/auth/login`.

---

### S3: userId migration (nullable columns)

Nullable so existing data and tests are unaffected. Handlers populate it going forward.

**Modify**:
- `src/lib/server/db/schema.ts` — Add `userId` (uuid, FK→user.id, ON DELETE CASCADE, nullable) to: `entities`, `relationships`, `intervals`, `canvasPositions`, `windowCanvasState`, `worldMaps`. Add `*_user_id_idx` indexes.
- Run `npm run db:generate` → `drizzle/0005_*.sql`

**Transitively scoped** (no direct userId needed, scoped via parent JOIN):
- `entityAliases` — scoped via `entities.userId` (primaryEntityId FK, already JOINed)
- `mapRegions` — scoped via `worldMaps.userId` (mapId FK, already JOINed)
- Notes (folders/entries) — these are entities with specific data shapes; scoped via `entities.userId`

**Verify**: `npm run check && npm test` pass.

---

### S4: Auth gating helper + test infrastructure

**Create**:
- `src/lib/server/auth-gate.ts` — `requireUser(event)` returns user or throws 401; `getUserId(event)` shorthand.
- `tests/helpers/authed-request.ts` — Shared `setupAuth(db)` helper: calls `seedTestUser`, returns `{ user, mkEvent(overrides) }` where mkEvent includes `locals: { user, session }`. All integration tests import this instead of copy-pasting the auth-in-mkEvent pattern.

**Modify**:
- `tests/helpers/test-db.ts` — Add `seedTestUser(db, overrides?)` helper: inserts a row into `user` table, returns `{ id, name, email }`.

**Verify**: `npm run check && npm test` pass (nothing uses the helper yet).

---

### S5: Gate all routes + thread userId through interval functions

Wire `getUserId()` into all 22 handlers. Every SELECT gets `where(eq(table.userId, userId))`. Every INSERT includes `userId`. Single-entity lookups use `and(eq(id, params.id), eq(userId, userId))` — wrong-owner returns 404 (not 403, avoids existence leakage).

**Critical: cascade operations must also be scoped.** The entity PATCH position-cascade and DELETE act-rescoping logic queries siblings by `type + parentId`. For Acts (`parentId IS NULL`), two users have overlapping sibling sets. Every cascade query needs `AND user_id = $1`.

**Critical: interval functions need userId threading.** `recomputeAllIntervals`, `recomputeIntervalsForAct`, `moveSceneToAct` in `src/lib/server/intervals.ts` currently operate globally (`SELECT * FROM intervals`). Add a `userId` parameter and filter all internal queries. Route handlers pass `getUserId(event)` into these functions.

**Handlers** (22 files):
- `entities/+server.ts` — GET: userId filter. POST: set userId, add userId to insert-between cascade WHERE.
- `entities/[id]/+server.ts` — GET/PATCH/DELETE: add userId to WHERE. **Cascade position bumps**: add userId to sibling update WHERE. **Act rescoping during DELETE**: add userId to all cascade queries.
- `entities/batch/+server.ts` — POST: set userId on each entity.
- `relationships/+server.ts` — GET: userId filter. POST: set userId, verify fromId/toId belong to user.
- `relationships/[id]/+server.ts` — PATCH/DELETE: userId filter.
- `intervals/+server.ts` — GET: userId filter. POST: set userId, verify entityId belongs to user.
- `intervals/[id]/+server.ts` — GET/PATCH/DELETE: userId filter.
- `intervals/[id]/split/+server.ts` — POST: verify interval belongs to user, set userId on splits.
- `canvas-positions/+server.ts` — GET/PUT: userId filter/set.
- `canvas-positions/window/[windowId]/+server.ts` — GET/PUT/DELETE: userId filter on `windowCanvasState` (direct column).
- `canvas-positions/window/[windowId]/batch/+server.ts` — POST: userId filter/set.
- `entity-aliases/+server.ts` — GET: JOIN entities for userId filter. POST: verify both entities belong to user.
- `entity-aliases/[id]/+server.ts` — DELETE: verify via JOIN.
- `notes/entries/+server.ts`, `notes/entries/[id]/+server.ts` — userId filter (notes are entities).
- `notes/folders/+server.ts`, `notes/folders/[id]/+server.ts` — userId filter.
- `maps/+server.ts` — GET: userId filter. POST: set userId.
- `maps/[id]/+server.ts` — GET/PATCH/DELETE: userId filter.
- `maps/[id]/regions/+server.ts` — POST: verify map belongs to user via JOIN.
- `maps/[id]/regions/[rid]/+server.ts` — PATCH/DELETE: verify via JOIN on worldMaps.userId.
- `maps/[id]/upload-image/+server.ts` — Verify map ownership.

**Modify** (interval functions):
- `src/lib/server/intervals.ts` — Add `userId` param to `recomputeAllIntervals`, `recomputeIntervalsForAct`, `moveSceneToAct`. Filter all internal SELECT/UPDATE queries by userId.

**Tests** (~25 files): Update each file's `mkEvent` call to use `setupAuth(db).mkEvent`. Add `userId` to direct DB inserts.

**Verify**: `npm run check && npm test` pass.

---

### S6: Isolation tests (~21 explicit tests)

**Create** (5 files):
- `tests/integration/auth-isolation-entities.test.ts` — User B can't see/modify user A's entities (list empty, individual 404, PATCH 404, DELETE 404, batch with A's parentId fails).
- `tests/integration/auth-isolation-relationships.test.ts` — User B can't see A's rels, can't create rel between A's entities.
- `tests/integration/auth-isolation-intervals.test.ts` — User B can't see/create/modify A's intervals.
- `tests/integration/auth-isolation-maps.test.ts` — User B can't see/create/modify A's maps or regions.
- `tests/integration/auth-unauthenticated.test.ts` — No session → 401 from every endpoint group.
- Extra tests in `auth-isolation-entities.test.ts`:
  - Position cascade scoped by userId: user A reorders Acts, user B's positions unchanged
  - Act delete rescoping scoped by userId: user A deletes Act, user B's intervals unaffected
  - User FK cascade: delete user row → entities/relationships/intervals cascade-deleted
- Extra test in `auth-isolation-intervals.test.ts`:
  - moveSceneToAct scoped by userId: user A moves scene, user B's intervals unchanged

Pattern: `beforeEach` seeds two users via `seedTestUser`. Seeds data as userA. Attempts operations as userB. Asserts 404/empty/401.

**Verify**: `npm test` passes. Isolation tests fail if cross-user access is possible.

---

### S8: Auth E2E + fix existing E2E suite

This is the L-complexity slice: existing E2E suite (27+ specs) hits API endpoints without sessions. After gating, they all break. Fix by creating a shared auth fixture.

**Create**:
- `tests/e2e/helpers/auth.ts` — Playwright helper: inserts test user into PGlite, calls magic-link API in test mode, returns authenticated `Page` (cookie set).
- `tests/e2e/auth-magic-link.spec.ts` — Full magic-link flow: /app → /auth/login → email → code → /app.
- `tests/e2e/auth-google-oauth.spec.ts` — Mock Google OAuth → /app.
- `tests/e2e/auth-logout.spec.ts` — Login → logout → /app redirects to login.
- `tests/e2e/auth-expired-session.spec.ts` — Login → expire session in DB → /app redirects.

**Modify** (~27 files): Every existing E2E spec gets `test.use({ storageState: ... })` or a `beforeEach` that calls the auth helper to get an authenticated page. This is mechanical but high-volume.

**Modify** `playwright.config.ts` — Add `BETTER_AUTH_SECRET` to webServer env.

**Verify**: `npm run test:e2e` passes (all auth + existing specs).

---

### S9: Deploy infrastructure

**Create**:
- `Dockerfile` — Multi-stage node:24-alpine: build + slim runtime, expose 3000.
- `fly.toml` — App config, health check, primary_region.
- `.github/workflows/deploy.yml` — On push to main: fly deploy --remote-only.
- `.github/workflows/backup.yml` — Weekly cron: pg_dump | gpg | rclone to Backblaze B2.
- `DEPLOY.md` — Setup guide: Neon project, Fly.io app, secrets, first deploy, backup verify.

**Modify**:
- `.env.example` — Add `BETTER_AUTH_URL`, deploy-related vars.

**Verify**: `fly deploy` to staging succeeds. Health check passes.

---

## Dependency graph

```
S1 → S2 → S3 → S4 → S5 → S6 → S8 → S9
```

9 slices, linear. Each slice typechecks and tests green independently.

## Key files

| File | Role |
|------|------|
| `src/lib/server/db/schema.ts` | Auth tables (S1), userId columns (S3) |
| `src/hooks.server.ts` | Auth middleware entry point (S1) |
| `src/routes/api/entities/+server.ts` | Reference implementation for gating pattern (S5) |
| `src/lib/server/auth-gate.ts` | `requireUser` / `getUserId` helper (S4) |
| `src/lib/server/intervals.ts` | `recomputeAllIntervals` etc. need userId threading (S5) |
| `tests/helpers/test-db.ts` | `seedTestUser` helper (S4) |
| `tests/helpers/authed-request.ts` | Shared `setupAuth` / `mkAuthedEvent` factory (S4) |
| `tests/integration/api-entities.test.ts` | Reference for mkEvent auth pattern (S5) |

---

## What already exists

| Existing code | What it does | Plan reuses? |
|---------------|-------------|-------------|
| `src/hooks.server.ts` — empty `sequence()` | Hook chain entry point | Yes, adds auth handle as first item |
| `src/app.d.ts` — `Locals` interface placeholder | Type declarations | Yes, populates with user/session types |
| `mkEvent` factory in each integration test | Creates mock RequestEvent objects | Yes, extends with `locals.user` |
| `createTestDb()` in `tests/helpers/test-db.ts` | PGlite + migration + Drizzle setup | Yes, extends with `seedTestUser()` |
| E2E PGlite socket server (`tests/e2e/global-setup.ts`) | Boots PGlite for Playwright | Yes, auth tables auto-created via migration |
| `adapter-node` in `svelte.config.js` | Production build adapter | Yes, used by Fly.io Dockerfile |

---

## NOT in scope

| Deferred item | Reason |
|---------------|--------|
| Account deletion / GDPR machinery | Flagged in CONSIDERATIONS.md, not blocking v0 launch |
| pgcrypto column-level encryption (T12) | Deferred per CONSIDERATIONS.md, depends on user feedback |
| T14 endpoint registry route-tree generator | Deferred per TODOS.md, depends on T8b merging |
| GitHub OAuth provider | Locked decision: Google only for v0, others trivial to add |
| userId NOT NULL enforcement | Nullable for v0, strict enforcement after data migration |
| Rate limiting on auth endpoints | Not blocking for a small user base |
| Email delivery service setup | Magic-link test mode works in dev/E2E; production email (Resend/SES) is deploy config |
| E2E tests in CI | Current CI only runs Vitest. Adding Playwright to CI is a separate concern. |
| Admin panel / user management | Not needed for v0 |

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAN | 7 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |

UNRESOLVED: 0
VERDICT: ENG CLEARED — ready to implement
