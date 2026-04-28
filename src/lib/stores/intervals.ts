import { writable } from 'svelte/store';

/**
 * Client-side store for the intervals API.
 *
 * Mirrors the pattern in stores/entities.ts and stores/relationships.ts:
 *   - writable list, optimistic CRUD helpers, rollback-via-load on failure.
 *
 * The shape matches what /api/intervals/+server.ts returns (Drizzle row).
 * Position values are REAL numbers on the global story-time axis;
 * see CONSIDERATIONS.md → "Premise 4" for the math.
 */

export type Interval = {
	id: string;
	entityId: string;
	startActId: string;
	startSceneId: string | null;
	endActId: string;
	endSceneId: string | null;
	startPosition: number;
	endPosition: number;
	createdAt: number | Date;
	updatedAt: number | Date;
};

export type CreateIntervalInput = {
	entityId: string;
	startActId: string;
	startSceneId?: string | null;
	endActId: string;
	endSceneId?: string | null;
};

export type UpdateIntervalInput = Partial<{
	entityId: string;
	startActId: string;
	startSceneId: string | null;
	endActId: string;
	endSceneId: string | null;
}>;

function createIntervalStore() {
	const { subscribe, set, update } = writable<Interval[]>([]);

	async function load() {
		const res = await fetch('/api/intervals');
		const data: Interval[] = await res.json();
		set(data);
	}

	async function createInterval(input: CreateIntervalInput): Promise<Interval> {
		const res = await fetch('/api/intervals', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) throw new Error(await res.text());
		const created: Interval = await res.json();
		update((all) => [...all, created]);
		return created;
	}

	async function updateInterval(id: string, patch: UpdateIntervalInput): Promise<Interval> {
		const res = await fetch(`/api/intervals/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (!res.ok) {
			await load();
			throw new Error(await res.text());
		}
		const updated: Interval = await res.json();
		update((all) => all.map((i) => (i.id === id ? updated : i)));
		return updated;
	}

	async function deleteInterval(id: string): Promise<void> {
		update((all) => all.filter((i) => i.id !== id));
		const res = await fetch(`/api/intervals/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			await load();
			throw new Error(await res.text());
		}
	}

	return { subscribe, load, createInterval, updateInterval, deleteInterval };
}

export const intervals = createIntervalStore();
