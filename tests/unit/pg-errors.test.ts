/**
 * 2026-06 audit — shared Postgres unique-violation (SQLSTATE 23505)
 * classifier. The drivers wrap the original error inconsistently (the code
 * sits on the error itself OR on `.cause`), so isUniqueViolation checks both
 * levels. This is what powers the 23505 -> 409 conflict translation on the
 * entities/relationships/maps routes; a missed branch would surface a genuine
 * conflict as a 500 (or, before the audit, a leaked raw driver message).
 */

import { describe, it, expect } from 'vitest';
import { isUniqueViolation } from '../../src/lib/server/pg-errors.js';

describe('isUniqueViolation', () => {
	it('matches a top-level 23505 code', () => {
		expect(isUniqueViolation({ code: '23505' })).toBe(true);
	});

	it('matches a driver-wrapped 23505 on .cause', () => {
		expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
	});

	it('rejects other SQLSTATEs', () => {
		expect(isUniqueViolation({ code: '23503' })).toBe(false); // FK violation
		expect(isUniqueViolation({ cause: { code: '23514' } })).toBe(false); // CHECK
	});

	it('rejects null, non-objects, and shapes without a code', () => {
		expect(isUniqueViolation(null)).toBe(false);
		expect(isUniqueViolation(undefined)).toBe(false);
		expect(isUniqueViolation('23505')).toBe(false);
		expect(isUniqueViolation({})).toBe(false);
		expect(isUniqueViolation({ cause: null })).toBe(false);
		expect(isUniqueViolation(new Error('boom'))).toBe(false);
	});
});
