// Pins the auto-dismiss toast helper. Most-load-bearing case: a second
// show() call within the dismiss window must clear the prior timer so the
// older timeout cannot blank the newer message early. This was the bug
// fixed in commit 1b2f000 (timer-not-cleared in ActsHeader's reorderError);
// the helper is the shared implementation, and these tests pin the
// contract so a future refactor can't silently regress the fix.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAutoDismiss } from '../../src/lib/features/timeline/auto-dismiss.js';

describe('createAutoDismiss', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('sets the message immediately and clears it after the dismiss window', () => {
		let current: string | null = null;
		const toast = createAutoDismiss((m) => {
			current = m;
		});
		toast.show('hello');
		expect(current).toBe('hello');
		vi.advanceTimersByTime(4000);
		expect(current).toBeNull();
	});

	it('clears the prior timer when a new show() fires within the window', () => {
		let current: string | null = null;
		const toast = createAutoDismiss((m) => {
			current = m;
		});
		toast.show('first');
		vi.advanceTimersByTime(3000); // 1s before first dismiss
		toast.show('second');
		// First timer would have fired at +4000; if not cleared, it would blank
		// the message here. Should still read 'second' because the prior timer
		// was cancelled.
		vi.advanceTimersByTime(1500);
		expect(current).toBe('second');
		// Second timer fires at original +3000+4000=7000; advance to that.
		vi.advanceTimersByTime(2500);
		expect(current).toBeNull();
	});

	it('cancel() prevents a pending dismiss from running', () => {
		let current: string | null = null;
		const toast = createAutoDismiss((m) => {
			current = m;
		});
		toast.show('pending');
		toast.cancel();
		vi.advanceTimersByTime(10000);
		// Setter was called once for show, never for the cancelled dismiss.
		expect(current).toBe('pending');
	});

	it('cancel() is safe to call when no timer is pending', () => {
		const toast = createAutoDismiss(() => {});
		// Must not throw.
		expect(() => toast.cancel()).not.toThrow();
		expect(() => toast.cancel()).not.toThrow();
	});

	it('honors a custom dismiss duration', () => {
		let current: string | null = null;
		const toast = createAutoDismiss((m) => {
			current = m;
		}, 1000);
		toast.show('quick');
		vi.advanceTimersByTime(500);
		expect(current).toBe('quick');
		vi.advanceTimersByTime(500);
		expect(current).toBeNull();
	});
});
