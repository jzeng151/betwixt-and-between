// Slice 3 E1 — world_map_layer_prefs CRUD endpoint.
//
// GET /api/world-map-layer-prefs?worldMapId=…
//   List prefs for the given map (scoped to current user).
//   404 if map not owned. Empty array if no prefs written yet
//   (defaults are applied client-side).
//
// PATCH /api/world-map-layer-prefs
//   Body: { worldMapId, layerKey, visible: 0 | 1 }
//   Upsert (insert or update on conflict). 404 on cross-user map id.
//   Returns the persisted row.
//
// No POST/DELETE — upsert covers both. Delete via "set visible=1
// (default)" preserves the row; if compacting is ever needed, add
// a DELETE later.

import { json, error } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import {
	listWorldMapLayerPrefs,
	upsertWorldMapLayerPref
} from '$lib/server/world-map-v3.js';
import { isUuid } from '$lib/server/validation.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const worldMapId = event.url.searchParams.get('worldMapId');
	if (!worldMapId || !isUuid(worldMapId)) {
		error(400, 'worldMapId query param required (uuid)');
	}
	return json(await listWorldMapLayerPrefs(db, userId, worldMapId));
};

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const { worldMapId, layerKey, visible } = body as {
		worldMapId?: string;
		layerKey?: string;
		visible?: number;
	};
	if (!worldMapId || !isUuid(worldMapId)) error(400, 'worldMapId required (uuid)');
	const row = await upsertWorldMapLayerPref(
		db,
		userId,
		worldMapId,
		layerKey as string,
		visible as 0 | 1
	);
	return json(row);
};
