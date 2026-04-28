# Development

## Tech stack

- [SvelteKit](https://kit.svelte.dev/) + TypeScript
- [Drizzle ORM](https://orm.drizzle.team/) + SQLite (`better-sqlite3`)
- [tldraw](https://tldraw.dev/) for the Story Graph canvas
- [marked](https://marked.js.org/) for Wiki markdown preview

## Setup

**Prerequisites:** Node.js 18+, npm

```sh
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

## Database

```sh
npm run db:push      # apply schema changes to the local SQLite file (dev shortcut)
npm run db:generate  # generate a new migration from schema changes
npm run db:migrate   # run all pending migrations
npm run db:studio    # open Drizzle Studio to browse the database
```

### intervals migration (one-time, post-schema-migrate)

The Phase 1A PR 1 schema migration adds the `intervals` table and `parent_id` /
`position` columns on `entities`. After `npm run db:migrate` applies the schema,
the data migration converts existing `appears_in` relationships into intervals.

**Always snapshot before running against any DB with real data:**

```sh
DATABASE_URL=local.db npx tsx scripts/migrations/snapshot-pre-intervals.ts
DATABASE_URL=local.db npx tsx scripts/migrations/intervals-migration.ts
```

Successfully migrated `appears_in` rows are removed from `relationships`. Malformed rows
(orphan FK, type mismatch, duplicates) are logged to `migration-warnings.txt` and
left in `relationships` for manual cleanup. The migration is idempotent — running it
twice is a no-op.

To restore from the most recent snapshot:

```sh
DATABASE_URL=local.db npx tsx scripts/migrations/restore-pre-intervals.ts
```

The current DB is moved aside to `local.db.pre-restore-{stamp}` before the snapshot
copies in, so a botched restore is also recoverable.

See `CONSIDERATIONS.md` ("Migration: rollback and recovery") for the full rationale.

## Building

```sh
npm run build
npm run preview   # serve the production build on port 4173
```

## Testing

All tests live under `tests/` split into three buckets by use pattern:

```
tests/
  unit/         Pure logic, no DB. Mocked fetch.
  integration/  DB-backed (in-memory SQLite) + API handler tests via vi.mock.
  e2e/          Playwright against the running preview server.
  helpers/      Shared test fixtures (test-db.ts).
```

Vitest is configured with two named projects (`unit` and `integration`) that share a base config but match different glob patterns. Run them independently or together.

```sh
npm test                              # all Vitest (unit + integration)
npm test -- --project unit            # fast, no DB
npm test -- --project integration     # DB-backed, ~2s
npm run test:e2e                      # Playwright, ~60s incl. build
```

E2E tests build and serve a production preview (`npm run build && npm run preview`) on port 4173, then run serially (`workers: 1`) because all tests share a single SQLite database.

```sh
# Install Playwright browsers (once)
npx playwright install firefox

npm run test:e2e
```

**Vitest unit + integration coverage**: 215 tests across 17 files. See `tests/unit/` for pure logic + store behavior; `tests/integration/` for migration, invariants, cascade chains, API handlers, hijack regression. Shared in-memory DB factory at `tests/helpers/test-db.ts`.

**E2E API coverage**: Entities CRUD, Relationships CRUD, Canvas Positions upsert — all valid types, error cases (400/404), and insertion ordering.

**E2E feature coverage**: Wiki (create/edit/preview/search), Timeline (acts & events, expand rows), World Map (locations, linked entity chips), Story Flow (create-character-in-30s + InlineEdit + Story Graph empty-overlay), Window Manager (open / focus / drag / minimize / z-index).

## Deploying

The current build uses a local SQLite file. For self-hosted deployments (a VPS or container where the filesystem persists), install the Node adapter:

```sh
npm install @sveltejs/adapter-node
```

Then update `svelte.config.js` to use `adapter-node` instead of `adapter-auto`.

For serverless platforms (Vercel, etc.) the SQLite file won't persist across function invocations. A cloud-hosted database is required — [Turso](https://turso.tech) is SQLite-compatible and requires minimal changes to the existing Drizzle schema.
