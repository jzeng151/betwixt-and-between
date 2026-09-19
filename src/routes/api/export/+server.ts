import { error } from '@sveltejs/kit';
import { and, eq, getTableColumns, inArray } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import {
	entities, relationships, intervals, entityAliases, canvasPositions, windowCanvasState,
	worldMaps, mapPlacements, mapAnchors, mapEvents, factions, worldMapLayerPrefs,
	userPreferences, appearancePresets
} from '$lib/server/db/schema.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const userId = getUserId(event);
	const exportedAt = new Date().toISOString();
	const body = await event.locals.db.transaction(async (tx) => {
		const ownedEntities = tx.select({ id: entities.id }).from(entities).where(eq(entities.userId, userId));
		const queries = {
			entities: tx.select().from(entities).where(eq(entities.userId, userId)),
			relationships: tx.select().from(relationships).where(eq(relationships.userId, userId)),
			intervals: tx.select().from(intervals).where(eq(intervals.userId, userId)),
			entityAliases: tx.select().from(entityAliases).where(and(
				inArray(entityAliases.primaryEntityId, ownedEntities),
				inArray(entityAliases.aliasEntityId, ownedEntities)
			)),
			canvasPositions: tx.select().from(canvasPositions).where(eq(canvasPositions.userId, userId)),
			windowCanvasState: tx.select().from(windowCanvasState).where(eq(windowCanvasState.userId, userId)),
			worldMaps: tx.select().from(worldMaps).where(eq(worldMaps.userId, userId)),
			mapPlacements: tx.select().from(mapPlacements).where(eq(mapPlacements.userId, userId)),
			mapAnchors: tx.select(getTableColumns(mapAnchors)).from(mapAnchors)
				.innerJoin(worldMaps, eq(mapAnchors.worldMapId, worldMaps.id)).where(eq(worldMaps.userId, userId)),
			mapEvents: tx.select(getTableColumns(mapEvents)).from(mapEvents)
				.innerJoin(worldMaps, eq(mapEvents.worldMapId, worldMaps.id)).where(eq(worldMaps.userId, userId)),
			factions: tx.select().from(factions).where(eq(factions.userId, userId)),
			worldMapLayerPrefs: tx.select(getTableColumns(worldMapLayerPrefs)).from(worldMapLayerPrefs)
				.innerJoin(worldMaps, eq(worldMapLayerPrefs.worldMapId, worldMaps.id))
				.where(and(eq(worldMapLayerPrefs.userId, userId), eq(worldMaps.userId, userId))),
			userPreferences: tx.select().from(userPreferences).where(eq(userPreferences.userId, userId)),
			appearancePresets: tx.select().from(appearancePresets).where(eq(appearancePresets.userId, userId))
		};
		const tables: string[] = [];
		let bytes = 0;
		// ponytail: materialize up to 16 MiB / 10,000 rows per table. Use a streamed
		// archive if larger exports are needed; never return a truncated download.
		for (const [name, query] of Object.entries(queries)) {
			const rows = await query.limit(10_001);
			if (rows.length > 10_000) error(413, 'This story is too large for a single export. No file was created.');
			const value = JSON.stringify(rows, (_key, value) =>
				typeof value === 'number' && !Number.isFinite(value) ? String(value) : value
			);
			bytes += new TextEncoder().encode(value).byteLength;
			if (bytes > 16 * 1024 * 1024) error(413, 'This story is too large for a single export. No file was created.');
			tables.push(`${JSON.stringify(name)}:${value}`);
		}
		return `{"format":"betwixt-story","version":1,"exportedAt":${JSON.stringify(exportedAt)},"tables":{${tables.join(',')}}}`;
	}, { isolationLevel: 'repeatable read', accessMode: 'read only' });
	return new Response(body, { headers: {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Disposition': `attachment; filename="betwixt-story-${exportedAt.slice(0, 10)}.json"`,
		'Cache-Control': 'private, no-store',
		'X-Content-Type-Options': 'nosniff'
	} });
};
