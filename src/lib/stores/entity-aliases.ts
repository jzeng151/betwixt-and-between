import { writable } from 'svelte/store';

export type EntityAlias = {
	id: string;
	primaryEntityId: string;
	aliasEntityId: string;
	revealedAtPosition: number | null;
};

function createEntityAliasStore() {
	const { subscribe, set, update } = writable<EntityAlias[]>([]);

	async function load() {
		const res = await fetch('/api/entity-aliases');
		if (!res.ok) throw new Error(await res.text());
		const data: EntityAlias[] = await res.json();
		set(data);
	}

	async function createAlias(
		primaryEntityId: string,
		aliasEntityId: string,
		revealedAtPosition?: number | null
	): Promise<EntityAlias> {
		const res = await fetch('/api/entity-aliases', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ primaryEntityId, aliasEntityId, revealedAtPosition: revealedAtPosition ?? null })
		});
		if (!res.ok) throw new Error(await res.text());
		const created: EntityAlias = await res.json();
		update((all) => [...all, created]);
		return created;
	}

	return { subscribe, load, createAlias };
}

export const entityAliases = createEntityAliasStore();
