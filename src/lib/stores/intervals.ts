import { writable } from 'svelte/store';

/**
 * Client-side store for the intervals API.
 * Shape matches /api/intervals rows. Position values are REAL numbers on the
 * global story-time axis; see docs/adr/0003-premise-4-position-math.md for the math.
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

type CreateIntervalInput = {
	entityId: string;
	startActId: string;
	startSceneId?: string | null;
	endActId: string;
	endSceneId?: string | null;
};

type UpdateIntervalInput = Partial<{
	entityId: string;
	startActId: string;
	startSceneId: string | null;
	endActId: string;
	endSceneId: string | null;
	startPosition: number;
	endPosition: number;
}>;

// SvelteKit error responses are JSON { message: string }. Extract the
// human-readable message rather than surfacing raw JSON to the UI.
async function errorMessage(res: Response): Promise<string> {
	const text = await res.text();
	try {
		const parsed: unknown = JSON.parse(text);
		if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof (parsed as Record<string, unknown>).message === 'string') {
			return (parsed as { message: string }).message;
		}
	} catch {
		// fall through to raw text
	}
	return text;
}

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
		if (!res.ok) throw new Error(await errorMessage(res));
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
			throw new Error(await errorMessage(res));
		}
		// API returns `{ ...updatedRow, absorbed: string[] }` where `absorbed`
		// is the list of sibling rows the server merged into this update.
		// We need to drop those from the store so stale bars stop rendering.
		const body: Interval & { absorbed?: string[] } = await res.json();
		const absorbed = new Set(body.absorbed ?? []);
		const updated: Interval = { ...body };
		// strip the helper field so the store entries match the Interval type
		delete (updated as Interval & { absorbed?: string[] }).absorbed;
		update((all) =>
			all
				.filter((i) => !absorbed.has(i.id))
				.map((i) => (i.id === id ? updated : i))
		);
		return updated;
	}

	async function splitIntervalAt(id: string, atPosition: number): Promise<void> {
		const res = await fetch(`/api/intervals/${id}/split`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ atPosition })
		});
		if (!res.ok) {
			await load();
			throw new Error(await errorMessage(res));
		}
		// Server-side splitInterval mutates the original (left half) and inserts
		// a new row (right half). Reload rather than tracking the diff client-side.
		await load();
	}

	async function deleteInterval(id: string): Promise<void> {
		update((all) => all.filter((i) => i.id !== id));
		let res: Response;
		try {
			res = await fetch(`/api/intervals/${id}`, { method: 'DELETE' });
		} catch (err) {
			// Network error before any response — the optimistic remove would
			// otherwise hide the row forever. Re-sync from the server and rethrow.
			await load();
			throw err;
		}
		if (!res.ok) {
			await load();
			throw new Error(await errorMessage(res));
		}
	}

	return { subscribe, load, createInterval, updateInterval, deleteInterval, splitIntervalAt };
}

export const intervals = createIntervalStore();
