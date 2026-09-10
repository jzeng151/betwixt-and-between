import { afterEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { invalidateAll } from '$app/navigation';
import { startWorkspaceSession, workspaceReady } from '$lib/workspace-session.js';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));
vi.mock('$lib/stores/notes.js', () => ({ notesStore: {} }));
vi.mock('$lib/stores/pending-writes.js', () => ({ flushPendingWrites: vi.fn() }));
vi.mock('$lib/os/preferences-sync.js', () => ({ flushPendingPreferences: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it('ignores an earlier mount whose authentication check finishes after remounting', async () => {
  let finish!: () => void;
  const first = new Promise<void>((resolve) => { finish = resolve; });
  vi.mocked(invalidateAll).mockReturnValueOnce(first).mockResolvedValue(undefined);
  const registrations: Promise<unknown>[] = [];
  const request = vi.fn((name: string, ...args: any[]) => {
    const task = args.at(-1)();
    if (name === 'betwixt-logout') registrations.push(task);
    return task;
  });
  vi.stubGlobal('navigator', { locks: { request } });
  vi.stubGlobal('BroadcastChannel', class { close() {} });
  const unmountFirst = startWorkspaceSession();
  unmountFirst();
  const unmountSecond = startWorkspaceSession();
  try {
    finish();
    await Promise.all(registrations);
    expect(get(workspaceReady)).toBe(true);
    expect(request.mock.calls.filter(([name]) => name.startsWith('betwixt-workspace:'))).toHaveLength(1);
  } finally {
    finish();
    unmountSecond();
  }
});
