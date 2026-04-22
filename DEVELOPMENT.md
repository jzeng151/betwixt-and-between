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

## Building

```sh
npm run build
npm run preview   # serve the production build on port 4173
```

## Testing

Three test layers:

| Layer | Command | What it covers |
|---|---|---|
| Unit | `npm test` | Vitest unit tests |
| E2E — API | `npm run test:e2e` | 28 Playwright API-level tests |
| E2E — UI | `npm run test:e2e` | 13 Playwright browser tests |

E2E tests build and serve a production preview (`npm run build && npm run preview`) on port 4173, then run serially (`workers: 1`) because all tests share a single SQLite database.

```sh
# Install Playwright browsers (once)
npx playwright install firefox

# Run all tests
npm run test:e2e
```

E2E API coverage: Entities CRUD, Relationships CRUD, Canvas Positions upsert — all valid types, error cases (400/404), and insertion ordering.

E2E feature coverage: Wiki (create/edit/preview/search), Timeline (acts & events, expand rows), World Map (locations, linked entity chips).

## Deploying

The current build uses a local SQLite file. For self-hosted deployments (a VPS or container where the filesystem persists), install the Node adapter:

```sh
npm install @sveltejs/adapter-node
```

Then update `svelte.config.js` to use `adapter-node` instead of `adapter-auto`.

For serverless platforms (Vercel, etc.) the SQLite file won't persist across function invocations. A cloud-hosted database is required — [Turso](https://turso.tech) is SQLite-compatible and requires minimal changes to the existing Drizzle schema.
