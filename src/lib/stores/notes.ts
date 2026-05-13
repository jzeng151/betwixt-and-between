import { writable } from 'svelte/store';

type NoteFolder = {
	id: string;
	name: string;
	position: number | null;
	parentId: string | null;
};

export type NoteEntry = {
	id: string;
	name: string;
	body: string;
	folderId: string | null;
	position: number | null;
};

function createNotesStore() {
	const folders = writable<NoteFolder[]>([]);
	const entries = writable<NoteEntry[]>([]);

	async function loadFolders(): Promise<void> {
		const res = await fetch('/api/notes/folders');
		if (!res.ok) throw new Error('Failed to load folders');
		const data = await res.json();
		folders.set(
			data.map((r: Record<string, unknown>) => ({
				id: r.id as string,
				name: r.name as string,
				position: r.position as number | null,
				parentId: r.parentId as string | null
			}))
		);
	}

	async function loadEntries(folderId?: string): Promise<void> {
		const url = folderId ? `/api/notes/entries?folderId=${folderId}` : '/api/notes/entries';
		const res = await fetch(url);
		if (!res.ok) throw new Error('Failed to load entries');
		const data = await res.json();
		const mapped: NoteEntry[] = data.map((r: Record<string, unknown>) => ({
			id: r.id as string,
			name: r.name as string,
			body: ((r.data as Record<string, unknown>)?.body as string) ?? '',
			folderId: r.parentId as string | null,
			position: r.position as number | null
		}));
		if (folderId) {
			// Merge: replace entries for this folder, keep others
			entries.update((all) => {
				const others = all.filter((e) => e.folderId !== folderId);
				return [...others, ...mapped];
			});
		} else {
			entries.set(mapped);
		}
	}

	async function createFolder(name: string): Promise<NoteFolder> {
		const res = await fetch('/api/notes/folders', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name })
		});
		if (!res.ok) throw new Error('Failed to create folder');
		const data = await res.json();
		const folder: NoteFolder = {
			id: data.id,
			name: data.name,
			position: data.position,
			parentId: data.parentId
		};
		folders.update((all) => [...all, folder]);
		return folder;
	}

	async function renameFolder(id: string, name: string): Promise<void> {
		const res = await fetch(`/api/notes/folders/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name })
		});
		if (!res.ok) throw new Error('Failed to rename folder');
		const data = await res.json();
		folders.update((all) => all.map((f) => (f.id === id ? { ...f, name: data.name } : f)));
	}

	async function deleteFolder(id: string): Promise<void> {
		const res = await fetch(`/api/notes/folders/${id}`, { method: 'DELETE' });
		if (!res.ok) throw new Error('Failed to delete folder');
		folders.update((all) => all.filter((f) => f.id !== id));
		entries.update((all) => all.filter((e) => e.folderId !== id));
	}

	async function createEntry(name: string, folderId: string | null): Promise<NoteEntry> {
		const res = await fetch('/api/notes/entries', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, body: '', parentId: folderId })
		});
		if (!res.ok) throw new Error('Failed to create entry');
		const data = await res.json();
		const entry: NoteEntry = {
			id: data.id,
			name: data.name,
			body: '',
			folderId: data.parentId,
			position: data.position
		};
		entries.update((all) => [...all, entry]);
		return entry;
	}

	async function updateEntry(id: string, updates: { name?: string; body?: string; folderId?: string | null }): Promise<void> {
		const payload: Record<string, unknown> = {};
		if (updates.name !== undefined) payload.name = updates.name;
		if (updates.body !== undefined) payload.body = updates.body;
		if (updates.folderId !== undefined) payload.folderId = updates.folderId;

		const res = await fetch(`/api/notes/entries/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) throw new Error('Failed to update entry');
		const data = await res.json();
		entries.update((all) =>
			all.map((e) =>
				e.id === id
					? {
							...e,
							name: data.name ?? e.name,
							body: ((data.data as Record<string, unknown>)?.body as string) ?? e.body,
							folderId: data.parentId ?? e.folderId
						}
					: e
			)
		);
	}

	async function deleteEntry(id: string): Promise<void> {
		const res = await fetch(`/api/notes/entries/${id}`, { method: 'DELETE' });
		if (!res.ok) throw new Error('Failed to delete entry');
		entries.update((all) => all.filter((e) => e.id !== id));
	}

	return {
		folders,
		entries,
		loadFolders,
		loadEntries,
		createFolder,
		renameFolder,
		deleteFolder,
		createEntry,
		updateEntry,
		deleteEntry
	};
}

export const notesStore = createNotesStore();
export const noteFolders = notesStore.folders;
export const noteEntries = notesStore.entries;
