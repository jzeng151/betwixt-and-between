import { writable } from 'svelte/store';

export const entityAliasesLoadStatus = writable<'idle' | 'loading' | 'ready' | 'error'>('idle');
export const entityAliasesSnapshotReady = writable(false);

type EntityAlias = {
	id: string;
	primaryEntityId: string;
	aliasEntityId: string;
	revealedAtPosition: number | null;
};

function createEntityAliasStore() {
	const { subscribe, set, update } = writable<EntityAlias[]>([]);
	let loadPromise: Promise<void> | null = null;
	let generation = 0;

	function load(): Promise<void> {
		if (loadPromise) return loadPromise;
		const loadGeneration = ++generation;
		entityAliasesLoadStatus.set('loading');
		const request = (async () => {
			const res = await fetch('/api/entity-aliases');
			if (!res.ok) throw new Error(await res.text());
			const data: EntityAlias[] = await res.json();
			if (loadGeneration !== generation) return;
			set(data);
			entityAliasesSnapshotReady.set(true);
			entityAliasesLoadStatus.set('ready');
		})().catch((error) => {
			if (loadGeneration === generation) entityAliasesLoadStatus.set('error');
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
		generation++;
		loadPromise = null;
		update((all) =>
			all.some((alias) => alias.id === created.id)
				? all.map((alias) => (alias.id === created.id ? created : alias))
				: [...all, created]
		);
		entityAliasesSnapshotReady.set(true);
		entityAliasesLoadStatus.set('ready');
		return created;
	}

	return { subscribe, load, createAlias };
}

export const entityAliases = createEntityAliasStore();
