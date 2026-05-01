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

	it('clicking Delete (N) → Delete confirms and calls deleteEntity, exits select mode', async () => {
		const { getByText, queryByText, container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		await fireEvent.click(getByText('Select'));
		await tick();
		await fireEvent.click(container.querySelector('.char-check')!);
		await tick();
		// First click: arms confirmation. Second click: actually deletes.
		await fireEvent.click(getByText('Delete (1)'));
		await tick();
		await fireEvent.click(getByText('Delete'));
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

	it('Cancel on the bulk-delete confirmation aborts without deleting', async () => {
		const { getByText, container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		await fireEvent.click(getByText('Select'));
		await tick();
		await fireEvent.click(container.querySelector('.char-check')!);
		await tick();
		await fireEvent.click(getByText('Delete (1)'));
		await tick();
		await fireEvent.click(getByText('Cancel'));
		await tick();
		// No DELETE was fired and the toolbar is back to the pre-confirm state.
		expect(globalThis.fetch).not.toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ method: 'DELETE' })
		);
		expect(getByText('Delete (1)')).toBeInTheDocument();
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

	it('renders a Delete character button in detail view footer', () => {
		const { container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: 'char-1' }
		});
		expect(container.querySelector('.btn-delete')).toBeInTheDocument();
	});

	it('clicking Delete character → Delete confirms, calls deleteEntity, closes the window', async () => {
		const { container, getByText } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: 'char-1' }
		});
		// First click: arm confirmation.
		await fireEvent.click(container.querySelector('.btn-delete')!);
		await tick();
		// Confirmation: Cancel + Delete buttons.
		await fireEvent.click(getByText('Delete'));
		await waitFor(() => {
			expect(globalThis.fetch).toHaveBeenCalledWith(
				'/api/entities/char-1',
				expect.objectContaining({ method: 'DELETE' })
			);
			expect(closeSpy).toHaveBeenCalledWith('w1');
		});
	});

	it('Cancel on the detail-view confirmation aborts without deleting', async () => {
		const { container, getByText } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: 'char-1' }
		});
		await fireEvent.click(container.querySelector('.btn-delete')!);
		await tick();
		await fireEvent.click(getByText('Cancel'));
		await tick();
		expect(globalThis.fetch).not.toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ method: 'DELETE' })
		);
		expect(closeSpy).not.toHaveBeenCalled();
		expect(container.querySelector('.btn-delete')).toBeInTheDocument();
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

// ── Greptile-flagged regressions on PR #15 ────────────────────────────────────

