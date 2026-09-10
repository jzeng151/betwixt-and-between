import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import AccountSettings from '$lib/components/apps/AccountSettings.svelte';
import { failedWrites } from '$lib/stores/pending-writes.js';

const mocks = vi.hoisted(() => ({ close: vi.fn(), signOut: vi.fn(), logout: vi.fn() }));
vi.mock('$lib/workspace-session.js', () => ({ closeWorkspaces: mocks.close }));
vi.mock('$lib/os/preferences-sync.js', () => ({ onAuthChange: mocks.logout }));
vi.mock('$lib/auth-client.js', () => ({ authClient: { signOut: mocks.signOut } }));
const user = { id: 'user', name: 'Writer', email: 'writer@example.com', emailVerified: true };

beforeEach(() => {
  vi.resetAllMocks();
  failedWrites.set([]);
  mocks.close.mockImplementation((signOut) => signOut(new AbortController().signal));
  mocks.signOut.mockResolvedValue({ error: { message: 'Network unavailable' } });
});
afterEach(cleanup);

it.each(['save', 'session'])('keeps the workspace available when %s prevents sign-out', async (failure) => {
  if (failure === 'save') mocks.close.mockRejectedValue(new Error('Could not save changes'));
  const ui = render(AccountSettings, { user });
  expect(ui.getByText('writer@example.com')).toBeInTheDocument();
  await fireEvent.click(ui.getByRole('button', { name: 'Sign out' }));
  expect(await ui.findByRole('alert')).toHaveTextContent(failure === 'save' ? 'Could not save changes' : 'Network unavailable');
  expect(ui.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  expect(mocks.logout).not.toHaveBeenCalled();
  if (failure === 'save') expect(mocks.signOut).not.toHaveBeenCalled();
});

it('lets the user explicitly acknowledge failed writes', async () => {
  failedWrites.set(['Failed to rename folder']);
  const ui = render(AccountSettings, { user });
  expect(ui.getByText('Failed to rename folder')).toBeInTheDocument();
  await fireEvent.click(ui.getByRole('button', { name: 'Acknowledge failed changes' }));
  expect(ui.queryByText('Failed to rename folder')).not.toBeInTheDocument();
});
