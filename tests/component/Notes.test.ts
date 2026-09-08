import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import Notes from '$lib/components/apps/Notes.svelte';
import { notesStore } from '$lib/stores/notes.js';

const folders = [
  { id: 'drafts', name: 'Drafts', position: 0, parentId: null },
  { id: 'research', name: 'Research', position: 1, parentId: null }
];
let saved: { id: string; name: string; data: { body: string }; parentId: string; position: number };
let failSave: boolean;
let writes: string[];

beforeEach(() => {
  saved = { id: 'note', name: 'Opening', data: { body: 'Original' }, parentId: 'drafts', position: 0 };
  failSave = false;
  writes = [];
  notesStore.drafts.clear();
  notesStore.saveState.set('saved');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const draft = JSON.parse(init.body as string);
      writes.push(draft.body);
      if (failSave) return new Response('', { status: 500 });
      saved = { ...saved, name: draft.name, data: { body: draft.body } };
      return Response.json(saved);
    }
    return Response.json(url.includes('/folders') ? folders : url.includes('folderId=research') ? [] : [saved]);
  }));
});

afterEach(async () => {
  cleanup();
  failSave = false;
  await notesStore.flushDrafts();
  vi.unstubAllGlobals();
});

async function openNote() {
  const ui = render(Notes);
  await fireEvent.click(await ui.findByText('Drafts'));
  await fireEvent.click(await ui.findByText('Opening'));
  return ui;
}

describe('Notes editing', () => {
  it('saves the current draft before immediate folder navigation and provides a way back to the list', async () => {
    const ui = await openNote();
    await fireEvent.input(ui.getByPlaceholderText('Start writing...'), { target: { value: 'Latest text' } });
    await fireEvent.click(ui.getByText('Research'));
    await waitFor(() => expect(writes).toEqual(['Latest text']));
    await fireEvent.click(ui.getByText('Drafts'));
    await fireEvent.click(await ui.findByText('Opening'));
    expect(ui.getByPlaceholderText('Start writing...')).toHaveValue('Latest text');
    await fireEvent.click(ui.getByText('Back to notes'));
    expect(await ui.findByTitle('New note')).toBeInTheDocument();
    await fireEvent.click(ui.getByText('Opening'));
    await fireEvent.click(ui.getByText('Drafts'));
    expect(await ui.findByTitle('New note')).toBeInTheDocument();
    expect(ui.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps the editor and draft on failure, including after closing and reopening Notes', async () => {
    let ui = await openNote();
    failSave = true;
    await fireEvent.input(ui.getByPlaceholderText('Start writing...'), { target: { value: 'Keep this' } });
    await fireEvent.click(ui.getByText('Research'));
    await ui.findByText('Retry saving');
    expect(ui.getByPlaceholderText('Start writing...')).toHaveValue('Keep this');
    cleanup();
    await notesStore.flushDrafts();
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);
    ui = render(Notes);
    await ui.findByText('Retry saving');
    await fireEvent.click(ui.getByText('Drafts'));
    await fireEvent.click(await ui.findByText('Opening'));
    expect(ui.getByPlaceholderText('Start writing...')).toHaveValue('Keep this');
    failSave = false;
    await fireEvent.click(ui.getByText('Retry saving'));
    await waitFor(() => expect(saved.data.body).toBe('Keep this'));
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
    await fireEvent.click(ui.getByText('Drafts'));
    await fireEvent.click(await ui.findByText('Opening'));
    expect(ui.getByPlaceholderText('Start writing...')).toHaveValue('Keep this');
  });

  it('flushes edits on unmount and saves an intentionally emptied body', async () => {
    const ui = await openNote();
    await fireEvent.input(ui.getByPlaceholderText('Start writing...'), { target: { value: '' } });
    cleanup();
    await notesStore.flushDrafts();
    expect(writes).toEqual(['']);
    expect(saved.data.body).toBe('');
  });

  it('serializes a newer draft behind an in-flight save', async () => {
    let finish!: () => void;
    const first = new Promise<void>((resolve) => { finish = resolve; });
    const fetch = vi.mocked(globalThis.fetch);
    fetch.mockImplementationOnce(async () => {
      await first;
      return Response.json({ ...saved, data: { body: 'First' } });
    });
    notesStore.editDraft('note', { name: 'Opening', body: 'First' });
    const saving = notesStore.flushDrafts();
    notesStore.editDraft('note', { name: 'Opening', body: 'Second' });
    finish();
    await saving;
    expect(writes).toEqual(['Second']);
    expect(saved.data.body).toBe('Second');
    expect(notesStore.drafts.size).toBe(0);
  });

  it('shows a failed load and retries it', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('offline'));
    const ui = render(Notes);
    await fireEvent.click(await ui.findByText('Retry loading'));
    await waitFor(() => expect(ui.queryByText('Retry loading')).not.toBeInTheDocument());
    expect(ui.getByText('Drafts')).toBeInTheDocument();
  });
});

it('saves an unrelated note even when a retained draft fails, and clears a locally deleted draft', async () => {
  const normalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith('/missing')) {
      return new Response('', { status: init?.method === 'DELETE' ? 200 : 404 });
    }
    return normalFetch(url, init);
  });
  notesStore.editDraft('missing', { name: 'Gone', body: 'Retain for recovery' });
  expect(await notesStore.flushDrafts('missing')).toBe(false);
  const ui = await openNote();
  await fireEvent.input(ui.getByPlaceholderText('Start writing...'), { target: { value: 'Independent save' } });
  await fireEvent.click(ui.getByText('Research'));
  expect(await ui.findByTitle('New note')).toBeInTheDocument();
  expect(saved.data.body).toBe('Independent save');
  expect(notesStore.drafts.has('missing')).toBe(true);
  await notesStore.deleteEntry('missing');
  expect(notesStore.drafts.size).toBe(0);
  await waitFor(() => expect(ui.queryByText('Retry saving')).not.toBeInTheDocument());
});

