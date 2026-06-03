/**
 * World Map v3 Slice 1a Δ1a-F — projection-engine parity fixtures.
 *
 * The test plan asks for ≥10 fixtures that "both Leaflet and Pixi paths
 * consume identically." Pixi arrives in Slice 1b; until then, the renderer-
 * parity contract reduces to "projectState() returns the same RenderedState
 * for the same inputs across the fixture space." That's what this file
 * pins, and it's the same RenderedState both renderers will consume in 1b.
 *
 * Fixtures cover the matrix from the test plan §109:
 *   1. empty
 *   2. 1 region
 *   3. many regions
 *   4. regions + variants (variant semantics live above projection; here we
 *      cover the projection's per-variant view: distinct anchors per map)
 *   5. drill-down (modeled as separate world maps; projection is one-map
 *      scoped, so this covers projection-per-map independence)
 *   6. spotlight dim (projection doesn't know scope; that's RegionLayer's
 *      responsibility — fixture asserts projection is scope-agnostic)
 *   7. deleted-faction lazy GC (faction_id absent from allowedFactions)
 *   8. deleted-region lazy GC (region_id absent from allowedRegions)
 *   9. cross-user lazy GC (covered in projection-cross-user.test.ts;
 *      mirrored here as a fixture for completeness)
 *  10. anchor + event at same T (covered in projection-same-t.test.ts;
 *      mirrored here)
 *  +  event sequence chaining (anchor → e1 → e2 over same region)
 *  +  region with explicit color (no faction)
 *
 * Each fixture is a {inputs, expected RenderedState} pair so the test can
 * snapshot one stable assertion per fixture. When Slice 1b lands, the
 * Pixi-side renderer parity check imports this same fixture list and
 * asserts the renderer's output state matches expected for each one.
 */
import { describe, it, expect } from 'vitest';
import {
	NEUTRAL_REGION_COLOR,
	projectState,
	type ProjectionAnchor,
	type ProjectionContext,
	type ProjectionEvent,
	type RenderedState
} from '../../src/lib/features/map/projection.js';

const FAC_A = '11111111-1111-1111-1111-111111111111';
const FAC_B = '22222222-2222-2222-2222-222222222222';
const FAC_FOREIGN = '99999999-9999-9999-9999-999999999999';
const REG_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const REG_2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
const REG_3 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
const REG_FOREIGN = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const TS = (s: string) => new Date(s);

function fullCtx(): ProjectionContext {
	return {
		allowedFactions: new Map([
			[FAC_A, { id: FAC_A, color: '#aa0000' }],
			[FAC_B, { id: FAC_B, color: '#0000bb' }]
		]),
		allowedRegions: new Set([REG_1, REG_2, REG_3])
	};
}

type Fixture = {
	name: string;
	t: number;
	anchors: ProjectionAnchor[];
	events: ProjectionEvent[];
	ctx: ProjectionContext;
	// Movement (artifactOverrides) and causal edges (causalEdges) have their own
	// dedicated tests; these golden fixtures pin the state-event projection and
	// compare only the non-movement, non-causal fields (see runFixture). Omit
	// both so the literals stay focused.
	expected: Omit<RenderedState, 'artifactOverrides' | 'causalEdges'>;
};

