import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { failedWrites, flushPendingWrites } from '../../src/lib/stores/pending-writes.js';
import { notesStore, noteFolders, noteEntries } from '../../src/lib/stores/notes.js';
import { entities, entityLoadStatus } from '../../src/lib/stores/entities.js';
import { boardImport, sendReferenceToBoard } from '../../src/lib/features/whiteboard/send-to-board.js';

// =============================================================================
// Helpers
// =============================================================================

function makeResponse(body: unknown, ok = true, status = 200): Response {
	return {
		ok,
		status,
		json: async () => body,
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
	} as unknown as Response;
}

beforeEach(async () => {
	failedWrites.set([]);
	boardImport.set(null);
	// Reset stores by loading empty
	globalThis.fetch = vi.fn().mockResolvedValue(makeResponse([])) as unknown as typeof fetch;
	await notesStore.loadFolders();
	await notesStore.loadEntries();
	await entities.load();
});

// =============================================================================
// loadFolders()
// =============================================================================

describe('notesStore.loadFolders', () => {
	it('fetches /api/notes/folders and populates store', async () => {
		const data = [
			{ id: 'f1', name: 'World Lore', type: 'Note', data: { isFolder: true }, parentId: null, position: 0, createdAt: 0, updatedAt: 0 },
			{ id: 'f2', name: 'Characters', type: 'Note', data: { isFolder: true }, parentId: null, position: 1, createdAt: 0, updatedAt: 0 }
		];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(data)) as unknown as typeof fetch;

		await notesStore.loadFolders();

		expect(get(noteFolders)).toHaveLength(2);
		expect(get(noteFolders)[0]).toEqual({ id: 'f1', name: 'World Lore', position: 0, parentId: null });
	});
});

// =============================================================================
// loadEntries()
// =============================================================================

describe('notesStore.loadEntries', () => {
	it('fetches all entries without folder filter', async () => {
		const data = [
			{ id: 'e1', name: 'Note A', type: 'Note', data: { body: 'hello' }, parentId: 'f1', position: 0, createdAt: 0, updatedAt: 0 }
		];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(data)) as unknown as typeof fetch;

		await notesStore.loadEntries();

		expect(get(noteEntries)).toHaveLength(1);
		expect(get(noteEntries)[0]).toEqual({ id: 'e1', name: 'Note A', body: 'hello', folderId: 'f1', position: 0 });
	});

	it('filters by folderId query param', async () => {
		const data = [
			{ id: 'e2', name: 'Note B', type: 'Note', data: { body: '' }, parentId: 'f1', position: 0, createdAt: 0, updatedAt: 0 }
		];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(data)) as unknown as typeof fetch;

		await notesStore.loadEntries('f1');

		expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes/entries?folderId=f1');
	});
});

// =============================================================================
// createFolder()
// =============================================================================

describe('notesStore.createFolder', () => {
	it('POSTs to /api/notes/folders and adds to store', async () => {
		const created = { id: 'f3', name: 'New Folder', type: 'Note', data: { isFolder: true }, parentId: null, position: null, createdAt: 0, updatedAt: 0 };
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(created, true, 201)) as unknown as typeof fetch;

		const result = await notesStore.createFolder('New Folder');

		expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes/folders', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'New Folder' })
		});
		expect(result.id).toBe('f3');
		expect(get(noteFolders)).toHaveLength(1);
	});
});

// =============================================================================
// createEntry()
// =============================================================================

describe('notesStore.createEntry', () => {
	it('POSTs to /api/notes/entries with parentId and adds to store', async () => {
		const created = { id: 'e3', name: 'Untitled', type: 'Note', data: { body: '' }, parentId: 'f1', position: null, createdAt: 0, updatedAt: 0 };
		globalThis.fetch = vi.fn()
			.mockResolvedValueOnce(makeResponse(created, true, 201))
			.mockResolvedValue(makeResponse([created])) as unknown as typeof fetch;

		const result = await notesStore.createEntry('Untitled', 'f1');

		expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes/entries', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Untitled', body: '', parentId: 'f1' })
		});
		expect(result.id).toBe('e3');
		expect(get(noteEntries)).toHaveLength(1);
		expect(get(entities)).toEqual([created]);
	});
});

// =============================================================================
// updateEntry()
// =============================================================================

describe('notesStore.updateEntry', () => {
	it('PATCHes entry and updates store', async () => {
		// Seed an entry
		const seed = [{ id: 'e1', name: 'Old', type: 'Note', data: { body: 'old' }, parentId: 'f1', position: 0, createdAt: 0, updatedAt: 0 }];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(seed)) as unknown as typeof fetch;
		await notesStore.loadEntries();
		await entities.load();

		const updated = { id: 'e1', name: 'Updated', type: 'Note', data: { body: 'new body' }, parentId: 'f1', position: 0, createdAt: 0, updatedAt: 0 };
		globalThis.fetch = vi.fn()
			.mockResolvedValueOnce(makeResponse(updated))
			.mockResolvedValue(makeResponse([updated])) as unknown as typeof fetch;

		await notesStore.updateEntry('e1', { name: 'Updated', body: 'new body' });

		expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes/entries/e1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Updated', body: 'new body' })
		});
		expect(get(noteEntries)[0].name).toBe('Updated');
		expect(get(noteEntries)[0].body).toBe('new body');
		expect(get(entities)).toEqual([updated]);
	});

	it('sends a saved draft title even when refreshing entity references fails', async () => {
		const seed = { id: 'e1', name: 'Old', type: 'Note', data: { body: 'old' }, parentId: 'f1', position: 0, createdAt: 0, updatedAt: 0 };
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse([seed])) as unknown as typeof fetch;
		await notesStore.loadEntries();
		await entities.load();
		globalThis.fetch = vi.fn()
			.mockResolvedValueOnce(makeResponse({ ...seed, name: 'Saved', data: { body: 'Kept' } }))
			.mockResolvedValue(makeResponse({}, false, 503)) as unknown as typeof fetch;

		notesStore.editDraft('e1', { name: 'Saved', body: 'Kept' });
		await sendReferenceToBoard({ kind: 'entity', id: 'e1' }, 'Old');
		expect(get(boardImport)).toMatchObject({ kind: 'reference', name: 'Saved', target: { kind: 'entity', id: 'e1' } });
		expect(get(noteEntries)[0]).toMatchObject({ name: 'Saved', body: 'Kept' });
		expect(notesStore.drafts.size).toBe(0);
		expect(get(notesStore.saveState)).toBe('saved');
		expect(get(entityLoadStatus)).toBe('error');
		expect(get(failedWrites)).toHaveLength(0);
	});
});

