import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { timelineFilter } from '$lib/stores/timelineFilter.js';

describe('timelineFilter', () => {
	beforeEach(() => {
		timelineFilter.clear();
	});

	it('starts with entityId: null', () => {
		expect(get(timelineFilter)).toEqual({ entityId: null });
	});

	it('focus(id) sets the entityId', () => {
		timelineFilter.focus('e1');
		expect(get(timelineFilter)).toEqual({ entityId: 'e1' });
	});

	it('clear() resets to null', () => {
		timelineFilter.focus('e1');
		timelineFilter.clear();
		expect(get(timelineFilter)).toEqual({ entityId: null });
	});

	it('focus(id2) replaces an existing focus', () => {
		timelineFilter.focus('e1');
		timelineFilter.focus('e2');
		expect(get(timelineFilter)).toEqual({ entityId: 'e2' });
	});
});
