import { afterEach, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { failedWrites, flushPendingWrites, trackWrite, trackCreation, writeRetryKey } from '$lib/stores/pending-writes.js';

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

it('creation retry identity ignores object key order but preserves source state and array order', () => {
  const appearance = { theme: 'dark', roleColors: { Ally: '#abcdef', Rival: '#123456' } };
  const reordered = { roleColors: { Rival: '#123456', Ally: '#abcdef' }, theme: 'dark' };
  const key = writeRetryKey('preset', { name: 'Colors', appearance });
  expect(writeRetryKey('preset', { appearance: reordered, name: 'Colors' })).toBe(key);
  expect(writeRetryKey('preset', { name: 'Colors', appearance: { ...appearance, theme: 'light' } })).not.toBe(key);
  const source = { name: 'Copy', profileId: 'A', preferences: { appearance } };
  expect(writeRetryKey('profile', { ...source, profileId: 'B' })).not.toBe(writeRetryKey('profile', source));
  expect(writeRetryKey('profile', { ...source, preferences: { appearance: { ...appearance, theme: 'light' } } }))
    .not.toBe(writeRetryKey('profile', source));
  expect(writeRetryKey('ordered', [1, 2])).not.toBe(writeRetryKey('ordered', [2, 1]));
});

it('creation retries share an ID and in-flight request, then retire the ID on success or acknowledgement', async () => {
  const ids: string[] = [];
  const pending = Promise.withResolvers<string>();
  const first = trackCreation('new preset', (id) => { ids.push(id); return pending.promise; });
  expect(trackCreation('new preset', () => { throw new Error('must share pending request'); })).toBe(first);
  pending.reject(new Error('response lost'));
  await expect(first).rejects.toThrow('response lost');
  await trackCreation('new preset', async (id) => { ids.push(id); return 'saved'; });
  expect(ids[1]).toBe(ids[0]);
  await expect(flushPendingWrites()).resolves.toBeUndefined();
  await expect(trackCreation('new preset', async (id) => { ids.push(id); throw new Error('next attempt'); })).rejects.toThrow();
  expect(ids[2]).not.toBe(ids[0]);
  failedWrites.set([]);
  await trackCreation('new preset', async (id) => { ids.push(id); });
  expect(ids[3]).not.toBe(ids[2]);
});
