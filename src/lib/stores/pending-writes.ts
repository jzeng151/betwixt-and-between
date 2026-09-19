import { get, writable } from 'svelte/store';

const pending = new Set<Promise<unknown>>();
const latest = new Map<symbol | string, Promise<unknown>>();
const creations = new Map<string, Promise<unknown>>();
export const failedWrites = writable<Array<{ message: string; retryKey?: symbol | string; creationId?: string }>>([]);

// Retry identity follows JSON values, independent of object insertion order.
export function writeRetryKey(operation: string, payload: unknown): string {
	return `${operation}:${JSON.stringify(payload, (_key, value) =>
		value && typeof value === 'object' && !Array.isArray(value)
			? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
			: value
	)}`;
}

export function trackCreation<T>(retryKey: string, create: (id: string) => Promise<T>): Promise<T> {
	const inFlight = creations.get(retryKey);
	if (inFlight) return inFlight as Promise<T>;
	const id = get(failedWrites).find((failure) => failure.retryKey === retryKey)?.creationId ?? crypto.randomUUID();
	const task = trackWrite(create(id), retryKey, id).finally(() => creations.delete(retryKey));
	creations.set(retryKey, task);
	return task;
}

export function trackWrite<T>(task: Promise<T>, retryKey?: symbol | string, creationId?: string): Promise<T> {
	pending.add(task);
	if (retryKey) latest.set(retryKey, task);
	void task.then(
		() => {
			pending.delete(task);
			if (retryKey && latest.get(retryKey) === task) {
				latest.delete(retryKey);
				failedWrites.update((errors) => errors.filter((failure) => failure.retryKey !== retryKey));
			}
		},
		(error) => {
			pending.delete(task);
			if (retryKey) {
				if (latest.get(retryKey) !== task) return;
				latest.delete(retryKey);
			}
			failedWrites.update((errors) => [
				...(retryKey ? errors.filter((failure) => failure.retryKey !== retryKey) : errors),
				{ message: error instanceof Error ? error.message : 'A change could not be saved', retryKey, ...(creationId ? { creationId } : {}) }
			]);
		}
	);
	return task;
}

export async function flushPendingWrites(): Promise<void> {
	while (pending.size) await Promise.allSettled(pending);
	if (get(failedWrites).length) throw new Error('Some changes failed to save. Review them in Account before leaving this workspace.');
}
