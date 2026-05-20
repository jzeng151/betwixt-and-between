# betwixt-and-between

SvelteKit + Cloudflare Workers app for composing stories: typed entities (Character, Location, Event, Act, Scene, Note), directed/symmetric edges (`relationships`), Premise-4 fractional-position story-time axis (`intervals`), and per-Location polygon world-maps. Neon Postgres + Better-Auth.

## Documentation

- [docs/architecture.md](docs/architecture.md) — system overview, trust boundaries, concurrency model, deployment, sharp edges.
- [docs/schema.md](docs/schema.md) — generated from `schema.ts` + `drizzle/*.sql`. Tables, columns, FKs, indexes, constraints, triggers.
- [docs/api.md](docs/api.md) — generated route inventory. Per-route MANUAL blocks (error codes, list bounds).
- [docs/edges.md](docs/edges.md) — generated relationship-type catalog. Direction, endpoints, temporal eligibility, cascades.
- [docs/adr/](docs/adr/) — architecture decisions worth keeping.

## Conventions

- **Server-only code lives in `src/lib/server/**`.** Imports from there into client modules are forbidden except for declaration-only re-exports (types, `as const` arrays). `schema.ts` is currently declaration-only; keep it that way or break the import-leak guarantee. See [architecture.md](docs/architecture.md#schema-import-leak-risk).
- **Never set `updated_at` or `created_at` on UPDATE in app code.** A `bump_updated_at` BEFORE UPDATE trigger maintains them on `entities`, `intervals`, `world_maps`, `map_regions`.
- **`relationships` is a discriminated union of typed edges.** 11 types in `RelationshipType`; per-type write semantics in [docs/edges.md](docs/edges.md) and [docs/adr/0001-relationships-as-discriminated-union.md](docs/adr/0001-relationships-as-discriminated-union.md).
- **`window_canvas_state.pinned` is `integer` 0/1, not `boolean`.** Schema, validators, and client all assume the integer shape.
- **`entity_aliases` and `map_regions` have no `user_id` column.** Every query must scope through the parent table (`entities.user_id` and `world_maps.user_id` respectively). A missing JOIN is a cross-user data leak.
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

E2E uses `BETWIXT_E2E_PGLITE=1` + `x-test-user-id` header to skip Better-Auth. **The env var must not be set in production deploys.** See [architecture.md → Trust boundaries](docs/architecture.md#trust-boundaries).
