import { describe, it, expect, beforeEach } from 'vitest';
import {
	registerDirtyField,
	unregisterDirtyField,
	drainPendingCommit,
	_resetPendingCommitRegistry,
	_pendingCommitSize,
	type EditableFieldHandle
} from '$lib/util/pending-commit.js';

function makeHandle(label: string, log: string[]): EditableFieldHandle {
	return {
		commitNow: async () => {
			log.push(`commit:${label}`);
		}
	};
}

describe('pending-commit registry', () => {
	beforeEach(() => {
		_resetPendingCommitRegistry();
	});

	it('starts empty', () => {
		expect(_pendingCommitSize()).toBe(0);
	});

	it('register adds to the registry', () => {
		const h = makeHandle('a', []);
		registerDirtyField(h);
		expect(_pendingCommitSize()).toBe(1);
	});

	it('unregister removes from the registry', () => {
		const h = makeHandle('a', []);
		registerDirtyField(h);
		unregisterDirtyField(h);
		expect(_pendingCommitSize()).toBe(0);
	});

	it('register is idempotent for the same handle', () => {
		const h = makeHandle('a', []);
		registerDirtyField(h);
		registerDirtyField(h);
		expect(_pendingCommitSize()).toBe(1);
	});

	it('drain on empty registry resolves immediately without throwing', async () => {
		await expect(drainPendingCommit()).resolves.toBeUndefined();
	});

	it('drain awaits every registered handle commitNow', async () => {
		const log: string[] = [];
		registerDirtyField(makeHandle('a', log));
		registerDirtyField(makeHandle('b', log));
		registerDirtyField(makeHandle('c', log));

		await drainPendingCommit();

		expect(log.sort()).toEqual(['commit:a', 'commit:b', 'commit:c']);
	});

	it('drain swallows individual failures so other handles still settle', async () => {
		const log: string[] = [];
		const failing: EditableFieldHandle = {
			commitNow: async () => {
				throw new Error('save failed');
			}
		};
		registerDirtyField(makeHandle('a', log));
		registerDirtyField(failing);
		registerDirtyField(makeHandle('c', log));

		// Should NOT throw even though one handle rejects.
		await expect(drainPendingCommit()).resolves.toBeUndefined();
		expect(log.sort()).toEqual(['commit:a', 'commit:c']);
	});

	it('drain runs commits in parallel (Promise.allSettled, not sequential await)', async () => {
		const order: string[] = [];
		const slowA: EditableFieldHandle = {
			commitNow: () =>
				new Promise((resolve) =>
					setTimeout(() => {
						order.push('a');
						resolve();
					}, 30)
				)
		};
		const fastB: EditableFieldHandle = {
			commitNow: () =>
				new Promise((resolve) =>
					setTimeout(() => {
						order.push('b');
						resolve();
					}, 5)
				)
		};
		registerDirtyField(slowA);
		registerDirtyField(fastB);

		const start = Date.now();
		await drainPendingCommit();
		const elapsed = Date.now() - start;

		// If sequential, elapsed would be ~35ms. Parallel: ~30ms.
		// Generous bound to avoid CI flake; the order assertion below is the load-bearing check.
		expect(elapsed).toBeLessThan(50);
		// Fast handle settled before slow one.
		expect(order).toEqual(['b', 'a']);
	});

	it('drained handles remain registered (unregistration is the field component\'s job on blur)', async () => {
		registerDirtyField(makeHandle('a', []));
		await drainPendingCommit();
		expect(_pendingCommitSize()).toBe(1);
	});
});
