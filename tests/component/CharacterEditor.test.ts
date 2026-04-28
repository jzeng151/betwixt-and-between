import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import CharacterEditor from '$lib/components/apps/CharacterEditor.svelte';
import { entities, type Entity } from '$lib/stores/entities.js';

function makeResponse(body: unknown, ok = true, status = 200): Response {
	return {
		ok,
		status,
		json: async () => body,
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
	} as unknown as Response;
}

function makeCharacter(data: Record<string, unknown> = {}): Entity {
	return {
		id: 'char-1',
		type: 'Character',
		name: 'Aragorn',
		data: JSON.stringify(data),
		parentId: null,
		position: 0,
		createdAt: 0,
		updatedAt: 0
	} as Entity;
}

beforeEach(async () => {
	cleanup();
	// Reset entities store with a known character. The store loads from
	// /api/entities; mock the GET to return our fixture.
	const fixture = makeCharacter();
	globalThis.fetch = vi.fn().mockResolvedValue(makeResponse([fixture])) as unknown as typeof fetch;
	await entities.load();
	// Reset relationships fetch path responses for the rendered groups.
	globalThis.fetch = vi
		.fn()
		.mockImplementation(async (url: string, init?: RequestInit) => {
			if (init?.method === 'PATCH') {
				const body = init.body ? JSON.parse(init.body as string) : {};
				const updated = makeCharacter(body.data ?? {});
				return makeResponse(updated);
			}
			return makeResponse([fixture]);
		}) as unknown as typeof fetch;
});

describe('CharacterEditor — color picker', () => {
	it('clicking a swatch marks it selected (aria-pressed=true)', async () => {
		const { getByTestId } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: 'char-1' }
		});
		const teal = getByTestId('char-color-#2dd4bf');
		expect(teal).toHaveAttribute('aria-pressed', 'false');
		await fireEvent.click(teal);
		await tick();
		await waitFor(() => {
			expect(getByTestId('char-color-#2dd4bf')).toHaveAttribute('aria-pressed', 'true');
		});
	});

	it('entering invalid hex shows an inline error', async () => {
		const { getByTestId, queryByTestId } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: 'char-1' }
		});
		const input = getByTestId('char-color-custom-input') as HTMLInputElement;
		expect(queryByTestId('char-color-custom-error')).toBeNull();
		await fireEvent.input(input, { target: { value: 'red' } });
		await fireEvent.blur(input);
		await tick();
		await waitFor(() => {
			expect(getByTestId('char-color-custom-error')).toBeInTheDocument();
		});
	});

	it('entering valid hex does not show error and selects custom color', async () => {
		const { getByTestId, queryByTestId } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: 'char-1' }
		});
		const input = getByTestId('char-color-custom-input') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: '#abcdef' } });
		await fireEvent.blur(input);
		await tick();
		expect(queryByTestId('char-color-custom-error')).toBeNull();
	});
});

describe('CharacterEditor — show on timeline', () => {
	it('default selection is name-and-note; custom field input is hidden', async () => {
		const { getByTestId, queryByTestId } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: 'char-1' }
		});
		const def = getByTestId('char-tl-name-and-note') as HTMLInputElement;
		expect(def.checked).toBe(true);
		expect(queryByTestId('char-tl-custom-field')).toBeNull();
	});

	it('selecting custom reveals the field input', async () => {
		const { getByTestId } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: 'char-1' }
		});
		const customRadio = getByTestId('char-tl-custom') as HTMLInputElement;
		await fireEvent.click(customRadio);
		await tick();
		await waitFor(() => {
			expect(getByTestId('char-tl-custom-field')).toBeInTheDocument();
		});
	});

	it('selecting name-only hides the field input', async () => {
		const { getByTestId, queryByTestId } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: 'char-1' }
		});
		// First reveal it
		await fireEvent.click(getByTestId('char-tl-custom'));
		await tick();
		await waitFor(() => expect(getByTestId('char-tl-custom-field')).toBeInTheDocument());
		// Then switch to name-only
		await fireEvent.click(getByTestId('char-tl-name-only'));
		await tick();
		await waitFor(() => {
			expect(queryByTestId('char-tl-custom-field')).toBeNull();
		});
	});
});
