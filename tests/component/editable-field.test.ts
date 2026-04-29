import { describe, it, expect, beforeEach, vi } from 'vitest';
import { writable, get } from 'svelte/store';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import type { Entity } from '../../src/lib/stores/entities.js';

// Tests for the EditableField atom locked by D13 / Issue 10A.
// Component lives at src/lib/components/EditableField.svelte (not yet shipped).
//
// Strategy: replace the entities store module with a fake store that exposes a
// vi.fn() updateEntity so we can assert on call shape. The atom reads current
// value via $entities.find(id).data[field] and commits via updateEntity.
//
// This file is RED until the component lands. The tests intentionally pin the
// contract from D13/D14/D15:
//   - textarea/single-line: commit on blur (single-line also commits on Enter)
//   - picklist/swatches: commit on change
//   - multi-entity-picker: writes to relationships table; add+remove via PATCH
//   - Esc cancels — no autosave
//   - Optimistic update applies via updateEntity; rollback handled inside store
//   - On error: inline Retry button visible; click re-fires PATCH

const { updateEntityMock, createRelationshipMock, deleteRelationshipMock } = vi.hoisted(() => {
	return {
		updateEntityMock: vi.fn(),
		createRelationshipMock: vi.fn(),
		deleteRelationshipMock: vi.fn()
	};
});

vi.mock('../../src/lib/stores/entities.js', async () => {
	const { writable } = await import('svelte/store');
	const store = writable([] as Entity[]);
	return {
		entities: {
			subscribe: store.subscribe,
			set: store.set,
			update: store.update,
			updateEntity: updateEntityMock
		}
	};
});

vi.mock('../../src/lib/stores/relationships.js', async () => {
	const { writable } = await import('svelte/store');
	const store = writable([] as Array<{ id: string; fromId: string; toId: string; type: string }>);
	return {
		relationships: {
			subscribe: store.subscribe,
			set: store.set,
			update: store.update,
			// EditableField calls these with positional args (fromId, toId, type, label?)
			// per the relationships store contract.
			createRelationship: createRelationshipMock,
			deleteRelationship: deleteRelationshipMock
		}
	};
});

// Backward-compat aliases used by the tests below (originally written against
// "addRelationship"/"removeRelationship" mocks; the actual store names are
// create/delete per relationships.ts).
const addRelationshipMock = createRelationshipMock;
const removeRelationshipMock = deleteRelationshipMock;

import { entities } from '../../src/lib/stores/entities.js';
import EditableField from '../../src/lib/components/EditableField.svelte';

const entitiesWritable = entities as unknown as ReturnType<typeof writable<Entity[]>>;

function seedEntity(partial: Partial<Entity> & { id: string; name: string; data: string }) {
	const e: Entity = {
		type: 'Act',
		parentId: null,
		position: 0,
		createdAt: 0,
		updatedAt: 0,
		...partial
	} as Entity;
	entitiesWritable.set([e]);
}

beforeEach(() => {
	updateEntityMock.mockReset();
	updateEntityMock.mockResolvedValue({});
	addRelationshipMock.mockReset();
	addRelationshipMock.mockResolvedValue({});
	removeRelationshipMock.mockReset();
	removeRelationshipMock.mockResolvedValue({});
	entitiesWritable.set([]);
});

// ---------------------------------------------------------------------------
// kind = 'textarea'
// ---------------------------------------------------------------------------

describe('EditableField — kind=textarea', () => {
	it('reads initial value from $entities.find(id).data[field]', () => {
		seedEntity({ id: 'act-1', name: 'A', data: JSON.stringify({ synopsis: 'opening' }) });
		const { container } = render(EditableField, {
			props: {
				entityId: 'act-1',
				field: 'synopsis',
				label: 'Synopsis',
				kind: 'textarea'
			}
		});
		const ta = container.querySelector('textarea.field-textarea') as HTMLTextAreaElement;
		expect(ta).toBeTruthy();
		expect(ta.value).toBe('opening');
	});

	it('blur commits the draft via entities.updateEntity with merged data', async () => {
		seedEntity({ id: 'act-1', name: 'A', data: JSON.stringify({ synopsis: 'old', goal: 'g1' }) });
		const { container } = render(EditableField, {
			props: { entityId: 'act-1', field: 'synopsis', label: 'Synopsis', kind: 'textarea' }
		});
		const ta = container.querySelector('textarea.field-textarea') as HTMLTextAreaElement;
		await fireEvent.input(ta, { target: { value: 'new synopsis' } });
		await fireEvent.blur(ta);

		await waitFor(() => expect(updateEntityMock).toHaveBeenCalled());
		const [id, patch] = updateEntityMock.mock.calls[0];
		expect(id).toBe('act-1');
		expect(patch.data.synopsis).toBe('new synopsis');
		// Existing fields preserved (merged, not overwritten)
		expect(patch.data.goal).toBe('g1');
	});

	it('Esc reverts the draft and does NOT commit', async () => {
		seedEntity({ id: 'act-1', name: 'A', data: JSON.stringify({ synopsis: 'old' }) });
		const { container } = render(EditableField, {
			props: { entityId: 'act-1', field: 'synopsis', label: 'Synopsis', kind: 'textarea' }
		});
		const ta = container.querySelector('textarea.field-textarea') as HTMLTextAreaElement;
		await fireEvent.input(ta, { target: { value: 'discarded draft' } });
		await fireEvent.keyDown(ta, { key: 'Escape' });

		expect(updateEntityMock).not.toHaveBeenCalled();
	});

	it('shows Retry button on PATCH failure and re-fires the PATCH with the same value', async () => {
		seedEntity({ id: 'act-1', name: 'A', data: JSON.stringify({ synopsis: '' }) });
		updateEntityMock
			.mockRejectedValueOnce(new Error('server'))
			.mockResolvedValueOnce({});

		const { container, getByRole } = render(EditableField, {
			props: { entityId: 'act-1', field: 'synopsis', label: 'Synopsis', kind: 'textarea' }
		});
		const ta = container.querySelector('textarea.field-textarea') as HTMLTextAreaElement;
		await fireEvent.input(ta, { target: { value: 'attempt-1' } });
		await fireEvent.blur(ta);

		const retry = await waitFor(() => getByRole('button', { name: /retry/i }));
		expect(retry).toBeTruthy();
		await fireEvent.click(retry);

		await waitFor(() => expect(updateEntityMock).toHaveBeenCalledTimes(2));
		expect(updateEntityMock.mock.calls[1][1].data.synopsis).toBe('attempt-1');
	});
});

