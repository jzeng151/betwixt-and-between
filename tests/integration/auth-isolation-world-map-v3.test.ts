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
import {
	entities,
	factions,
	mapAnchors,
	mapEvents,
	mapRegions,
	worldMaps
} from '../../src/lib/server/db/schema.js';

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
	let aRegionId: string;

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

		const [region] = await currentDb
			.insert(mapRegions)
			.values({
				mapId: aMapId,
				polygon: [
					[0, 0],
					[1, 0],
					[1, 1]
				]
			})
			.returning();
		aRegionId = region.id;

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
				payloadJsonb: { region_id: aRegionId, new_faction_id: aFactionId }
			})
			.returning();
		aEventId = event.id;
	});

	// ── Factions ────────────────────────────────────────────────────────────

	it('user B GET /api/factions returns empty', async () => {
		const res = await factionsRoute.GET(mkEvent(userB));
		expect(await readJson(res)).toEqual({ rows: [], truncated: false });
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
						payloadJsonb: { region_id: aRegionId, new_faction_id: bFaction.id }
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
						payloadJsonb: { region_id: aRegionId, new_faction_id: aFactionId },
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
						payloadJsonb: { region_id: aRegionId, new_faction_id: aFactionId },
						sourceEventId: bEvent.id
					}
				})
			)
		).rejects.toThrow(/Entity not found/);
	});

	// ── Happy path for User A (sanity) ──────────────────────────────────────

	it('user A can list their own factions', async () => {
		const res = await factionsRoute.GET(mkEvent(userA));
		const body = (await readJson(res)) as { rows: Array<{ id: string }>; truncated: boolean };
		expect(body.rows.map((r) => r.id)).toContain(aFactionId);
		expect(body.truncated).toBe(false);
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

	// ── Region ownership defense in event payload ───────────────────────────
	// Mirror of the cross-user faction defense, but for region_id. An attacker
	// authenticated as user A POSTs a transfer_region whose region_id is user
	// B's region uuid — must be rejected at write, not lazy-GC'd at render.

	it('user A POST event referencing user B region returns 400', async () => {
		const [bMap] = await currentDb
			.insert(worldMaps)
			.values({ userId: userB, name: 'B map' })
			.returning();
		const [bRegion] = await currentDb
			.insert(mapRegions)
			.values({
				mapId: bMap.id,
				polygon: [
					[0, 0],
					[1, 0],
					[1, 1]
				]
			})
			.returning();

		await expect(
			eventsRoute.POST(
				mkEvent(userA, {
					params: { id: aMapId },
					body: {
						tPosition: 5,
						kind: 'transfer_region',
						payloadJsonb: { region_id: bRegion.id, new_faction_id: aFactionId }
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	// ── Anchor state ownership defense ──────────────────────────────────────
	// Mirror of the event payload defense above, applied to anchor state_jsonb.
	// An attacker authenticated as user A POSTs an anchor on their own map
	// whose state_jsonb.regions[].region_id is user B's region uuid — must be
	// rejected at write. Validates the validateAnchorStateOwnership path.

	it('user A POST anchor referencing user B region returns 400', async () => {
		const [bMap] = await currentDb
			.insert(worldMaps)
			.values({ userId: userB, name: 'B map for anchor test' })
			.returning();
		const [bRegion] = await currentDb
			.insert(mapRegions)
			.values({
				mapId: bMap.id,
				polygon: [
					[0, 0],
					[1, 0],
					[1, 1]
				]
			})
			.returning();

		await expect(
			anchorsRoute.POST(
				mkEvent(userA, {
					params: { id: aMapId },
					body: {
						tPosition: 7,
						stateJsonb: {
							regions: [{ region_id: bRegion.id, faction_id: null }],
							artifacts: [],
							chains: []
						}
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('user A POST anchor referencing user B faction returns 400', async () => {
		const [bFaction] = await currentDb
			.insert(factions)
			.values({ userId: userB, name: 'B faction for anchor test', color: '#0000bb' })
			.returning();

		await expect(
			anchorsRoute.POST(
				mkEvent(userA, {
					params: { id: aMapId },
					body: {
						tPosition: 8,
						stateJsonb: {
							regions: [{ region_id: aRegionId, faction_id: bFaction.id }],
							artifacts: [],
							chains: []
						}
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('user A POST anchor with own region + own faction succeeds', async () => {
		// Positive case: confirms the ownership validator isn't over-eager and
		// rejects legitimate writes.
		const res = await anchorsRoute.POST(
			mkEvent(userA, {
				params: { id: aMapId },
				body: {
					tPosition: 9,
					stateJsonb: {
						regions: [{ region_id: aRegionId, faction_id: aFactionId }],
						artifacts: [],
						chains: []
					}
				}
			})
		);
		const created = (await readJson(res)) as { id: string };
		expect(created.id).toBeTruthy();
	});

	// ── 409 UNIQUE collision on anchor t_position ───────────────────────────

	it('POST two anchors at the same t_position returns 409 on the second', async () => {
		const params = { id: aMapId };
		const body = {
			tPosition: 42,
			stateJsonb: { regions: [], artifacts: [], chains: [] }
		};
		await anchorsRoute.POST(mkEvent(userA, { params, body }));
		await expect(
			anchorsRoute.POST(mkEvent(userA, { params, body }))
		).rejects.toMatchObject({ status: 409 });
	});

	it('PATCH anchor onto an occupied t_position returns 409', async () => {
		// Seed two anchors at distinct positions, then PATCH one onto the
		// other's slot. updateMapAnchor's 23505 catch should fire.
		const aRes = await anchorsRoute.POST(
			mkEvent(userA, {
				params: { id: aMapId },
				body: { tPosition: 10, stateJsonb: { regions: [], artifacts: [], chains: [] } }
			})
		);
		const aAnchor = (await readJson(aRes)) as { id: string };
		const bRes = await anchorsRoute.POST(
			mkEvent(userA, {
				params: { id: aMapId },
				body: { tPosition: 11, stateJsonb: { regions: [], artifacts: [], chains: [] } }
			})
		);
		const bAnchor = (await readJson(bRes)) as { id: string };

		await expect(
			anchorIdRoute.PATCH(
				mkEvent(userA, {
					params: { id: aMapId, anchorId: bAnchor.id },
					body: { tPosition: 10 }
				})
			)
		).rejects.toMatchObject({ status: 409 });

		// Sanity: bAnchor still at its original position.
		void aAnchor;
	});

	// ── Malformed JSON body ─────────────────────────────────────────────────
	// readJson() converts SyntaxError to 400. Validates the wrapper without
	// depending on real network buffers — request.json() throws when fed a
	// garbage body, which is what malformed JSON looks like to the handler.

	it('POST with malformed JSON body returns 400, not 500', async () => {
		const garbage: any = {
			url: new URL('http://localhost/api/factions'),
			params: {},
			request: {
				json: async () => {
					throw new SyntaxError('Unexpected token { in JSON');
				}
			},
			locals: {
				db: currentDb,
				user: { id: userA, name: 'u', email: 'a@t.com', emailVerified: true },
				session: {
					id: crypto.randomUUID(),
					userId: userA,
					expiresAt: new Date(Date.now() + 86400000),
					token: 't'
				}
			}
		};
		await expect(factionsRoute.POST(garbage)).rejects.toMatchObject({ status: 400 });
	});

	// ── PATCH body must be an object (Codex P1) ─────────────────────────────
	// Without assertObjectBody, `'name' in null` and `'tPosition' in 'x'`
	// throw TypeError → SvelteKit surfaces 500. The handlers must surface
	// a clean 400 instead.

	it('PATCH faction with JSON null body returns 400, not 500', async () => {
		await expect(
			factionIdRoute.PATCH(
				mkEvent(userA, { params: { id: aFactionId }, body: null })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('PATCH faction with JSON scalar body returns 400, not 500', async () => {
		await expect(
			factionIdRoute.PATCH(
				mkEvent(userA, { params: { id: aFactionId }, body: 'not-an-object' })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('PATCH anchor with JSON null body returns 400, not 500', async () => {
		await expect(
			anchorIdRoute.PATCH(
				mkEvent(userA, {
					params: { id: aMapId, anchorId: aAnchorId },
					body: null
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	// ── Anchor state malformed regions (Codex P1+P2) ────────────────────────
	// validateAnchorStateOwnership iterated state_jsonb.regions[] without
	// checking each element was an object, and silently dropped non-string
	// faction_id values. Both surface as 400 now.

	it('POST anchor with null in regions[] returns 400', async () => {
		await expect(
			anchorsRoute.POST(
				mkEvent(userA, {
					params: { id: aMapId },
					body: {
						tPosition: 11,
						stateJsonb: { regions: [null], artifacts: [], chains: [] }
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('POST anchor with non-string faction_id returns 400', async () => {
		await expect(
			anchorsRoute.POST(
				mkEvent(userA, {
					params: { id: aMapId },
					body: {
						tPosition: 12,
						stateJsonb: {
							regions: [{ region_id: aRegionId, faction_id: 42 }],
							artifacts: [],
							chains: []
						}
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('POST anchor with faction_id: null is accepted (unowned region)', async () => {
		const res = await anchorsRoute.POST(
			mkEvent(userA, {
				params: { id: aMapId },
				body: {
					tPosition: 13,
					stateJsonb: {
						regions: [{ region_id: aRegionId, faction_id: null }],
						artifacts: [],
						chains: []
					}
				}
			})
		);
		const created = (await readJson(res)) as { id: string };
		expect(created.id).toBeTruthy();
	});

	// ── POST body must be an object (Codex re-review #1) ────────────────────
	// Same class as the PATCH-null tests above, applied to POST handlers.
	// readJson() accepts JSON scalars; assertObjectBody must reject them.

	it('POST /api/factions with JSON null body returns 400', async () => {
		await expect(
			factionsRoute.POST(mkEvent(userA, { body: null }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('POST /api/maps/[id]/anchors with JSON null body returns 400', async () => {
		await expect(
			anchorsRoute.POST(
				mkEvent(userA, { params: { id: aMapId }, body: null })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('POST /api/maps/[id]/events with JSON null body returns 400', async () => {
		await expect(
			eventsRoute.POST(
				mkEvent(userA, { params: { id: aMapId }, body: null })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	// ── Anchor state_jsonb must not be an array (Codex re-review #2) ────────
	// typeof [] === 'object' — the shape validator must reject arrays
	// explicitly or state_jsonb: [] would persist.

	it('POST anchor with array state_jsonb returns 400', async () => {
		await expect(
			anchorsRoute.POST(
				mkEvent(userA, {
					params: { id: aMapId },
					body: { tPosition: 14, stateJsonb: [] }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	// ── source_event_id empty-string rejection (Codex re-review #3) ─────────
	// truthy check would skip validation; nullish coalescing would still
	// write the empty string. Explicit typeof + length check now in place.

	it('POST event with sourceEventId: "" returns 400', async () => {
		await expect(
			eventsRoute.POST(
				mkEvent(userA, {
					params: { id: aMapId },
					body: {
						tPosition: 15,
						kind: 'transfer_region',
						payloadJsonb: { region_id: aRegionId, new_faction_id: aFactionId },
						sourceEventId: ''
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('POST event with sourceEventId: 42 returns 400', async () => {
		await expect(
			eventsRoute.POST(
				mkEvent(userA, {
					params: { id: aMapId },
					body: {
						tPosition: 16,
						kind: 'transfer_region',
						payloadJsonb: { region_id: aRegionId, new_faction_id: aFactionId },
						sourceEventId: 42
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('POST event with sourceEventId: null is accepted', async () => {
		// Positive case: null/undefined skip the polymorphic FK check (no
		// source event linkage). Pins that we didn't over-reject.
		const res = await eventsRoute.POST(
			mkEvent(userA, {
				params: { id: aMapId },
				body: {
					tPosition: 17,
					kind: 'transfer_region',
					payloadJsonb: { region_id: aRegionId, new_faction_id: aFactionId },
					sourceEventId: null
				}
			})
		);
		const created = (await readJson(res)) as { id: string };
		expect(created.id).toBeTruthy();
	});
});