it('waits for the unmount save before loading entries on immediate reopen', async () => {
  const ui = await openNote();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const normalFetch = vi.mocked(fetch).getMockImplementation()!;
  let entryReads = 0;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (init?.method === 'PATCH') await pending;
    else if (String(url).includes('/entries')) entryReads++;
    return normalFetch(url, init);
  });
  await fireEvent.input(ui.getByPlaceholderText('Start writing...'), { target: { value: 'Final character!' } });
  cleanup();
  const reopened = render(Notes);
  await reopened.findByText('Drafts');
  expect(entryReads).toBe(0);
  finish();
  await fireEvent.click(reopened.getByText('Drafts'));
  await fireEvent.click(await reopened.findByText('Opening'));
  expect(reopened.getByPlaceholderText('Start writing...')).toHaveValue('Final character!');
});

it('does not let a stale GET overwrite a write completed while that GET was pending', async () => {
  await notesStore.loadEntries();
  let finish!: (response: Response) => void;
  const oldRow = structuredClone(saved);
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const loading = notesStore.loadEntries();
  await waitFor(() => expect(finish).toBeDefined());
  notesStore.editDraft('note', { name: 'Opening', body: 'Newer than GET' });
  await notesStore.flushDrafts('note');
  finish(Response.json([oldRow]));
  await loading;
  expect(get(notesStore.entries).find((entry) => entry.id === 'note')?.body).toBe('Newer than GET');
  const ui = await openNote();
  expect(ui.getByPlaceholderText('Start writing...')).toHaveValue('Newer than GET');
});

it('keeps the current folder error when an older folder request succeeds later', async () => {
  const ui = await openNote();
  await fireEvent.click(ui.getByText('Back to notes'));
  await ui.findByTitle('New note');
  const normalFetch = vi.mocked(fetch).getMockImplementation()!;
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (String(url).includes('folderId=drafts')) return new Promise<Response>((resolve) => { finish = resolve; });
    if (String(url).includes('folderId=research')) return Promise.resolve(new Response('', { status: 500 }));
    return normalFetch(url, init);
  });
  await fireEvent.click(ui.getByRole('button', { name: 'Drafts' }));
  await waitFor(() => expect(finish).toBeDefined());
  await fireEvent.click(ui.getByText('Research'));
  await ui.findByText('Retry loading');
  finish(Response.json([saved]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ui.getByText('Retry loading')).toBeInTheDocument();
});


it('keeps a remotely deleted note selectable after reopening so its unsaved text can be recovered', async () => {
  let ui = await openNote();
  const normalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (init?.method === 'PATCH') return Promise.resolve(new Response('', { status: 404 }));
    if (String(url).includes('/entries')) return Promise.resolve(Response.json([]));
    return normalFetch(url, init);
  });
  await fireEvent.input(ui.getByPlaceholderText('Start writing...'), { target: { value: 'Recover this text' } });
  await notesStore.flushDrafts();
  cleanup();
  ui = render(Notes);
  await ui.findByText('Retry saving');
  await fireEvent.click(ui.getByText('Drafts'));
  await fireEvent.click(await ui.findByText('Opening'));
  expect(ui.getByPlaceholderText('Start writing...')).toHaveValue('Recover this text');
  vi.mocked(fetch).mockImplementation(normalFetch);
});

it('does not create a context-menu note after its folder navigation is superseded', async () => {
  const ui = await openNote();
  const normalFetch = vi.mocked(fetch).getMockImplementation()!;
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (String(url).includes('folderId=drafts')) return new Promise<Response>((resolve) => { finish = resolve; });
    return normalFetch(url, init);
  });
  await fireEvent.contextMenu(ui.getByRole('button', { name: 'Drafts' }));
  await fireEvent.click(ui.getByRole('menuitem', { name: 'New Note...' }));
  await waitFor(() => expect(finish).toBeDefined());
  await fireEvent.click(ui.getByRole('button', { name: 'Research' }));
  finish(Response.json([saved]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  expect(ui.getByTitle('New note')).toBeInTheDocument();
  expect(ui.queryByPlaceholderText('Start writing...')).not.toBeInTheDocument();
});


it('keeps the current folder visible when creating a note in the previous folder finishes later', async () => {
  const ui = await openNote();
  await fireEvent.click(ui.getByText('Back to notes'));
  const normalFetch = vi.mocked(fetch).getMockImplementation()!;
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (init?.method === 'POST') return new Promise<Response>((resolve) => { finish = resolve; });
    return normalFetch(url, init);
  });
  await fireEvent.click(await ui.findByTitle('New note'));
  await waitFor(() => expect(finish).toBeDefined());
  await fireEvent.click(ui.getByRole('button', { name: 'Research' }));
  finish(Response.json({ ...saved, id: 'created', name: 'Untitled' }));
  await waitFor(() => expect(get(notesStore.entries).some((entry) => entry.id === 'created')).toBe(true));
  expect(ui.queryByPlaceholderText('Start writing...')).not.toBeInTheDocument();
  expect(ui.getByTitle('New note')).toBeInTheDocument();
});
