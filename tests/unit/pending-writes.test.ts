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

it.each(['older succeeds', 'older fails'])(
  'only the latest overlapping attempt determines failure state: %s',
  async (order) => {
    const retryKey = 'settings:profile:rename';
    const older = Promise.withResolvers<void>();
    const newer = Promise.withResolvers<void>();
    const first = trackWrite(older.promise, retryKey);
    const second = trackWrite(newer.promise, retryKey);
    if (order === 'older succeeds') {
      newer.reject(new Error('Latest rename failed'));
      await expect(second).rejects.toThrow('Latest rename failed');
      older.resolve();
      await first;
      await expect(flushPendingWrites()).rejects.toThrow(/failed to save/);
      expect(get(failedWrites)).toEqual([{ message: 'Latest rename failed', retryKey }]);
    } else {
      newer.resolve();
      await second;
      older.reject(new Error('Superseded rename failed'));
      await expect(first).rejects.toThrow('Superseded rename failed');
      await expect(flushPendingWrites()).resolves.toBeUndefined();
      expect(get(failedWrites)).toEqual([]);
    }
  }
);
