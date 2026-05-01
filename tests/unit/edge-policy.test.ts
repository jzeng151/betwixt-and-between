import { describe, it, expect } from 'vitest';
import { DIRECTION } from '../../src/lib/graph/edge-policy.js';
import { RelationshipType } from '../../src/lib/server/db/schema.js';

describe('DIRECTION policy', () => {
	it('classifies every RelationshipType as directed or symmetric', () => {
		for (const t of RelationshipType) {
			const v = DIRECTION[t];
			expect(v === 'directed' || v === 'symmetric').toBe(true);
		}
	});

	it('marks allied_with and rivals as symmetric', () => {
		expect(DIRECTION.allied_with).toBe('symmetric');
		expect(DIRECTION.rivals).toBe('symmetric');
	});

	it('marks all other types as directed', () => {
		expect(DIRECTION.appears_in).toBe('directed');
		expect(DIRECTION.takes_place_at).toBe('directed');
		expect(DIRECTION.caused_by).toBe('directed');
		expect(DIRECTION.mentor_of).toBe('directed');
		expect(DIRECTION.located_at).toBe('directed');
		expect(DIRECTION.pov_of).toBe('directed');
	});

	it('covers exactly the schema RelationshipType keys', () => {
		const policyKeys = Object.keys(DIRECTION).sort();
		const schemaKeys = [...RelationshipType].sort();
		expect(policyKeys).toEqual(schemaKeys);
	});
});
