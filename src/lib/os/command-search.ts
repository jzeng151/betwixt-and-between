import type { Entity } from '$lib/stores/entities.js';
import type { NoteEntry } from '$lib/stores/notes.js';
import { APP_CATALOG, DOCK_ORDER } from './app-catalog.js';
import type { AppId } from './app-ids.js';

export type CommandResult = {
	id: string;
	name: string;
	type: string;
} & ({ entity: Entity; appId?: never; note?: never } | { appId: AppId; entity?: never; note?: never } | { note: NoteEntry; entity?: never; appId?: never });

const apps: CommandResult[] = [...DOCK_ORDER, 'story-player' as const].map((appId) => ({
	id: `app-${appId}`, name: APP_CATALOG[appId].title, type: 'App', appId
}));

export function findCommands(entities: Entity[], query: string, notes: NoteEntry[] = []): CommandResult[] {
	const search = query.trim().toLocaleLowerCase();
	const words = search.split(/\s+/);
	// Notes owns live titles/drafts; the core entity snapshot can predate its edits.
	const entries: CommandResult[] = [...apps, ...entities.filter((entity) => entity.type !== 'Note').map((entity) => ({
		id: entity.id, name: entity.name, type: entity.type, entity
	})), ...notes.map((note) => ({ id: `note-${note.id}`, name: note.name, type: 'Notebook note', note }))];
	if (!search) return entries;
	return entries.map((entry) => {
		const name = entry.name.toLocaleLowerCase();
		const text = `${name} ${entry.type.toLocaleLowerCase()}`;
		return { entry, score: !words.every((word) => text.includes(word)) ? -1
			: name === search ? 3 : name.startsWith(search) ? 2 : 1 };
	}).filter(({ score }) => score >= 0)
		.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
		.map(({ entry }) => entry);
}
