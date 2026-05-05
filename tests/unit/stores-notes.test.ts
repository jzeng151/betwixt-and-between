import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { notesStore, noteFolders, noteEntries } from '../../src/lib/stores/notes.js';

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
	// Reset stores by loading empty
	globalThis.fetch = vi.fn().mockResolvedValue(makeResponse([])) as unknown as typeof fetch;
	await notesStore.loadFolders();
	await notesStore.loadEntries();
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
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(created, true, 201)) as unknown as typeof fetch;

		const result = await notesStore.createEntry('Untitled', 'f1');

		expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes/entries', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Untitled', body: '', parentId: 'f1' })
		});
		expect(result.id).toBe('e3');
		expect(get(noteEntries)).toHaveLength(1);
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

		const updated = { id: 'e1', name: 'Updated', type: 'Note', data: { body: 'new body' }, parentId: 'f1', position: 0, createdAt: 0, updatedAt: 0 };
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(updated)) as unknown as typeof fetch;

		await notesStore.updateEntry('e1', { name: 'Updated', body: 'new body' });

		expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes/entries/e1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Updated', body: 'new body' })
		});
		expect(get(noteEntries)[0].name).toBe('Updated');
		expect(get(noteEntries)[0].body).toBe('new body');
	});
});

// =============================================================================
// deleteEntry()
// =============================================================================

describe('notesStore.deleteEntry', () => {
	it('DELETEs entry and removes from store', async () => {
		const seed = [{ id: 'e1', name: 'To Delete', type: 'Note', data: { body: '' }, parentId: 'f1', position: 0, createdAt: 0, updatedAt: 0 }];
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(seed)) as unknown as typeof fetch;
		await notesStore.loadEntries();
		expect(get(noteEntries)).toHaveLength(1);

		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse({ ok: true })) as unknown as typeof fetch;
		await notesStore.deleteEntry('e1');

		expect(get(noteEntries)).toHaveLength(0);
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
			.mockResolvedValueOnce(makeResponse([{ id: 'e1', name: 'Entry', type: 'Note', data: { body: '' }, parentId: 'f1', position: 0, createdAt: 0, updatedAt: 0 }])) as unknown as typeof fetch;
		await notesStore.loadEntries('f1');

		expect(get(noteFolders)).toHaveLength(1);
		expect(get(noteEntries)).toHaveLength(1);

		// Delete
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse({ ok: true })) as unknown as typeof fetch;
		await notesStore.deleteFolder('f1');

		expect(get(noteFolders)).toHaveLength(0);
		expect(get(noteEntries)).toHaveLength(0);
	});
});
