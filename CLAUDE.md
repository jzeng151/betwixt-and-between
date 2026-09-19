# betwixt-and-between

SvelteKit + Cloudflare Workers app for composing stories: typed entities (Character, Location, Event, Act, Scene, Note), directed/symmetric edges (`relationships`), Premise-4 fractional-position story-time axis (`intervals`), and per-Location polygon world-maps. Neon Postgres + Better-Auth.

## Documentation

- For request lifecycle, authentication, and environment precedence, read [src/hooks.server.ts](src/hooks.server.ts) and [src/lib/server/auth.ts](src/lib/server/auth.ts).
- For deployment and runtime bindings, read [DEPLOY.md](DEPLOY.md) and [wrangler.jsonc](wrangler.jsonc).
- For schema, API, and relationship references, run `npm run docs:all`. It creates gitignored local files at `docs/schema.md`, `docs/api.md`, and `docs/edges.md`; they are absent in a fresh checkout.
- [docs/adr/](docs/adr/) — tracked architecture decisions.

## Conventions

- **Server-only code lives in `src/lib/server/**`.** Client modules may use `import type` from there. Put shared runtime declarations outside that directory; SvelteKit rejects browser imports of server modules even when the imported value is a const array.
- **Never set `updated_at` or `created_at` on UPDATE in app code.** A `bump_updated_at` BEFORE UPDATE trigger maintains them on `entities`, `intervals`, `world_maps`, `user_preferences`.
- **`relationships` is a discriminated union of typed edges.** Types are declared in [schema.ts](src/lib/server/db/schema.ts); write validation lives in the [relationship route](src/routes/api/relationships/+server.ts), with graph policy in [edge-policy.ts](src/lib/features/graph/edge-policy.ts).
- **`window_canvas_state.pinned` is `integer` 0/1, not `boolean`.** Schema, validators, and client all assume the integer shape.
- **Story ownership:** narrative handlers call `getStoryId(event)`, which verifies account ownership. Scope narrative tables by `storyId`; aliases inherit it through entities, and map anchors/events through world maps. Account preferences and exports use `getUserId(event)`. See [ADR 0010](docs/adr/0010-story-ownership.md) before changing these boundaries.
- **Polymorphic FK invariants** (e.g. `intervals.start_act_id` must reference a row of `type='Act'`) are enforced at the application layer + Vitest invariant tests, not at the DB. Adding a new polymorphic FK requires both.
- **Svelte 5 runes.** Use `$state` / `$derived` / `$effect` / `let { ... } = $props()`. No `$:` reactive statements, no `export let`.

## Maintenance protocol

Every change of these shapes must touch the matching doc in the same commit. CI does not enforce this; reviewers do.

| Change | Required action |
|---|---|
| Modify `src/lib/server/db/schema.ts` or add a `drizzle/*.sql` migration | `npm run docs:schema` |
| Add or remove a route under `src/routes/api/` | `npm run docs:api`, then fill the per-route `error responses` and `list bounds` MANUAL block in `docs/api.md` |
| Add a new value to `RelationshipType` | `npm run docs:edges`, then extend `ENDPOINT_MAP` and `TEMPORAL_MAP` in `scripts/docs/generate-edges-md.ts` and re-run |
| Make an architectural decision worth keeping | Add a numbered ADR under `docs/adr/` |

`npm run docs:all` runs all three generators. Re-running on unchanged sources is a no-op (byte-identical output); per-route MANUAL blocks in `docs/api.md` are preserved across regenerations via `<!-- BEGIN MANUAL: ... --> ... <!-- END MANUAL: ... -->` sentinels.

## Testing

| Layer | Command | Coverage |
|---|---|---|
| Unit + integration (Vitest) | `npm test` | Pure logic, store logic, DB-backed via in-process PGlite, handler-level via `vi.mock`. |
| E2E (Playwright) | `npm run test:e2e` | Production preview on `:4173`, in-process PGlite via `tests/e2e/global-setup.ts`, `workers: 1` (shared DB). |
| Type-check | `npm run check` | `svelte-check` against `tsconfig.json`. |

E2E uses `BETWIXT_E2E_PGLITE=1` + `x-test-user-id` header to skip Better-Auth. The bypass is gated three ways: (1) a build-time Vite `define` (`__E2E_BYPASS__` in `vite.config.ts`) that tree-shakes the entire `x-test-user-id` branch from the production worker bundle when `BETWIXT_E2E_PGLITE` is unset at build time; (2) a runtime check on `platformEnv.BETWIXT_E2E_PGLITE === '1'`; (3) `BETWIXT_E2E_PGLITE: ''` scoped at the deploy job level in `.github/workflows/deploy.yml`. `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are required unconditionally — there is no test-mode fallback (a publicly-visible fallback was removed in v0.7.3.0; see [CHANGELOG.md](CHANGELOG.md)). See [DEPLOY.md](DEPLOY.md#3-cloudflare-worker-secrets) for production configuration.
