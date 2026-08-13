import { writable } from 'svelte/store';

export const entityAliasesLoadStatus = writable<'idle' | 'loading' | 'ready' | 'error'>('idle');

type EntityAlias = {
	id: string;
	primaryEntityId: string;
	aliasEntityId: string;
	revealedAtPosition: number | null;
};

function createEntityAliasStore() {
	const { subscribe, set, update } = writable<EntityAlias[]>([]);
	let loadPromise: Promise<void> | null = null;

	function load(): Promise<void> {
		if (loadPromise) return loadPromise;
		entityAliasesLoadStatus.set('loading');
		const request = (async () => {
			const res = await fetch('/api/entity-aliases');
			if (!res.ok) throw new Error(await res.text());
			const data: EntityAlias[] = await res.json();
			set(data);
			entityAliasesLoadStatus.set('ready');
		})().catch((error) => {
			entityAliasesLoadStatus.set('error');
			throw error;
		});
		loadPromise = request;
		return request.finally(() => {
			if (loadPromise === request) loadPromise = null;
		});
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
		entityAliasesLoadStatus.set('ready');
		return created;
	}

	return { subscribe, load, createAlias };
}

export const entityAliases = createEntityAliasStore();