describe('CharacterEditor — list mode select × search interaction', () => {
	const aragorn: Entity = {
		id: 'char-aragorn',
		type: 'Character',
		name: 'Aragorn',
		data: {},
		parentId: null,
		position: 0,
		createdAt: new Date(0),
		updatedAt: new Date(0)
	};
	const gandalf: Entity = {
		id: 'char-gandalf',
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
			.mockResolvedValue(makeResponse([aragorn, gandalf])) as unknown as typeof fetch;
		await entities.load();
		globalThis.fetch = vi.fn().mockImplementation(async (_u: string, init?: RequestInit) => {
			if (init?.method === 'DELETE') return makeResponse(null, true, 204);
			return makeResponse([]);
		}) as unknown as typeof fetch;
	});

	it('Delete (N) reflects only currently-visible selections (Greptile P1)', async () => {
		// Select both characters → select Aragorn AND Gandalf → filter to
		// "Gandalf" → toolbar should say Delete (1), not Delete (2).
		const { getByPlaceholderText, getByText, container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		await fireEvent.click(getByText('Select'));
		await tick();
		const checks = container.querySelectorAll('.char-check');
		await fireEvent.click(checks[0]);
		await fireEvent.click(checks[1]);
		await tick();
		expect(getByText('Delete (2)')).toBeInTheDocument();
		await fireEvent.input(getByPlaceholderText('Search characters…'), {
			target: { value: 'gandalf' }
		});
		await tick();
		expect(getByText('Delete (1)')).toBeInTheDocument();
	});

	it('deleteSelected only deletes visible selections (Greptile P1)', async () => {
		// Select Aragorn → filter to "Gandalf" → click Delete → only the
		// hidden Aragorn must NOT get a DELETE request fired. Without the
		// fix, the selected Set carried hidden ids and bulk-deleted them.
		const { getByPlaceholderText, getByText, container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		await fireEvent.click(getByText('Select'));
		await tick();
		// Toggle Aragorn (the first row).
		const checks = container.querySelectorAll('.char-check');
		await fireEvent.click(checks[0]);
		await tick();
		// Filter to Gandalf only.
		await fireEvent.input(getByPlaceholderText('Search characters…'), {
			target: { value: 'gandalf' }
		});
		await tick();
		// No selections in the visible set → Delete button should be hidden.
		expect(getByText('Cancel')).toBeInTheDocument();
		expect(container.querySelector('.delete-btn')).toBeNull();
		// A DELETE for Aragorn must NEVER have been fired (we never clicked
		// delete; the test asserts the no-op state is correct).
		const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
		const deleteCalls = calls.filter(([, init]) => init?.method === 'DELETE');
		expect(deleteCalls).toHaveLength(0);
	});
});

describe('CharacterEditor — row click in select mode toggles selection (Greptile P1)', () => {
	beforeEach(async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(makeResponse([makeCharacter()])) as unknown as typeof fetch;
		await entities.load();
		vi.mocked(openEntity).mockClear();
	});

	it('clicking the row body in select mode toggles instead of opening', async () => {
		const { getByText, container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		await fireEvent.click(getByText('Select'));
		await tick();
		// Click the row BUTTON (not the checkbox div) — previously this
		// always called openEntity, navigating away.
		const row = container.querySelector('.char-row') as HTMLElement;
		await fireEvent.click(row);
		await tick();
		// Selection toggled ON, no navigation fired.
		expect(getByText('Delete (1)')).toBeInTheDocument();
		expect(vi.mocked(openEntity)).not.toHaveBeenCalled();
	});

	it('clicking the row body in non-select mode still opens the entity', async () => {
		const { container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		const row = container.querySelector('.char-row') as HTMLElement;
		await fireEvent.click(row);
		await tick();
		expect(vi.mocked(openEntity)).toHaveBeenCalledWith('char-1');
	});
});

describe('CharacterEditor — checkbox keyboard activation (Greptile P2)', () => {
	beforeEach(async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(makeResponse([makeCharacter()])) as unknown as typeof fetch;
		await entities.load();
	});

	it('Space key on the checkbox div toggles selection', async () => {
		const { getByText, container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		await fireEvent.click(getByText('Select'));
		await tick();
		const check = container.querySelector('.char-check') as HTMLElement;
		await fireEvent.keyDown(check, { key: ' ' });
		await tick();
		expect(getByText('Delete (1)')).toBeInTheDocument();
	});

	it('Enter key on the checkbox div toggles selection', async () => {
		const { getByText, container } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		await fireEvent.click(getByText('Select'));
		await tick();
		const check = container.querySelector('.char-check') as HTMLElement;
		await fireEvent.keyDown(check, { key: 'Enter' });
		await tick();
		expect(getByText('Delete (1)')).toBeInTheDocument();
	});
});

describe('CharacterEditor — createCharacter error surfacing (Greptile P2)', () => {
	beforeEach(() => {
		globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
			if (init?.method === 'POST') return makeResponse({ error: 'boom' }, false, 500);
			return makeResponse([]);
		}) as unknown as typeof fetch;
	});

	it('shows an error message when create fails (was previously silent)', async () => {
		const { getByText, findByText } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: null }
		});
		await fireEvent.click(getByText('+ New'));
		// Inline alert appears.
		expect(await findByText("Couldn't create character.")).toBeInTheDocument();
	});
});

describe('CharacterEditor — mode resets to view on entity navigation (Greptile P1)', () => {
	const arwen: Entity = {
		id: 'char-arwen',
		type: 'Character',
		name: 'Arwen',
		data: {},
		parentId: null,
		position: 1,
		createdAt: new Date(0),
		updatedAt: new Date(0)
	};

	beforeEach(async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(makeResponse([makeCharacter(), arwen])) as unknown as typeof fetch;
		await entities.load();
	});

	it('switching entityId from one character to another lands in view mode', async () => {
		// Open char-1 → click Edit → switch to char-arwen via prop change.
		// Without the fix, mode would carry over as 'edit' for arwen
		// (contradicting the PR's stated read-first contract).
		const { getByText, container, rerender } = render(CharacterEditor, {
			props: { winId: 'w1', entityId: 'char-1' }
		});
		await fireEvent.click(getByText('Edit'));
		await tick();
		expect(container.querySelector('select')).toBeInTheDocument();
		// Simulate in-place navigation (e.g. EntityLink chip click).
		await rerender({ winId: 'w1', entityId: 'char-arwen' });
		await tick();
		await waitFor(() => {
			// Arwen opens in VIEW mode → no role select rendered.
			expect(container.querySelector('select')).toBeNull();
			expect(getByText('Edit')).toBeInTheDocument();
		});
	});
});