// ---------------------------------------------------------------------------
// kind = 'single-line'
// ---------------------------------------------------------------------------

describe('EditableField — kind=single-line', () => {
	it('blur commits', async () => {
		seedEntity({ id: 'sc-1', name: 'S', data: JSON.stringify({ goal: '' }) });
		const { container } = render(EditableField, {
			props: { entityId: 'sc-1', field: 'goal', label: 'Goal', kind: 'single-line' }
		});
		const input = container.querySelector('input.field-input') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'find the egg' } });
		await fireEvent.blur(input);
		await waitFor(() => expect(updateEntityMock).toHaveBeenCalled());
		expect(updateEntityMock.mock.calls[0][1].data.goal).toBe('find the egg');
	});

	it('Enter commits without needing blur', async () => {
		seedEntity({ id: 'sc-1', name: 'S', data: JSON.stringify({ goal: '' }) });
		const { container } = render(EditableField, {
			props: { entityId: 'sc-1', field: 'goal', label: 'Goal', kind: 'single-line' }
		});
		const input = container.querySelector('input.field-input') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'climb the wall' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await waitFor(() => expect(updateEntityMock).toHaveBeenCalled());
		expect(updateEntityMock.mock.calls[0][1].data.goal).toBe('climb the wall');
	});

	it('Esc cancels', async () => {
		seedEntity({ id: 'sc-1', name: 'S', data: JSON.stringify({ goal: 'old' }) });
		const { container } = render(EditableField, {
			props: { entityId: 'sc-1', field: 'goal', label: 'Goal', kind: 'single-line' }
		});
		const input = container.querySelector('input.field-input') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'never-saved' } });
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(updateEntityMock).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// kind = 'picklist' (commit-on-change per D13/P2-5)
// ---------------------------------------------------------------------------

describe('EditableField — kind=picklist', () => {
	it('commits immediately on change (no blur required)', async () => {
		seedEntity({ id: 'ev-1', name: 'E', type: 'Event', data: JSON.stringify({ outcome: 'no' }) });
		const { container } = render(EditableField, {
			props: {
				entityId: 'ev-1',
				field: 'outcome',
				label: 'Outcome',
				kind: 'picklist',
				picklistOptions: [
					{ value: 'yes', label: 'Yes' },
					{ value: 'yes-but', label: 'Yes-but' },
					{ value: 'no', label: 'No' },
					{ value: 'no-and', label: 'No-and' },
					{ value: 'mixed', label: 'Mixed' }
				]
			}
		});
		const select = container.querySelector('select') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'yes-but' } });
		await waitFor(() => expect(updateEntityMock).toHaveBeenCalled());
		expect(updateEntityMock.mock.calls[0][1].data.outcome).toBe('yes-but');
	});
});

// ---------------------------------------------------------------------------
// kind = 'swatches' (commit-on-change per D13/P2-5)
// ---------------------------------------------------------------------------

describe('EditableField — kind=swatches', () => {
	it('commits when a swatch is clicked', async () => {
		seedEntity({ id: 'act-1', name: 'A', data: JSON.stringify({ color: 'amber' }) });
		const { container } = render(EditableField, {
			props: {
				entityId: 'act-1',
				field: 'color',
				label: 'Color',
				kind: 'swatches',
				swatchOptions: [
					{ value: 'amber', label: 'Amber' },
					{ value: 'teal', label: 'Teal' },
					{ value: 'indigo', label: 'Indigo' }
				]
			}
		});
		const tealSwatch = container.querySelector(
			'[data-swatch-value="teal"]'
		) as HTMLElement;
		expect(tealSwatch).toBeTruthy();
		await fireEvent.click(tealSwatch);
		await waitFor(() => expect(updateEntityMock).toHaveBeenCalled());
		expect(updateEntityMock.mock.calls[0][1].data.color).toBe('teal');
	});
});

