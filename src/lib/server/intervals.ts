/**
 * intervals — public API surface (Phase 1A PR 1)
 *
 * Thin re-export shim. The implementation is split across five sub-modules
 * under `./intervals/`:
 *
 *   - `intervals/types.ts`         — Db union, POSITION_EPSILON, input/output
 *                                    shapes (WriteIntervalInput, UpdateIntervalResult,
 *                                    ComputeIntervalPositions*, RecomputeCache,
 *                                    RelationshipBounds*)
 *   - `intervals/polymorphic-fk.ts` — `validateFKTypes` (and its internal
 *                                    `assertEntityType`); enforces Act/Scene
 *                                    polymorphic FKs at the app layer.
 *   - `intervals/invariants.ts`    — `assertNoOverlap` (same-entity half-open
 *                                    overlap rejection on the story-time axis).
 *   - `intervals/recompute.ts`     — `actIndexOf`, `sceneIndexOf`,
 *                                    `computeIntervalPositions`,
 *                                    `recomputeIntervalsForAct`,
 *                                    `recomputeAllIntervals`,
 *                                    `resolveRelationshipBounds`.
 *   - `intervals/crud.ts`          — `writeInterval`, `updateInterval`,
 *                                    `splitInterval`, `moveSceneToAct`.
 *
 * Callers — 8 route handlers + 14 integration tests + 1 unit test — keep
 * importing from `$lib/server/intervals.js`. The split is invisible to them.
 *
 * **Multi-tenant scoping (T8b S5', 2026-05-08):** every public function takes
 * a `userId` and scopes every SELECT/UPDATE/DELETE/INSERT by it. Cross-user
 * reads return empty; cross-user updates affect zero rows. Callers must pass
 * `getUserId(event)` from the route handler.
 *
 * Math (docs/adr/0003-premise-4-position-math.md → "The math"):
 *
 *   Acts at root (parent_id IS NULL, type='Act') are ordered by
 *   `entities.position`. The act's index in that ordering is its position on
 *   the global story-time axis: Act i occupies [i, i+1).
 *
 *   Scenes within an Act are ordered by `entities.position` among siblings
 *   (parent_id = act.id, type='Scene'). Scene k of m within Act i occupies
 *   [i + k/m, i + (k+1)/m).
 *
 *   Half-open convention: end is exclusive. CHECK (start_position < end_position).
 */

// Named re-exports only. `export *` from polymorphic-fk + invariants would
// pull `validateFKTypes` and `assertNoOverlap` into the public surface —
// they're internal helpers consumed by crud.ts across the new sub-module
// boundary, not part of the historical API the 20+ external callers see.
// Keep this list in lockstep with the original intervals.ts exports
// (pre-split commit b5ae7fe-era).
export type {
	Db,
	WriteIntervalInput,
	UpdateIntervalResult,
	ComputeIntervalPositionsInput,
	ComputeIntervalPositionsResult,
	RecomputeCache,
	RelationshipBoundsInput,
	RelationshipBoundsResult
} from './intervals/types.js';
export { POSITION_EPSILON } from './intervals/types.js';
export {
	writeInterval,
	updateInterval,
	splitInterval,
	moveSceneToAct
} from './intervals/crud.js';
export {
	actIndexOf,
	sceneIndexOf,
	computeIntervalPositions,
	recomputeIntervalsForAct,
	recomputeAllIntervals,
	resolveRelationshipBounds,
	snapshotActOrdering,
	type ActOrderingSnapshot
} from './intervals/recompute.js';
export { assertSourceEventIdIsEvent } from './intervals/polymorphic-fk.js';
