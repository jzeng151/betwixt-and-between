import { afterEach, expect, it, vi } from 'vitest';
import { storyFetch } from '$lib/story-fetch.js';
import { failedWrites, flushPendingWrites } from '$lib/stores/pending-writes.js';

afterEach(() => { failedWrites.set([]); vi.unstubAllGlobals(); });

it('waits for story mutations, blocks failed saves, and clears only an identical successful retry', async () => {
	let finish!: (response: Response) => void;
	vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
	const init = { method: 'PATCH', body: JSON.stringify({ name: 'Unsaved name' }) };
	const request = storyFetch('/api/entities/test', init);
	let settled = false;
	const flush = flushPendingWrites().then(() => { settled = true; });
	await Promise.resolve();
	expect(settled).toBe(false);
	finish(new Response('{}'));
	await request;
	await flush;
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })));
	expect((await storyFetch('/api/entities/test', init)).status).toBe(503);
	await expect(flushPendingWrites()).rejects.toThrow(/failed to save/);
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
	await storyFetch('/api/entities/other', init);
	await expect(flushPendingWrites()).rejects.toThrow(/failed to save/);
	await storyFetch('/api/entities/test', init);
	await expect(flushPendingWrites()).resolves.toBeUndefined();
});
