import { afterEach, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { failedWrites, flushPendingWrites, trackWrite } from '$lib/stores/pending-writes.js';

afterEach(() => failedWrites.set([]));

it('a successful retry clears only its own failure, including repeated failures', async () => {
  const creation = Symbol();
  await expect(trackWrite(Promise.reject(new Error('Unavailable')))).rejects.toThrow();
  await expect(trackWrite(Promise.reject(new Error('Unavailable')), creation)).rejects.toThrow();
  await expect(trackWrite(Promise.reject(new Error('Unavailable')), creation)).rejects.toThrow();
  expect(get(failedWrites)).toHaveLength(2);
  await expect(flushPendingWrites()).rejects.toThrow(/failed to save/);
  await trackWrite(Promise.resolve('created'), creation);
  expect(get(failedWrites)).toHaveLength(1);
  await expect(flushPendingWrites()).rejects.toThrow(/failed to save/);
  failedWrites.set([]);
  await expect(flushPendingWrites()).resolves.toBeUndefined();
});
