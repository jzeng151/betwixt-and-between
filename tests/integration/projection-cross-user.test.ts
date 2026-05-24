/**
 * World Map v3 Slice 1a Δ1a-C — cross-user JSONB lazy-GC defense.
 *
 * Per docs/plans/world-map-v3-design.md § Slice 1a clarifications
 * (outside-voice codex #9): a malicious or accidental payload referencing
 * another user's faction_id must NOT leak the foreign faction's color into
 * the renderer. The defense is two-layered:
 *
 *   1. fetchProjectionContext() filters factions by user_id and JOINs
 *      regions through world_maps.user_id at the SQL layer.
 *   2. projectState() drops any region whose faction_id is missing from
 *      the (scoped) allowedFactions map.
 *
 * This test seeds two users, writes a transfer_region event under user A
 * that references user B's faction_id, and asserts the rendered region
 * surfaces as factionId=null with the neutral fallback color.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import {
	factions,
	mapAnchors,
	mapEvents,
	mapRegions,
	worldMaps
} from '../../src/lib/server/db/schema.js';
import { fetchProjectionContext } from '../../src/lib/server/projection-context.js';
import {
	NEUTRAL_REGION_COLOR,
	projectState,
	type ProjectionAnchor,
	type ProjectionEvent
} from '../../src/lib/features/map/projection.js';
import { eq } from 'drizzle-orm';

describe('projection cross-user lazy GC (Δ1a-C)', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
	});

	it('drops foreign-user faction references; renders neutral instead of leaking color', async () => {
		const userA = await seedTestUser(db, { email: 'a@test.com' });
		const userB = await seedTestUser(db, { email: 'b@test.com' });

		// User A's world map + region. User B's faction (with a distinctive
		// color we want to confirm never reaches User A's renderer).
		const [mapA] = await db
			.insert(worldMaps)
			.values({ userId: userA.id, name: 'Map A' })
			.returning();
		const [regionA] = await db
			.insert(mapRegions)
			.values({
				mapId: mapA.id,
				polygon: [
					[0, 0],
					[1, 0],
					[1, 1]
				]
			})
			.returning();
		const [factionA] = await db
			.insert(factions)
			.values({ userId: userA.id, name: 'A-faction', color: '#aa0000' })
			.returning();
		const [factionB] = await db
			.insert(factions)
			.values({ userId: userB.id, name: 'B-faction', color: '#0000bb' })
			.returning();

		// Anchor on User A's map references User A's faction (legit).
		const [anchor] = await db
			.insert(mapAnchors)
			.values({
				worldMapId: mapA.id,
				tPosition: 0,
				stateJsonb: {
					regions: [
						{ region_id: regionA.id, faction_id: factionA.id }
					],
					artifacts: [],
					chains: []
				}
			})
			.returning();

		// Cross-user attack: an event on User A's map transfers ownership to
		// User B's faction. fetchProjectionContext() must filter factionB out
		// of allowedFactions; projectState() must drop the faction_id and
		// fall back to neutral.
		const [event] = await db
			.insert(mapEvents)
			.values({
				worldMapId: mapA.id,
				tPosition: 1,
				kind: 'transfer_region',
				payloadJsonb: { region_id: regionA.id, new_faction_id: factionB.id }
			})
			.returning();

		const ctx = await fetchProjectionContext(db, mapA.id, userA.id);

		// Sanity: User A's faction is visible; User B's is not.
		expect(ctx.allowedFactions.has(factionA.id)).toBe(true);
		expect(ctx.allowedFactions.has(factionB.id)).toBe(false);
		expect(ctx.allowedRegions.has(regionA.id)).toBe(true);

		const anchors: ProjectionAnchor[] = [
			{
				id: anchor.id,
				tPosition: anchor.tPosition,
				createdAt: anchor.createdAt,
				stateJsonb: anchor.stateJsonb as ProjectionAnchor['stateJsonb']
			}
		];
		const events: ProjectionEvent[] = [
			{
				id: event.id,
				tPosition: event.tPosition,
				kind: event.kind,
				createdAt: event.createdAt,
				payloadJsonb: event.payloadJsonb
			}
		];

		// At t=0 (before the event), the anchor's User A faction renders.
		const before = projectState(0, anchors, events, ctx);
		expect(before.regions).toEqual([
			{ regionId: regionA.id, factionId: factionA.id, color: '#aa0000' }
		]);

		// At t=1 (after the cross-user transfer), the foreign faction is
		// dropped. Region surfaces as ownership-unknown (neutral color),
		// NOT '#0000bb'.
		const after = projectState(1, anchors, events, ctx);
		expect(after.regions).toEqual([
			{ regionId: regionA.id, factionId: null, color: NEUTRAL_REGION_COLOR }
		]);
		// Belt-and-suspenders: assert the foreign color literal isn't anywhere
		// in the rendered output.
		expect(JSON.stringify(after)).not.toContain('#0000bb');
	});

	it('drops region_id that belongs to another user even if the payload references it', async () => {
		const userA = await seedTestUser(db, { email: 'a2@test.com' });
		const userB = await seedTestUser(db, { email: 'b2@test.com' });

		const [mapA] = await db
			.insert(worldMaps)
			.values({ userId: userA.id, name: 'Map A' })
			.returning();
		const [mapB] = await db
			.insert(worldMaps)
			.values({ userId: userB.id, name: 'Map B' })
			.returning();
		const [regionB] = await db
			.insert(mapRegions)
			.values({
				mapId: mapB.id,
				polygon: [
					[0, 0],
					[1, 0],
					[1, 1]
				]
			})
			.returning();

		// An anchor on User A's map references a region that lives on User B's
		// map. Should never happen via legit UI, but the renderer must defend
		// against it (data corruption, prior buggy migration, malicious patch).
		const [anchor] = await db
			.insert(mapAnchors)
			.values({
				worldMapId: mapA.id,
				tPosition: 0,
				stateJsonb: {
					regions: [{ region_id: regionB.id, faction_id: null }]
				}
			})
			.returning();

		const ctx = await fetchProjectionContext(db, mapA.id, userA.id);
		expect(ctx.allowedRegions.has(regionB.id)).toBe(false);

		const state = projectState(
			0,
			[
				{
					id: anchor.id,
					tPosition: anchor.tPosition,
					createdAt: anchor.createdAt,
					stateJsonb: anchor.stateJsonb as ProjectionAnchor['stateJsonb']
				}
			],
			[],
			ctx
		);
		expect(state.regions).toEqual([]);

		// Sanity that mapB exists in the seed so the test isn't vacuous.
		const [foundB] = await db.select().from(worldMaps).where(eq(worldMaps.id, mapB.id));
		expect(foundB.userId).toBe(userB.id);
	});
});
