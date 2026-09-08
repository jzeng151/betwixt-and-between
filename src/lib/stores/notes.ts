import { get, writable } from 'svelte/store';

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
	// Drafts survive closing Notes; only a successful write removes one.
	const drafts = new Map<string, { name: string; body: string }>();
	const saveState = writable<'saved' | 'unsaved' | 'saving' | 'error'>('saved');
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	const saving = new Map<string, Promise<boolean>>();
	const saveErrors = new Set<string>();
	const entryVersions = new Map<string, number>();
	let version = 0;

	function warnAboutDrafts(event: BeforeUnloadEvent) {
		if (!drafts.size) return;
		event.preventDefault();
		event.returnValue = '';
	}

	function updateSaveState() {
		if (typeof window !== 'undefined') {
			if (drafts.size) window.addEventListener('beforeunload', warnAboutDrafts);
			else window.removeEventListener('beforeunload', warnAboutDrafts);
		}
		saveState.set(saving.size ? 'saving' : saveErrors.size ? 'error' : drafts.size ? 'unsaved' : 'saved');
	}

	function editDraft(id: string, draft: { name: string; body: string }) {
		drafts.set(id, draft);
		saveErrors.delete(id);
		updateSaveState();
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void flushDrafts(), 300);
	}

	async function flushDrafts(id?: string): Promise<boolean> {
		if (!id) clearTimeout(saveTimer);
		const ids = id ? [id] : [...drafts.keys()];
		const results = await Promise.all(ids.map((noteId) => {
			const active = saving.get(noteId);
			if (active) return active;
			if (!drafts.has(noteId)) return true;
			const task = (async () => {
				try {
					while (drafts.has(noteId)) {
						const draft = drafts.get(noteId)!;
						await updateEntry(noteId, draft);
						if (drafts.get(noteId) === draft) drafts.delete(noteId);
					}
					saveErrors.delete(noteId);
					return true;
				} catch {
					saveErrors.add(noteId);
					return false;
				} finally {
					saving.delete(noteId);
					updateSaveState();
				}
			})();
			saving.set(noteId, task);
			updateSaveState();
			return task;
		}));
		return results.every(Boolean);
	}

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
		await Promise.all(saving.values());
		const startedVersion = version;
		const url = folderId ? `/api/notes/entries?folderId=${folderId}` : '/api/notes/entries';
		const res = await fetch(url);
		if (!res.ok) throw new Error('Failed to load entries');
		const data = await res.json();
		let mapped: NoteEntry[] = data.map((r: Record<string, unknown>) => ({
			id: r.id as string,
			name: r.name as string,
			body: ((r.data as Record<string, unknown>)?.body as string) ?? '',
			folderId: r.parentId as string | null,
			position: r.position as number | null
		}));
		// Keep unsaved drafts reachable, and preserve writes newer than this response.
		mapped = mapped.filter((entry) => !drafts.has(entry.id) && (entryVersions.get(entry.id) ?? 0) <= startedVersion);
		mapped.push(...get(entries).filter((entry) =>
			(drafts.has(entry.id) || (entryVersions.get(entry.id) ?? 0) > startedVersion) && (!folderId || entry.folderId === folderId)
		));

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
		const entryIds = get(entries).filter((entry) => entry.folderId === id).map((entry) => entry.id);
		await Promise.all(entryIds.map((entryId) => flushDrafts(entryId)));
		const res = await fetch(`/api/notes/folders/${id}`, { method: 'DELETE' });
		if (!res.ok) throw new Error('Failed to delete folder');
		for (const entryId of entryIds) {
			drafts.delete(entryId);
			saveErrors.delete(entryId);
			entryVersions.set(entryId, ++version);
		}
		updateSaveState();
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
		entryVersions.set(entry.id, ++version);
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
		entryVersions.set(id, ++version);
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
		await flushDrafts(id);
		const res = await fetch(`/api/notes/entries/${id}`, { method: 'DELETE' });
		if (!res.ok) throw new Error('Failed to delete entry');
		drafts.delete(id);
		saveErrors.delete(id);
		entryVersions.set(id, ++version);
		updateSaveState();
		entries.update((all) => all.filter((e) => e.id !== id));
	}

	return {
		folders,
		entries,
		drafts,
		saveState,
		editDraft,
		flushDrafts,
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
