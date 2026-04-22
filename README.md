# Betwixt and Between

A world-building tool for fiction writers — manage characters, locations, events, and notes in a floating-window desktop-style interface.

## Tech stack

- [SvelteKit](https://kit.svelte.dev/) + TypeScript
- [Drizzle ORM](https://orm.drizzle.team/) + SQLite (via `better-sqlite3`)
- [tldraw](https://tldraw.dev/) for the Story Graph canvas
- [marked](https://marked.js.org/) for Wiki markdown preview

## Developing

```sh
npm install
npm run dev
```

## Building

```sh
npm run build
npm run preview   # preview the production build on port 4173
```

## Database

```sh
npm run db:push      # push schema changes to the local SQLite file
npm run db:studio    # open Drizzle Studio
```

## Testing

Three test layers:

| Layer | Command | What it covers |
|---|---|---|
| Unit | `npm test` | Vitest unit tests |
| E2E — API | `npm run test:e2e` | 28 Playwright API-level tests |
| E2E — UI | `npm run test:e2e` | 13 Playwright browser tests |

E2E tests spin up a production preview server (`npm run build && npm run preview`) and run serially (`workers: 1`) because all tests share a single SQLite database.

```sh
# install Playwright browsers once
npx playwright install firefox

# run all E2E tests
npm run test:e2e
```

E2E API coverage: Entities CRUD, Relationships CRUD, Canvas Positions upsert — all valid types, error cases (400/404), and insertion ordering.

E2E feature coverage: Wiki (create/edit/preview/search), Timeline (acts & events, expand rows), World Map (locations, linked entity chips).

## Deploying

Install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment before deploying.
