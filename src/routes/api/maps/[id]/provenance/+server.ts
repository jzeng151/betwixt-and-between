import { error, json } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { traceRegionProvenance } from '$lib/server/world-map-v3-provenance.js';
import type { RequestHandler } from './$types';

// WM3 Slice 5 PR-E (D6) — Causal Cartography. GET the causal lineage of a
// region's state at a playhead position:
//   /api/maps/:id/provenance?regionId=<region_id>&t=<position>
// Returns { status: 'no-change' | 'no-cause' } or
// { status: 'found', chain, earliest, jumpPosition }. Scoped to the caller on
// both the map and every ancestry hop (see traceRegionProvenance).
export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const regionId = event.url.searchParams.get('regionId');
	const tRaw = event.url.searchParams.get('t');
	if (!regionId) error(400, 'regionId is required');
	const t = Number(tRaw);
	if (!Number.isFinite(t)) error(400, 't must be a finite number');
	return json(await traceRegionProvenance(db, userId, event.params.id, regionId, t));
};
