import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    ui = render(Notes);
    await ui.findByText('Retry saving');
    await fireEvent.click(ui.getByText('Drafts'));
    await fireEvent.click(await ui.findByText('Opening'));
    expect(ui.getByPlaceholderText('Start writing...')).toHaveValue('Keep this');
    failSave = false;
    await fireEvent.click(ui.getByText('Retry saving'));
    await waitFor(() => expect(saved.data.body).toBe('Keep this'));
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
