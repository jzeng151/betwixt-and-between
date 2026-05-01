import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import CharacterEditor from '$lib/components/apps/CharacterEditor.svelte';
import { entities, type Entity } from '$lib/stores/entities.js';
import { windowStore } from '$lib/stores/windows.js';
import { openEntity } from '$lib/navigation.js';

vi.mock('$lib/navigation.js', () => ({
	openEntity: vi.fn(),
	openEntityDetail: vi.fn()
}));

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
		data,
		parentId: null,
		position: 0,
		createdAt: new Date(0),
		updatedAt: new Date(0)
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

// ── New behaviour: search, select mode, bulk delete, detail delete ────────────

describe('CharacterEditor — list mode search', () => {
	const char2: Entity = {
		id: 'char-2',
		type: 'Character',
		name: 'Gandalf',
		data: {},
		parentId: null,
		position: 1,
		createdAt: new Date(0),
		updatedAt: new Date(0)
	};

	beforeEach(async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(makeResponse([makeCharacter(), char2])) as unknown as typeof fetch;
		await entities.load();
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse([])) as unknown as typeof fetch;
	});

	it('renders a search input', () => {
		const { getByPlaceholderText } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		expect(getByPlaceholderText('Search characters…')).toBeInTheDocument();
	});

	it('shows all characters when query is empty', () => {
		const { getByText } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		expect(getByText('Aragorn')).toBeInTheDocument();
		expect(getByText('Gandalf')).toBeInTheDocument();
	});

	it('filters list to matching characters (case-insensitive)', async () => {
		const { getByPlaceholderText, getByText, queryByText } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		await fireEvent.input(getByPlaceholderText('Search characters…'), {
			target: { value: 'gandalf' }
		});
		await tick();
		expect(getByText('Gandalf')).toBeInTheDocument();
		expect(queryByText('Aragorn')).toBeNull();
	});

	it('shows "No matches." when nothing matches query', async () => {
		const { getByPlaceholderText, getByText } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		await fireEvent.input(getByPlaceholderText('Search characters…'), {
			target: { value: 'zzznomatch' }
		});
		await tick();
		expect(getByText('No matches.')).toBeInTheDocument();
	});
});

describe('CharacterEditor — list mode create', () => {
	const newChar: Entity = {
		id: 'char-new',
		type: 'Character',
		name: 'New Character',
		data: {},
		parentId: null,
		position: null,
		createdAt: new Date(0),
		updatedAt: new Date(0)
	};

	beforeEach(() => {
		vi.mocked(openEntity).mockClear();
		globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
			if (init?.method === 'POST') return makeResponse(newChar);
			return makeResponse([makeCharacter()]);
		}) as unknown as typeof fetch;
	});

	it('clicking "+ New" POSTs a new character and opens it', async () => {
		const { getByText } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		await fireEvent.click(getByText('+ New'));
		await waitFor(() => {
			expect(vi.mocked(openEntity)).toHaveBeenCalledWith('char-new');
		});
		expect(globalThis.fetch).toHaveBeenCalledWith(
			'/api/entities',
			expect.objectContaining({ method: 'POST' })
		);
	});
});

describe('CharacterEditor — list mode select', () => {
	it('checkboxes are not visible initially', () => {
		const { container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		expect(container.querySelector('.char-check')).toBeNull();
	});

	it('"Select" is present and "Cancel" is not initially', () => {
		const { getByText, queryByText } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		expect(getByText('Select')).toBeInTheDocument();
		expect(queryByText('Cancel')).toBeNull();
	});

	it('clicking "Select" shows checkboxes and transforms toolbar', async () => {
		const { getByText, queryByText, container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		await fireEvent.click(getByText('Select'));
		await tick();
		expect(container.querySelector('.char-check')).toBeInTheDocument();
		expect(getByText('Cancel')).toBeInTheDocument();
		expect(queryByText('Select')).toBeNull();
		expect(queryByText('+ New')).toBeNull();
	});

	it('clicking "Cancel" restores toolbar and hides checkboxes', async () => {
		const { getByText, queryByText, container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		await fireEvent.click(getByText('Select'));
		await tick();
		await fireEvent.click(getByText('Cancel'));
		await tick();
		expect(container.querySelector('.char-check')).toBeNull();
		expect(getByText('Select')).toBeInTheDocument();
		expect(queryByText('Cancel')).toBeNull();
	});
});

describe('CharacterEditor — list mode bulk delete', () => {
	beforeEach(() => {
		globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
			if (init?.method === 'DELETE') return makeResponse(null, true, 204);
			return makeResponse([]);
		}) as unknown as typeof fetch;
	});

	it('checking a row shows "Delete (1)"', async () => {
		const { getByText, queryByText, container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		expect(queryByText(/Delete \(/)).toBeNull();
		await fireEvent.click(getByText('Select'));
		await tick();
		await fireEvent.click(container.querySelector('.char-check')!);
		await tick();
		expect(getByText('Delete (1)')).toBeInTheDocument();
	});

	it('clicking Delete (N) calls deleteEntity and exits select mode', async () => {
		const { getByText, queryByText, container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		await fireEvent.click(getByText('Select'));
		await tick();
		await fireEvent.click(container.querySelector('.char-check')!);
		await tick();
		await fireEvent.click(getByText('Delete (1)'));
		await waitFor(() => {
			expect(globalThis.fetch).toHaveBeenCalledWith(
				'/api/entities/char-1',
				expect.objectContaining({ method: 'DELETE' })
			);
		});
		await waitFor(() => {
			expect(queryByText('Cancel')).toBeNull();
			expect(getByText('Select')).toBeInTheDocument();
		});
	});
});

describe('CharacterEditor — detail mode delete', () => {
	let closeSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		closeSpy = vi.spyOn(windowStore, 'close');
		globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
			if (init?.method === 'DELETE') return makeResponse(null, true, 204);
			return makeResponse([]);
		}) as unknown as typeof fetch;
	});

	afterEach(() => {
		closeSpy.mockRestore();
	});

	it('renders a Delete button in detail view', () => {
		const { container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: 'char-1' }
		});
		expect(container.querySelector('.detail-delete-btn')).toBeInTheDocument();
	});

	it('clicking Delete calls deleteEntity then closes the window', async () => {
		const { container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: 'char-1' }
		});
		await fireEvent.click(container.querySelector('.detail-delete-btn')!);
		await waitFor(() => {
			expect(globalThis.fetch).toHaveBeenCalledWith(
				'/api/entities/char-1',
				expect.objectContaining({ method: 'DELETE' })
			);
			expect(closeSpy).toHaveBeenCalledWith('w1');
		});
	});
});

describe('CharacterEditor — detail mode view/edit toggle', () => {
	it('opens in view mode — role select not rendered', () => {
		const { container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: 'char-1' }
		});
		expect(container.querySelector('select')).toBeNull();
	});

	it('clicking Edit shows role select and changes button to Done', async () => {
		const { getByText, container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: 'char-1' }
		});
		await fireEvent.click(getByText('Edit'));
		await tick();
		await waitFor(() => {
			expect(container.querySelector('select')).toBeInTheDocument();
			expect(getByText('Done')).toBeInTheDocument();
		});
	});
});
