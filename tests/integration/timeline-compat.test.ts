/**
 * Tests for the V1-bridge compat layer.
 *
 * Two functions: getCharacterAppearancesForActs() and getAppearsInRelationships().
 * Both synthesize appears_in-shaped rows from intervals so the V1 timeline AND
 * StoryGraph keep working through the PR 1 transition window.
 *
 * Throwaway code; deleted in PR 2. These tests confirm it does what it says
 * during the transition.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedActs } from '../helpers/test-db.js';
import { entities } from '../../src/lib/server/db/schema.js';
import { writeInterval } from '../../src/lib/server/intervals.js';
import {
	getCharacterAppearancesForActs,
	getAppearsInRelationships,
	isSyntheticAppearsInId
} from '../../src/lib/server/timeline-compat.js';

describe('compat: getCharacterAppearancesForActs', () => {
	let db: ReturnType<typeof createTestDb>;
	let acts: { act0: string; act1: string; act2: string };
	let ellie: string;
	let damien: string;

	beforeEach(async () => {
		db = createTestDb();
		acts = await seedActs(db);
		const [a] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		ellie = a.id;
		const [b] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Damien' })
			.returning();
		damien = b.id;
	});

	it('returns empty when no intervals exist', async () => {
		const result = await getCharacterAppearancesForActs(db);
		expect(result).toEqual([]);
	});

	it('emits one tuple per single-act interval', async () => {
		await writeInterval(db, { entityId: ellie, startActId: acts.act1, endActId: acts.act1 });
		const result = await getCharacterAppearancesForActs(db);
		expect(result).toEqual([{ entityId: ellie, actId: acts.act1 }]);
	});

	it('emits one tuple per act for multi-act intervals', async () => {
		// Damien spans Act 0 → Act 2 (3 acts).
		await writeInterval(db, { entityId: damien, startActId: acts.act0, endActId: acts.act2 });
		const result = await getCharacterAppearancesForActs(db);
		expect(result).toHaveLength(3);
		const actIds = result.map((r) => r.actId);
		expect(actIds).toContain(acts.act0);
		expect(actIds).toContain(acts.act1);
		expect(actIds).toContain(acts.act2);
		for (const r of result) expect(r.entityId).toBe(damien);
	});

	it('respects the entityId filter', async () => {
		await writeInterval(db, { entityId: ellie, startActId: acts.act0, endActId: acts.act0 });
		await writeInterval(db, { entityId: damien, startActId: acts.act2, endActId: acts.act2 });
		const result = await getCharacterAppearancesForActs(db, { entityId: ellie });
		expect(result).toHaveLength(1);
		expect(result[0].entityId).toBe(ellie);
	});
});

describe('compat: getAppearsInRelationships', () => {
	let db: ReturnType<typeof createTestDb>;
	let acts: { act0: string; act1: string; act2: string };
	let ellie: string;

	beforeEach(async () => {
		db = createTestDb();
		acts = await seedActs(db);
		const [a] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		ellie = a.id;
	});

	it('synthesizes rows in the relationships shape', async () => {
		await writeInterval(db, { entityId: ellie, startActId: acts.act0, endActId: acts.act0 });
		const rows = await getAppearsInRelationships(db);
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row.fromId).toBe(ellie);
		expect(row.toId).toBe(acts.act0);
		expect(row.type).toBe('appears_in');
		expect(row.label).toBeNull();
		expect(row.id.startsWith('compat:')).toBe(true);
	});

	it('synthetic ids are detectable via isSyntheticAppearsInId', async () => {
		await writeInterval(db, { entityId: ellie, startActId: acts.act0, endActId: acts.act0 });
		const [row] = await getAppearsInRelationships(db);
		expect(isSyntheticAppearsInId(row.id)).toBe(true);
		expect(isSyntheticAppearsInId('cd6c34c8-3648-4021-b5d9-7601c64b686a')).toBe(false);
	});

	it('expands multi-act intervals into one synthetic row per act', async () => {
		await writeInterval(db, { entityId: ellie, startActId: acts.act0, endActId: acts.act2 });
		const rows = await getAppearsInRelationships(db);
		expect(rows).toHaveLength(3);
	});
});
