import { get, writable } from 'svelte/store';

const pending = new Set<Promise<unknown>>();
export const failedWrites = writable<string[]>([]);

export function trackWrite<T>(task: Promise<T>): Promise<T> {
	pending.add(task);
	void task.then(
		() => pending.delete(task),
		(error) => {
			pending.delete(task);
			failedWrites.update((errors) => [...errors, error instanceof Error ? error.message : 'A change could not be saved']);
		}
	);
	return task;
}

export async function flushPendingWrites(): Promise<void> {
	while (pending.size) await Promise.allSettled(pending);
	if (get(failedWrites).length) throw new Error('Some changes failed to save. Review them in Account before signing out.');
}
