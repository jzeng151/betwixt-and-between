import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import Desktop from '$lib/os/Desktop.svelte';
import { entities } from '$lib/stores/entities.js';
import { windowStore } from '$lib/os/windows-store.js';

function response(body: unknown, ok = true, status = 200): Response {
	return { ok, status, json: async () => body, text: async () => String(body) } as Response;
}

beforeEach(async () => {
	cleanup();
	for (const win of get(windowStore)) windowStore.close(win.id);
	globalThis.fetch = vi.fn().mockResolvedValue(response([])) as unknown as typeof fetch;
	await entities.load();
});

describe('Desktop workspace overview', () => {
	it('keeps cached entries visible after a refresh failure', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(response([
			{ id: 'char-1', type: 'Character', name: 'Elara', data: {}, parentId: null, position: null }
		])) as unknown as typeof fetch;
		await entities.load();
		const view = render(Desktop);
		globalThis.fetch = vi.fn().mockResolvedValue(response('offline', false, 503)) as unknown as typeof fetch;

		await expect(entities.load()).rejects.toThrow();

		expect(view.getByRole('button', { name: /Elara/ })).toBeInTheDocument();
		expect(view.getByRole('alert')).toHaveTextContent('Showing the saved entries');
	});

	it('keeps a confirmed empty workspace after a refresh failure', async () => {
		const view = render(Desktop);
		globalThis.fetch = vi.fn().mockResolvedValue(response('offline', false, 503)) as unknown as typeof fetch;

		await expect(entities.load()).rejects.toThrow();

		expect(view.getByRole('heading', { name: 'Start with one true thing.' })).toBeInTheDocument();
		expect(view.getByRole('alert')).toHaveTextContent('Showing the saved entries');
	});

	it('keeps retry focus stable after another load failure', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(response('offline', false, 503)) as unknown as typeof fetch;
		await expect(entities.load()).rejects.toThrow();
		const view = render(Desktop);
		const retry = view.getByRole('button', { name: 'Retry' });

		await fireEvent.click(retry);

		await waitFor(() => expect(view.getByRole('button', { name: 'Retry' })).toHaveFocus());
	});

	it('focuses the overview when the invoking entity was deleted', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(response([
			{ id: 'char-1', type: 'Character', name: 'Elara', data: {}, parentId: null, position: null }
		])) as unknown as typeof fetch;
		await entities.load();
		const view = render(Desktop);
		await fireEvent.click(view.getByRole('button', { name: /Elara/ }));
		globalThis.fetch = vi.fn().mockResolvedValue(response([])) as unknown as typeof fetch;
		await entities.load();
		windowStore.close('entity-detail-char-1');

		await waitFor(() => expect(view.getByRole('main')).toHaveFocus());
	});

	it('does not steal retry focus from a newly opened window', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(response('offline', false, 503)) as unknown as typeof fetch;
		await expect(entities.load()).rejects.toThrow();
		const view = render(Desktop);
		let resolveRetry!: (response: Response) => void;
		globalThis.fetch = vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
			resolveRetry = resolve;
		})) as unknown as typeof fetch;
		await fireEvent.click(view.getByRole('button', { name: 'Retry' }));
		const windowControl = document.createElement('button');
		document.body.append(windowControl);
		windowControl.focus();
		windowStore.open('wiki');
		resolveRetry(response([]));

		await waitFor(() => expect(view.container.querySelector('.desktop')).toHaveClass('locked'));
		expect(windowControl).toHaveFocus();
		windowControl.remove();
	});

	it('does not steal focus when the user leaves a pending retry', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(response('offline', false, 503)) as unknown as typeof fetch;
		await expect(entities.load()).rejects.toThrow();
		const view = render(Desktop);
		let resolveRetry!: (response: Response) => void;
		globalThis.fetch = vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
			resolveRetry = resolve;
		})) as unknown as typeof fetch;
		await fireEvent.click(view.getByRole('button', { name: 'Retry' }));
		const taskbarControl = document.body.appendChild(document.createElement('button'));
		taskbarControl.focus();
		resolveRetry(response('offline', false, 503));

		await waitFor(() => expect(view.getByRole('button', { name: 'Retry' })).not.toBeDisabled());
		expect(taskbarControl).toHaveFocus();
		taskbarControl.remove();
	});
});
