/**
 * Multi-tenant isolation: World Map v3 Slice 1b endpoints
 * (/api/factions, /api/maps/[id]/anchors, /api/maps/[id]/events).
 *
 * Per CLAUDE.md → "A missing JOIN is a cross-user data leak." Anchors
 * and events scope through world_maps.user_id; factions carry user_id
 * directly. This test seeds two users and pins the regression class:
 * a future handler refactor that drops the JOIN must fail here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { entities, factions, mapAnchors, mapEvents, worldMaps } from '../../src/lib/server/db/schema.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;

const factionsRoute = await import('../../src/routes/api/factions/+server.js');
const factionIdRoute = await import('../../src/routes/api/factions/[id]/+server.js');
const anchorsRoute = await import('../../src/routes/api/maps/[id]/anchors/+server.js');
const anchorIdRoute = await import('../../src/routes/api/maps/[id]/anchors/[anchorId]/+server.js');
const eventsRoute = await import('../../src/routes/api/maps/[id]/events/+server.js');
const eventIdRoute = await import('../../src/routes/api/maps/[id]/events/[eventId]/+server.js');

function mkEvent(
	userId: string,
	overrides: { params?: Record<string, string>; body?: unknown; url?: string } = {}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
	return {
		url: new URL(overrides.url ?? 'http://localhost/api/test'),
		params: overrides.params ?? {},
		request: { json: async () => overrides.body },
		locals: {
			db: currentDb,
			user: { id: userId, name: 'u', email: `${userId}@t.com`, emailVerified: true },
			session: {
				id: crypto.randomUUID(),
				userId,
				expiresAt: new Date(Date.now() + 86400000),
				token: 't'
			}
		}
	};
}

async function readJson(res: Response): Promise<unknown> {
	return JSON.parse(await res.text());
}

describe('auth isolation: World Map v3 endpoints', () => {
	let userA: string;
	let userB: string;
	let aMapId: string;
	let aFactionId: string;
	let aAnchorId: string;
	let aEventId: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		userA = (await seedTestUser(currentDb, { email: 'a@t.com' })).id;
		userB = (await seedTestUser(currentDb, { email: 'b@t.com' })).id;

		const [map] = await currentDb
			.insert(worldMaps)
			.values({ userId: userA, name: 'A map' })
			.returning();
		aMapId = map.id;

		const [faction] = await currentDb
			.insert(factions)
			.values({ userId: userA, name: 'A faction', color: '#aa0000' })
			.returning();
		aFactionId = faction.id;

		const [anchor] = await currentDb
			.insert(mapAnchors)
			.values({
				worldMapId: aMapId,
				tPosition: 0,
				stateJsonb: { regions: [], artifacts: [], chains: [] }
			})
			.returning();
		aAnchorId = anchor.id;

		const [event] = await currentDb
			.insert(mapEvents)
			.values({
				worldMapId: aMapId,
				tPosition: 1,
				kind: 'transfer_region',
				payloadJsonb: { region_id: crypto.randomUUID(), new_faction_id: aFactionId }
			})
			.returning();
		aEventId = event.id;
	});

	// ── Factions ────────────────────────────────────────────────────────────

	it('user B GET /api/factions returns empty', async () => {
		const res = await factionsRoute.GET(mkEvent(userB));
		expect(await readJson(res)).toEqual([]);
	});

	it('user B PATCH /api/factions/[id] returns 404', async () => {
		await expect(
			factionIdRoute.PATCH(
				mkEvent(userB, { params: { id: aFactionId }, body: { name: 'pwned' } })
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it('user B DELETE /api/factions/[id] returns 404', async () => {
		await expect(
			factionIdRoute.DELETE(mkEvent(userB, { params: { id: aFactionId } }))
		).rejects.toMatchObject({ status: 404 });
	});

	// ── Anchors ─────────────────────────────────────────────────────────────

	it('user B GET /api/maps/[id]/anchors returns 404 (map not theirs)', async () => {
		await expect(
			anchorsRoute.GET(mkEvent(userB, { params: { id: aMapId } }))
		).rejects.toMatchObject({ status: 404 });
	});

	it('user B POST /api/maps/[id]/anchors returns 404', async () => {
		await expect(
			anchorsRoute.POST(
				mkEvent(userB, {
					params: { id: aMapId },
					body: { tPosition: 5, stateJsonb: { regions: [], artifacts: [], chains: [] } }
				})
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it('user B PATCH anchor returns 404', async () => {
		await expect(
			anchorIdRoute.PATCH(
				mkEvent(userB, {
					params: { id: aMapId, anchorId: aAnchorId },
					body: { tPosition: 99 }
				})
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it('user B DELETE anchor returns 404', async () => {
		await expect(
			anchorIdRoute.DELETE(
				mkEvent(userB, { params: { id: aMapId, anchorId: aAnchorId } })
			)
		).rejects.toMatchObject({ status: 404 });
	});

	// ── Events ──────────────────────────────────────────────────────────────

	it('user B GET /api/maps/[id]/events returns 404', async () => {
		await expect(
			eventsRoute.GET(mkEvent(userB, { params: { id: aMapId } }))
		).rejects.toMatchObject({ status: 404 });
	});

	it('user B POST /api/maps/[id]/events returns 404', async () => {
		await expect(
			eventsRoute.POST(
				mkEvent(userB, {
					params: { id: aMapId },
					body: {
						tPosition: 5,
						kind: 'transfer_region',
						payloadJsonb: { region_id: crypto.randomUUID(), new_faction_id: aFactionId }
					}
				})
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it('user B DELETE event returns 404', async () => {
		await expect(
			eventIdRoute.DELETE(
				mkEvent(userB, { params: { id: aMapId, eventId: aEventId } })
			)
		).rejects.toMatchObject({ status: 404 });
	});

	// ── Cross-user payload defense ──────────────────────────────────────────
	// User A's map is fine; User A's payload references User B's faction.
	// validateEventPayload should reject this even though User A owns the
	// map (factions are user-owned, not map-owned).

	it('user A POST event referencing user B faction returns 400', async () => {
		const [bFaction] = await currentDb
			.insert(factions)
			.values({ userId: userB, name: 'B faction', color: '#0000bb' })
			.returning();

		await expect(
			eventsRoute.POST(
				mkEvent(userA, {
					params: { id: aMapId },
					body: {
						tPosition: 2,
						kind: 'transfer_region',
						payloadJsonb: { region_id: crypto.randomUUID(), new_faction_id: bFaction.id }
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	// ── Polymorphic FK enforcement ──────────────────────────────────────────

	it('rejects source_event_id pointing at a non-Event entity', async () => {
		const [location] = await currentDb
			.insert(entities)
			.values({ userId: userA, type: 'Location', name: 'Castle' })
			.returning();

		await expect(
			eventsRoute.POST(
				mkEvent(userA, {
					params: { id: aMapId },
					body: {
						tPosition: 3,
						kind: 'transfer_region',
						payloadJsonb: { region_id: crypto.randomUUID(), new_faction_id: aFactionId },
						sourceEventId: location.id
					}
				})
			)
		).rejects.toThrow(/Polymorphic FK violation/);
	});

	it('rejects source_event_id pointing at another user Event', async () => {
		const [bEvent] = await currentDb
			.insert(entities)
			.values({ userId: userB, type: 'Event', name: 'B coronation' })
			.returning();

		await expect(
			eventsRoute.POST(
				mkEvent(userA, {
					params: { id: aMapId },
					body: {
						tPosition: 4,
						kind: 'transfer_region',
						payloadJsonb: { region_id: crypto.randomUUID(), new_faction_id: aFactionId },
						sourceEventId: bEvent.id
					}
				})
			)
		).rejects.toThrow(/Entity not found/);
	});

	// ── Happy path for User A (sanity) ──────────────────────────────────────

	it('user A can list their own factions', async () => {
		const res = await factionsRoute.GET(mkEvent(userA));
		const rows = (await readJson(res)) as Array<{ id: string }>;
		expect(rows.map((r) => r.id)).toContain(aFactionId);
	});

	it('user A can POST + DELETE their own anchor', async () => {
		const createRes = await anchorsRoute.POST(
			mkEvent(userA, {
				params: { id: aMapId },
				body: { tPosition: 5, stateJsonb: { regions: [], artifacts: [], chains: [] } }
			})
		);
		const created = (await readJson(createRes)) as { id: string };
		const delRes = await anchorIdRoute.DELETE(
			mkEvent(userA, { params: { id: aMapId, anchorId: created.id } })
		);
		expect(delRes.status).toBe(204);
	});
});
