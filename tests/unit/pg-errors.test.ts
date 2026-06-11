/**
 * 2026-06 audit — shared Postgres unique-violation (SQLSTATE 23505)
 * classifier. The drivers wrap the original error inconsistently (the code
 * sits on the error itself OR on `.cause`), so isUniqueViolation checks both
 * levels. This is what powers the 23505 -> 409 conflict translation on the
 * entities/relationships/maps routes; a missed branch would surface a genuine
 * conflict as a 500 (or, before the audit, a leaked raw driver message).
 */

import { describe, it, expect } from 'vitest';
import { isUniqueViolation, isPgError, isExclusionViolation } from '../../src/lib/server/pg-errors.js';

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

describe('isPgError', () => {
	it('matches any SQLSTATE on the error itself', () => {
		expect(isPgError({ code: '22P02' })).toBe(true); // invalid uuid syntax (cast)
		expect(isPgError({ code: '23514' })).toBe(true); // CHECK violation
		expect(isPgError({ code: '23505' })).toBe(true); // unique violation
	});

	it('matches a driver-wrapped SQLSTATE on .cause', () => {
		expect(isPgError({ cause: { code: '22P02' } })).toBe(true);
	});

	it('rejects plain app-validation Errors (the 400-worthy class)', () => {
		// writeInterval / resolveRelationshipBounds throw these — they must stay 400.
		expect(isPgError(new Error('entity_id not found: abc'))).toBe(false);
		expect(isPgError(new Error('start_position 2 outside act range [0, 2)'))).toBe(false);
	});

	it('rejects null, non-objects, empty code, and shapes without a code', () => {
		expect(isPgError(null)).toBe(false);
		expect(isPgError(undefined)).toBe(false);
		expect(isPgError('22P02')).toBe(false);
		expect(isPgError({})).toBe(false);
		expect(isPgError({ code: '' })).toBe(false);
		expect(isPgError({ code: 23514 })).toBe(false); // numeric code is not a SQLSTATE string
		expect(isPgError({ cause: null })).toBe(false);
	});
});

describe('isExclusionViolation', () => {
	it('matches a top-level 23P01 code', () => {
		expect(isExclusionViolation({ code: '23P01' })).toBe(true);
	});

	it('matches a driver-wrapped 23P01 on .cause', () => {
		expect(isExclusionViolation({ cause: { code: '23P01' } })).toBe(true);
	});

	it('rejects other SQLSTATEs (it is narrower than isPgError)', () => {
		expect(isExclusionViolation({ code: '23505' })).toBe(false); // unique
		expect(isExclusionViolation({ code: '23514' })).toBe(false); // CHECK
		expect(isExclusionViolation({ cause: { code: '23503' } })).toBe(false); // FK
	});

	it('rejects null, non-objects, and shapes without a code', () => {
		expect(isExclusionViolation(null)).toBe(false);
		expect(isExclusionViolation('23P01')).toBe(false);
		expect(isExclusionViolation({})).toBe(false);
		expect(isExclusionViolation(new Error('boom'))).toBe(false);
	});
});