// ---------------------------------------------------------------------------
// kind = 'multi-entity-picker' (D4/4C — writes to relationships table)
// ---------------------------------------------------------------------------

describe('EditableField — kind=multi-entity-picker', () => {
	it('adding a character fires a single relationship insert (no entities.updateEntity call)', async () => {
		seedEntity({ id: 'ev-1', name: 'E', type: 'Event', data: JSON.stringify({}) });
		// Two candidate Characters available for the picker
		entitiesWritable.update((all) => [
			...all,
			{
				id: 'char-1',
				type: 'Character',
				name: 'Ellie',
				data: '{}',
				parentId: null,
				position: null,
				createdAt: 0,
				updatedAt: 0
			} as Entity,
			{
				id: 'char-2',
				type: 'Character',
				name: 'Damien',
				data: '{}',
				parentId: null,
				position: null,
				createdAt: 0,
				updatedAt: 0
			} as Entity
		]);
		const { container } = render(EditableField, {
			props: {
				entityId: 'ev-1',
				field: 'pov',
				label: 'POV',
				kind: 'multi-entity-picker',
				relationshipType: 'pov_of',
				targetEntityType: 'Character'
			}
		});
		// Click the chip-add affordance and pick Ellie. Selectors are guesses
		// (data-character-id) — see report at the end.
		const addChip = container.querySelector('[data-pick-id="char-1"]') as HTMLElement;
		expect(addChip).toBeTruthy();
		await fireEvent.click(addChip);

		await waitFor(() => expect(addRelationshipMock).toHaveBeenCalled());
		// relationships store uses positional args (fromId, toId, type, label?)
		const args = addRelationshipMock.mock.calls[0];
		expect(args[0]).toBe('ev-1'); // fromId
		expect(args[1]).toBe('char-1'); // toId
		expect(args[2]).toBe('pov_of'); // type
		expect(updateEntityMock).not.toHaveBeenCalled();
	});

	it('removing a chip fires a single relationship delete', async () => {
		seedEntity({ id: 'ev-1', name: 'E', type: 'Event', data: JSON.stringify({}) });
		entitiesWritable.update((all) => [
			...all,
			{
				id: 'char-1',
				type: 'Character',
				name: 'Ellie',
				data: '{}',
				parentId: null,
				position: null,
				createdAt: 0,
				updatedAt: 0
			} as Entity
		]);
		// Seed the mocked relationships store so EditableField can find the row id
		// to delete. Production reads relationships from the store; the
		// currentIds prop is a render-only override for the chip list.
		const { relationships } = await import('../../src/lib/stores/relationships.js');
		(relationships as unknown as { update: (fn: (rs: unknown[]) => unknown[]) => void }).update(
			() => [{ id: 'rel-1', fromId: 'ev-1', toId: 'char-1', type: 'pov_of' }]
		);

		const { container } = render(EditableField, {
			props: {
				entityId: 'ev-1',
				field: 'pov',
				label: 'POV',
				kind: 'multi-entity-picker',
				relationshipType: 'pov_of',
				targetEntityType: 'Character',
				currentIds: ['char-1']
			}
		});
		const removeChip = container.querySelector(
			'[data-remove-id="char-1"]'
		) as HTMLElement;
		expect(removeChip).toBeTruthy();
		await fireEvent.click(removeChip);

		await waitFor(() => expect(removeRelationshipMock).toHaveBeenCalled());
	});
});

// ---------------------------------------------------------------------------
// Optimistic store update / rollback (D15)
// ---------------------------------------------------------------------------

describe('EditableField — optimistic update + rollback (D15)', () => {
	it('passes the merged data to entities.updateEntity (which handles the optimistic write)', async () => {
		seedEntity({ id: 'act-1', name: 'A', data: JSON.stringify({ synopsis: 'before', goal: 'g' }) });
		const { container } = render(EditableField, {
			props: { entityId: 'act-1', field: 'synopsis', label: 'Synopsis', kind: 'textarea' }
		});
		const ta = container.querySelector('textarea.field-textarea') as HTMLTextAreaElement;
		await fireEvent.input(ta, { target: { value: 'after' } });
		await fireEvent.blur(ta);
		await waitFor(() => expect(updateEntityMock).toHaveBeenCalled());
		// EditableField forwards the patch unchanged; the store layer is
		// responsible for the optimistic write + load() rollback. We just
		// assert the contract surface is right.
		expect(updateEntityMock.mock.calls[0][1].data).toEqual({
			synopsis: 'after',
			goal: 'g'
		});
	});
});
