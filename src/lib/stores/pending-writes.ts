import { get, writable } from 'svelte/store';

const pending = new Set<Promise<unknown>>();
const latest = new Map<symbol | string, Promise<unknown>>();
export const failedWrites = writable<Array<{ message: string; retryKey?: symbol | string }>>([]);

// Retry identity follows JSON values, independent of object insertion order.
export function writeRetryKey(operation: string, payload: unknown): string {
	return `${operation}:${JSON.stringify(payload, (_key, value) =>
		value && typeof value === 'object' && !Array.isArray(value)
			? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
			: value
	)}`;
}

export function trackWrite<T>(task: Promise<T>, retryKey?: symbol | string): Promise<T> {
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
				{ message: error instanceof Error ? error.message : 'A change could not be saved', retryKey }
			]);
		}
	);
	return task;
}

export async function flushPendingWrites(): Promise<void> {
	while (pending.size) await Promise.allSettled(pending);
	if (get(failedWrites).length) throw new Error('Some changes failed to save. Review them in Account before signing out.');
}
