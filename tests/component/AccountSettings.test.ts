import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import AccountSettings from '$lib/components/apps/AccountSettings.svelte';

const mocks = vi.hoisted(() => ({ notes: vi.fn(), preferences: vi.fn(), signOut: vi.fn(), logout: vi.fn() }));
vi.mock('$lib/stores/notes.js', () => ({ notesStore: { flushDrafts: mocks.notes } }));
vi.mock('$lib/os/preferences-sync.js', () => ({ flushPendingPreferences: mocks.preferences, onAuthChange: mocks.logout }));
vi.mock('$lib/auth-client.js', () => ({ authClient: { signOut: mocks.signOut } }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.notes.mockResolvedValue(true);
  mocks.preferences.mockResolvedValue(undefined);
  mocks.signOut.mockResolvedValue({ error: { message: 'Network unavailable' } });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['notes', 'preferences', 'session'])('keeps the workspace available when %s prevents sign-out', async (failure) => {
  if (failure === 'notes') mocks.notes.mockResolvedValue(false);
  if (failure === 'preferences') mocks.preferences.mockRejectedValue(new Error('Could not save preferences'));
  const ui = render(AccountSettings, { user: { id: 'user', name: 'Writer', email: 'writer@example.com', emailVerified: true } });
  expect(ui.getByText('writer@example.com')).toBeInTheDocument();
  await fireEvent.click(ui.getByRole('button', { name: 'Sign out' }));
  expect(await ui.findByRole('alert')).toHaveTextContent(failure === 'notes' ? "Couldn't save your notes" : failure === 'preferences' ? 'Could not save preferences' : 'Network unavailable');
  expect(ui.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  expect(mocks.logout).not.toHaveBeenCalled();
  if (failure !== 'session') expect(mocks.signOut).not.toHaveBeenCalled();
  else {
    expect(mocks.notes.mock.invocationCallOrder[0]).toBeLessThan(mocks.preferences.mock.invocationCallOrder[0]);
    expect(mocks.preferences.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]);
  }
});

it('blocks further interaction and duplicate requests while saving', async () => {
  let finish!: (saved: boolean) => void;
  mocks.notes.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  const ui = render(AccountSettings, { user: { id: 'user', name: 'Writer', email: 'writer@example.com', emailVerified: true } });
  await fireEvent.click(ui.getByRole('button', { name: 'Sign out' }));
  expect(ui.getByRole('dialog', { name: 'Signing out' })).toHaveAttribute('open');
  expect(ui.getByRole('button', { name: 'Sign out' })).toBeDisabled();
  expect(mocks.signOut).not.toHaveBeenCalled();
  finish(false);
  await ui.findByRole('alert');
  expect(mocks.notes).toHaveBeenCalledTimes(1);
});
