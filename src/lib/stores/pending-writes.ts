import { get, writable } from 'svelte/store';

const pending = new Set<Promise<unknown>>();
export const failedWrites = writable<Array<{ message: string; retryKey?: symbol }>>([]);

export function trackWrite<T>(task: Promise<T>, retryKey?: symbol): Promise<T> {
	pending.add(task);
	void task.then(
		() => {
			pending.delete(task);
			if (retryKey) failedWrites.update((errors) => errors.filter((failure) => failure.retryKey !== retryKey));
		},
		(error) => {
			pending.delete(task);
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
	if (get(failedWrites).length) throw new Error('Some changes failed to save. Review them in Account before leaving this workspace.');
}
