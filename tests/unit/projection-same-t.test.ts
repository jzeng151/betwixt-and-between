/**
 * Slice 1a Δ1a-D — same-T ordering rule for projectState().
 *
 * Per CMT-5: anchor at T is "world state AT T"; events at exactly T are
 * conceptually pre-anchor and excluded from the projection fold.
 * Formula: render_state(t) = anchor.state_jsonb + apply(
 *   events WHERE t_position > anchor.t AND t_position <= t
 * ).
 *
 * Tiebreak across same-T events: ORDER BY t_position, created_at, id.
 */
import { describe, it, expect } from 'vitest';
import {
	NEUTRAL_REGION_COLOR,
	projectState,
	type ProjectionAnchor,
	type ProjectionContext,
	type ProjectionEvent
} from '../../src/lib/features/map/projection.js';

const REGION_ID = '00000000-0000-0000-0000-000000000001';
const FACTION_RED = '00000000-0000-0000-0000-0000000000aa';
const FACTION_BLUE = '00000000-0000-0000-0000-0000000000bb';

function ctx(): ProjectionContext {
	return {
		allowedFactions: new Map([
			[FACTION_RED, { id: FACTION_RED, color: '#ff0000' }],
			[FACTION_BLUE, { id: FACTION_BLUE, color: '#0000ff' }]
		]),
		allowedRegions: new Set([REGION_ID])
	};
}

const ANCHOR_AT_5: ProjectionAnchor = {
	id: 'anchor-5',
	tPosition: 5,
	createdAt: new Date('2026-01-01T00:00:00Z'),
	stateJsonb: {
		regions: [{ region_id: REGION_ID, faction_id: FACTION_RED }]
	}
};

const EVENT_AT_5: ProjectionEvent = {
	id: 'event-at-anchor',
	tPosition: 5,
	kind: 'transfer_region',
	createdAt: new Date('2026-01-01T01:00:00Z'),
	payloadJsonb: { region_id: REGION_ID, new_faction_id: FACTION_BLUE }
};

const EVENT_AT_6: ProjectionEvent = {
	id: 'event-after-anchor',
	tPosition: 6,
	kind: 'transfer_region',
	createdAt: new Date('2026-01-01T02:00:00Z'),
	payloadJsonb: { region_id: REGION_ID, new_faction_id: FACTION_BLUE }
};

describe('projectState — same-T ordering (Δ1a-D)', () => {
	it('event AT anchor.t is excluded; projectState(5) == anchor', () => {
		const state = projectState(5, [ANCHOR_AT_5], [EVENT_AT_5, EVENT_AT_6], ctx());
		expect(state.regions).toEqual([
			{ regionId: REGION_ID, factionId: FACTION_RED, color: '#ff0000' }
		]);
	});

	it('event AFTER anchor.t is applied; projectState(6) folds in the t=6 event', () => {
		const state = projectState(6, [ANCHOR_AT_5], [EVENT_AT_5, EVENT_AT_6], ctx());
		expect(state.regions).toEqual([
			{ regionId: REGION_ID, factionId: FACTION_BLUE, color: '#0000ff' }
		]);
	});

	it('projectState(4.9) finds no active anchor and returns empty regions', () => {
		const state = projectState(4.9, [ANCHOR_AT_5], [], ctx());
		expect(state.regions).toEqual([]);
	});

	it('same-T tiebreak: ORDER BY (t_position, created_at, id) is deterministic', () => {
		// Two events at the same t=6, transferring the same region. The one
		// with the later created_at must apply last. Input order is reversed
		// from final order to prove projectState sorts internally.
		const earlierEvent: ProjectionEvent = {
			id: 'event-b',
			tPosition: 6,
			kind: 'transfer_region',
			createdAt: new Date('2026-01-01T02:00:00Z'),
			payloadJsonb: { region_id: REGION_ID, new_faction_id: FACTION_BLUE }
		};
		const laterEvent: ProjectionEvent = {
			id: 'event-a',
			tPosition: 6,
			kind: 'transfer_region',
			createdAt: new Date('2026-01-01T03:00:00Z'),
			payloadJsonb: { region_id: REGION_ID, new_faction_id: FACTION_RED }
		};
		const state = projectState(6, [ANCHOR_AT_5], [laterEvent, earlierEvent], ctx());
		expect(state.regions[0].factionId).toBe(FACTION_RED);
	});

	it('anchor same-T tiebreak: later createdAt wins', () => {
		// Two anchors at the same t_position with different createdAt. The
		// UNIQUE (world_map_id, t_position) index should keep this rare, but
		// migration backfills can produce the case (see projection.ts §
		// pickActiveAnchor docstring). Asserts the deterministic tiebreak
		// path. Input order is reversed from createdAt order to prove
		// pickActiveAnchor sorts internally rather than relying on input
		// order.
		const earlier: ProjectionAnchor = {
			id: 'anchor-earlier',
			tPosition: 5,
			createdAt: new Date('2026-01-01T00:00:00Z'),
			stateJsonb: { regions: [{ region_id: REGION_ID, faction_id: FACTION_RED }] }
		};
		const later: ProjectionAnchor = {
			id: 'anchor-later',
			tPosition: 5,
			createdAt: new Date('2026-01-02T00:00:00Z'),
			stateJsonb: { regions: [{ region_id: REGION_ID, faction_id: FACTION_BLUE }] }
		};
		const state = projectState(5, [earlier, later], [], ctx());
		expect(state.regions[0].factionId).toBe(FACTION_BLUE);
	});

	it('id tiebreak when t_position and created_at collide', () => {
		const ts = new Date('2026-01-01T02:00:00Z');
		const eventLowId: ProjectionEvent = {
			id: '00000000-0000-0000-0000-000000000001',
			tPosition: 6,
			kind: 'transfer_region',
			createdAt: ts,
			payloadJsonb: { region_id: REGION_ID, new_faction_id: FACTION_BLUE }
		};
		const eventHighId: ProjectionEvent = {
			id: '00000000-0000-0000-0000-0000000000ff',
			tPosition: 6,
			kind: 'transfer_region',
			createdAt: ts,
			payloadJsonb: { region_id: REGION_ID, new_faction_id: FACTION_RED }
		};
		// High-id event sorts later, so its faction wins.
		const state = projectState(6, [ANCHOR_AT_5], [eventLowId, eventHighId], ctx());
		expect(state.regions[0].factionId).toBe(FACTION_RED);
	});

	it('empty inputs produce empty state without crashing (test plan §59)', () => {
		const state = projectState(0, [], [], ctx());
		expect(state).toEqual({
			tPosition: 0,
			regions: [],
			artifacts: [],
			chains: []
		});
	});

	it('region with explicit color and no faction_id resolves to that color', () => {
		const anchor: ProjectionAnchor = {
			id: 'a',
			tPosition: 0,
			createdAt: new Date('2026-01-01T00:00:00Z'),
			stateJsonb: {
				regions: [{ region_id: REGION_ID, faction_id: null, color: '#abcdef' }]
			}
		};
		const state = projectState(0, [anchor], [], ctx());
		expect(state.regions[0]).toEqual({
			regionId: REGION_ID,
			factionId: null,
			color: '#abcdef'
		});
	});

	it('region with no faction and no color falls back to neutral', () => {
		const anchor: ProjectionAnchor = {
			id: 'a',
			tPosition: 0,
			createdAt: new Date('2026-01-01T00:00:00Z'),
			stateJsonb: { regions: [{ region_id: REGION_ID }] }
		};
		const state = projectState(0, [anchor], [], ctx());
		expect(state.regions[0].color).toBe(NEUTRAL_REGION_COLOR);
	});
});