const FIXTURES: Fixture[] = [
	{
		name: 'empty map',
		t: 0,
		anchors: [],
		events: [],
		ctx: fullCtx(),
		expected: { tPosition: 0, regions: [], artifacts: [], cells: [] }
	},
	{
		name: 'single region with faction',
		t: 0,
		anchors: [
			{
				id: 'a',
				tPosition: 0,
				createdAt: TS('2026-01-01T00:00:00Z'),
				stateJsonb: { regions: [{ region_id: REG_1, faction_id: FAC_A }] }
			}
		],
		events: [],
		ctx: fullCtx(),
		expected: {
			tPosition: 0,
			regions: [{ regionId: REG_1, factionId: FAC_A, color: '#aa0000' }],
			artifacts: [],
			cells: []
		}
	},
	{
		name: 'many regions in one anchor',
		t: 0,
		anchors: [
			{
				id: 'a',
				tPosition: 0,
				createdAt: TS('2026-01-01T00:00:00Z'),
				stateJsonb: {
					regions: [
						{ region_id: REG_1, faction_id: FAC_A },
						{ region_id: REG_2, faction_id: FAC_B },
						{ region_id: REG_3, faction_id: null, color: '#abcdef' }
					]
				}
			}
		],
		events: [],
		ctx: fullCtx(),
		expected: {
			tPosition: 0,
			regions: [
				{ regionId: REG_1, factionId: FAC_A, color: '#aa0000' },
				{ regionId: REG_2, factionId: FAC_B, color: '#0000bb' },
				// Slice 2 D1: explicit color in anchor jsonb is ignored;
				// faction_id=null resolves to Neutral grey at render.
				{ regionId: REG_3, factionId: null, color: '#9ca3af' }
			],
			artifacts: [],
			cells: []
		}
	},
	{
		name: 'variant view — distinct anchors per map, projection is per-map',
		t: 5,
		anchors: [
			{
				id: 'a',
				tPosition: 0,
				createdAt: TS('2026-01-01T00:00:00Z'),
				stateJsonb: { regions: [{ region_id: REG_1, faction_id: FAC_A }] }
			},
			{
				id: 'b',
				tPosition: 5,
				createdAt: TS('2026-01-02T00:00:00Z'),
				stateJsonb: { regions: [{ region_id: REG_1, faction_id: FAC_B }] }
			}
		],
		events: [],
		ctx: fullCtx(),
		expected: {
			tPosition: 5,
			regions: [{ regionId: REG_1, factionId: FAC_B, color: '#0000bb' }],
			artifacts: [],
			cells: []
		}
	},
	{
		name: 'drill-down — projection independent per map (no leakage)',
		t: 0,
		anchors: [
			{
				id: 'a',
				tPosition: 0,
				createdAt: TS('2026-01-01T00:00:00Z'),
				stateJsonb: { regions: [{ region_id: REG_2, faction_id: FAC_B }] }
			}
		],
		events: [],
		// Tighter context: only REG_2 visible — simulating the child map's
		// allowedRegions set, which should not include the parent map's
		// REG_1 even if some shared payload accidentally references it.
		ctx: {
			allowedFactions: new Map([[FAC_B, { id: FAC_B, color: '#0000bb' }]]),
			allowedRegions: new Set([REG_2])
		},
		expected: {
			tPosition: 0,
			regions: [{ regionId: REG_2, factionId: FAC_B, color: '#0000bb' }],
			artifacts: [],
			cells: []
		}
	},
	{
		name: 'spotlight is scope-agnostic at the projection layer',
		t: 0,
		anchors: [
			{
				id: 'a',
				tPosition: 0,
				createdAt: TS('2026-01-01T00:00:00Z'),
				stateJsonb: {
					regions: [
						{ region_id: REG_1, faction_id: FAC_A },
						{ region_id: REG_2, faction_id: FAC_B }
					]
				}
			}
		],
		events: [],
		ctx: fullCtx(),
		// Even with a "spotlight" on REG_2, projection emits both — scope
		// styling lives in the renderer (RegionLayer.svelte), not here.
		expected: {
			tPosition: 0,
			regions: [
				{ regionId: REG_1, factionId: FAC_A, color: '#aa0000' },
				{ regionId: REG_2, factionId: FAC_B, color: '#0000bb' }
			],
			artifacts: [],
			cells: []
		}
	},
	{
		name: 'deleted faction — lazy GC falls back to neutral',
		t: 0,
		anchors: [
			{
				id: 'a',
				tPosition: 0,
				createdAt: TS('2026-01-01T00:00:00Z'),
				stateJsonb: {
					regions: [{ region_id: REG_1, faction_id: 'deleted-faction-uuid' }]
				}
			}
		],
		events: [],
		ctx: fullCtx(),
		expected: {
			tPosition: 0,
			regions: [{ regionId: REG_1, factionId: null, color: NEUTRAL_REGION_COLOR }],
			artifacts: [],
			cells: []
		}
	},
	{
		name: 'deleted region — lazy GC drops the entry entirely',
		t: 0,
		anchors: [
			{
				id: 'a',
				tPosition: 0,
				createdAt: TS('2026-01-01T00:00:00Z'),
				stateJsonb: {
					regions: [
						{ region_id: REG_1, faction_id: FAC_A },
						{ region_id: 'deleted-region-uuid', faction_id: FAC_B }
					]
				}
			}
		],
		events: [],
		ctx: fullCtx(),
		expected: {
			tPosition: 0,
			regions: [{ regionId: REG_1, factionId: FAC_A, color: '#aa0000' }],
			artifacts: [],
			cells: []
		}
	},
	{
		name: 'cross-user faction — lazy GC drops foreign color',
		t: 1,
		anchors: [
			{
				id: 'a',
				tPosition: 0,
				createdAt: TS('2026-01-01T00:00:00Z'),
				stateJsonb: { regions: [{ region_id: REG_1, faction_id: FAC_A }] }
			}
		],
		events: [
			{
				id: 'e',
				tPosition: 1,
				kind: 'transfer_region',
				createdAt: TS('2026-01-01T01:00:00Z'),
				payloadJsonb: { region_id: REG_1, new_faction_id: FAC_FOREIGN }
			}
		],
		ctx: fullCtx(), // FAC_FOREIGN absent from allowedFactions
		expected: {
			tPosition: 1,
			regions: [{ regionId: REG_1, factionId: null, color: NEUTRAL_REGION_COLOR }],
			artifacts: [],
			cells: []
		}
	},
	{
		name: 'anchor + event at same T — event at T excluded (CMT-5)',
		t: 5,
		anchors: [
			{
				id: 'a',
				tPosition: 5,
				createdAt: TS('2026-01-01T00:00:00Z'),
				stateJsonb: { regions: [{ region_id: REG_1, faction_id: FAC_A }] }
			}
		],
		events: [
			{
				id: 'e',
				tPosition: 5,
				kind: 'transfer_region',
				createdAt: TS('2026-01-01T01:00:00Z'),
				payloadJsonb: { region_id: REG_1, new_faction_id: FAC_B }
			}
		],
		ctx: fullCtx(),
		expected: {
			tPosition: 5,
			regions: [{ regionId: REG_1, factionId: FAC_A, color: '#aa0000' }],
			artifacts: [],
			cells: []
		}
	},
	{
		name: 'event sequence — anchor → transfer at T=1 → transfer at T=2',
		t: 2,
		anchors: [
			{
				id: 'a',
				tPosition: 0,
				createdAt: TS('2026-01-01T00:00:00Z'),
				stateJsonb: { regions: [{ region_id: REG_1, faction_id: FAC_A }] }
			}
		],
		events: [
			{
				id: 'e1',
				tPosition: 1,
				kind: 'transfer_region',
				createdAt: TS('2026-01-01T01:00:00Z'),
				payloadJsonb: { region_id: REG_1, new_faction_id: FAC_B }
			},
			{
				id: 'e2',
				tPosition: 2,
				kind: 'transfer_region',
				createdAt: TS('2026-01-01T02:00:00Z'),
				payloadJsonb: { region_id: REG_1, new_faction_id: FAC_A }
			}
		],
		ctx: fullCtx(),
		expected: {
			tPosition: 2,
			regions: [{ regionId: REG_1, factionId: FAC_A, color: '#aa0000' }],
			artifacts: [],
			cells: []
		}
	},
	{
		name: 'foreign region_id in anchor — dropped silently',
		t: 0,
		anchors: [
			{
				id: 'a',
				tPosition: 0,
				createdAt: TS('2026-01-01T00:00:00Z'),
				stateJsonb: {
					regions: [
						{ region_id: REG_1, faction_id: FAC_A },
						{ region_id: REG_FOREIGN, faction_id: FAC_B }
					]
				}
			}
		],
		events: [],
		ctx: fullCtx(),
		expected: {
			tPosition: 0,
			regions: [{ regionId: REG_1, factionId: FAC_A, color: '#aa0000' }],
			artifacts: [],
			cells: []
		}
	}
];

describe('projection-engine fixtures (Δ1a-F, ≥10 cases)', () => {
	// Guard the contract: when Slice 1b adds the Pixi-side parity assertion,
	// it will lift this list verbatim. If the count drops below 10, the
	// test plan's "≥10 fixtures" promise is silently broken.
	it('ships at least 10 fixtures', () => {
		expect(FIXTURES.length).toBeGreaterThanOrEqual(10);
	});

	for (const fixture of FIXTURES) {
		it(fixture.name, () => {
			const { artifactOverrides, causalEdges, ...state } = projectState(
				fixture.t,
				fixture.anchors,
				fixture.events,
				fixture.ctx
			);
			expect(state).toEqual(fixture.expected);
			// These fixtures pass no placements and no caused_by edges, so the
			// movement + causal folds yield nothing — guard both contract
			// additions stay inert here.
			expect(artifactOverrides.size).toBe(0);
			expect(causalEdges).toEqual([]);
		});
	}
});