it('uses the current entity title when Notes still holds an older saved title', async () => {
	const note = { id: 'e1', name: 'Old note title', type: 'Note', data: { body: '' }, parentId: 'f1', position: 0, createdAt: 0, updatedAt: 0 };
	globalThis.fetch = vi.fn().mockResolvedValue(makeResponse([note])) as unknown as typeof fetch;
	await notesStore.loadEntries();
	globalThis.fetch = vi.fn().mockResolvedValue(makeResponse([{ ...note, name: 'Renamed in Wiki' }])) as unknown as typeof fetch;
	await entities.load();

	await sendReferenceToBoard({ kind: 'entity', id: note.id }, 'Old note title');
	expect(get(boardImport)).toMatchObject({ kind: 'reference', name: 'Renamed in Wiki', target: { kind: 'entity', id: note.id } });
});

// =============================================================================
// deleteEntry()
// =============================================================================

describe('notesStore.deleteEntry', () => {
	it('DELETEs entry and removes from store', async () => {
		const seed = [{ id: 'e1', name: 'To Delete', type: 'Note', data: { body: '' }, parentId: 'f1', position: 0, createdAt: 0, updatedAt: 0 }];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(seed)) as unknown as typeof fetch;
		await notesStore.loadEntries();
		await entities.load();
		expect(get(noteEntries)).toHaveLength(1);

		globalThis.fetch = vi.fn()
			.mockResolvedValueOnce(makeResponse({ ok: true }))
			.mockResolvedValue(makeResponse([])) as unknown as typeof fetch;
		await notesStore.deleteEntry('e1');

		expect(get(noteEntries)).toHaveLength(0);
		expect(get(entities)).toHaveLength(0);
	});
});

// =============================================================================
// deleteFolder()
// =============================================================================

describe('notesStore.deleteFolder', () => {
	it('DELETEs folder and removes from store along with its entries', async () => {
		// Seed
		globalThis.fetch = vi.fn()
			.mockResolvedValueOnce(makeResponse([{ id: 'f1', name: 'Folder', type: 'Note', data: { isFolder: true }, parentId: null, position: 0, createdAt: 0, updatedAt: 0 }])) as unknown as typeof fetch;
		await notesStore.loadFolders();

		globalThis.fetch = vi.fn()
			.mockResolvedValue(makeResponse([{ id: 'e1', name: 'Entry', type: 'Note', data: { body: '' }, parentId: 'f1', position: 0, createdAt: 0, updatedAt: 0 }])) as unknown as typeof fetch;
		await notesStore.loadEntries('f1');
		await entities.load();

		expect(get(noteFolders)).toHaveLength(1);
		expect(get(noteEntries)).toHaveLength(1);

		// Delete
		globalThis.fetch = vi.fn()
			.mockResolvedValueOnce(makeResponse({ ok: true }))
			.mockResolvedValue(makeResponse([])) as unknown as typeof fetch;
		await notesStore.deleteFolder('f1');

		expect(get(noteFolders)).toHaveLength(0);
		expect(get(noteEntries)).toHaveLength(0);
		expect(get(entities)).toHaveLength(0);
	});
});


it.each([true, false])('waits for a pending folder rename before sign-out (success: %s)', async (ok) => {
	let finish!: (response: Response) => void;
	globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
	const rename = notesStore.renameFolder('f1', 'Renamed');
	const handledRename = rename.catch(() => undefined);
	let drained = false;
	const flush = flushPendingWrites().then(() => { drained = true; return true; }, () => { drained = true; return false; });
	await Promise.resolve();
	expect(drained).toBe(false);
	finish(makeResponse({ name: 'Renamed' }, ok, ok ? 200 : 500));
	expect(await flush).toBe(ok);
	await handledRename;
});


it('retains an already-failed rename until the user acknowledges it', async () => {
	globalThis.fetch = vi.fn().mockResolvedValue(makeResponse({}, false, 500));
	await expect(notesStore.renameFolder('f1', 'Keep this name')).rejects.toThrow('Failed to rename folder');
	await expect(flushPendingWrites()).rejects.toThrow(/failed to save/);
	failedWrites.set([]);
	await expect(flushPendingWrites()).resolves.toBeUndefined();
});


it('tracks a failed folder creation once and a successful retry clears it', async () => {
	globalThis.fetch = vi.fn().mockResolvedValue(makeResponse({}, false, 503));
	await expect(notesStore.createFolder('Retry folder')).rejects.toThrow();
	expect(get(failedWrites)).toHaveLength(1);
	await expect(flushPendingWrites()).rejects.toThrow(/failed to save/);
	globalThis.fetch = vi.fn().mockResolvedValue(makeResponse({ id: 'retry-folder', name: 'Retry folder' }));
	await notesStore.createFolder('Retry folder');
	await expect(flushPendingWrites()).resolves.toBeUndefined();
	expect(get(failedWrites)).toHaveLength(0);
});
