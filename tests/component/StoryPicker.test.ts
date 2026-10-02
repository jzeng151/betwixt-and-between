import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { writable, type Writable } from 'svelte/store';
import { afterEach, expect, it, vi } from 'vitest';
import type { Entity } from '$lib/stores/entities.js';

vi.mock('$lib/stores/entities.js', () => ({
	entities: writable([]),
	entitySnapshotReady: writable(true),
	entityLoadStatus: writable('ready')
}));
vi.mock('$lib/features/map/store.js', () => ({ worldMaps: writable([]) }));

import { entities } from '$lib/stores/entities.js';
import { worldMaps } from '$lib/features/map/store.js';
import StoryPicker from '$lib/features/whiteboard/StoryPicker.svelte';

afterEach(cleanup);

it('drops deleted sources from the selection while retaining choices hidden by filters', async () => {
	const storyEntities = entities as unknown as Writable<Pick<Entity, 'id' | 'name' | 'type' | 'data'>[]>;
	const maps = worldMaps as Writable<{ id: string; name: string }[]>;
	const survivor = { id: 'quay', name: 'Quay', type: 'Location' as const, data: {} };
	storyEntities.set([{ id: 'mara', name: 'Mara', type: 'Character', data: {} }, survivor]);
	maps.set([{ id: 'harbor', name: 'Harbor' }]);
	const onAdd = vi.fn(() => true), onClose = vi.fn();
	const view = render(StoryPicker, { onAdd, onClose });
	await fireEvent.click(view.getByRole('checkbox', { name: /^Mara\s*Character$/ }));
	await fireEvent.click(view.getByRole('checkbox', { name: /^Quay\s*Location$/ }));
	await fireEvent.click(view.getByRole('checkbox', { name: /^Harbor\s*Map$/ }));

	await fireEvent.change(view.getByLabelText('Story item type'), { target: { value: 'graph' } });
	expect(view.getByText('3 selected')).toBeInTheDocument();
	await fireEvent.click(view.getByRole('checkbox', { name: /^Mara\s*Focused graph · Character$/ }));
	await fireEvent.input(view.getByLabelText('Find story items'), { target: { value: 'no match' } });
	expect(view.queryAllByRole('checkbox')).toHaveLength(0);
	expect(view.getByText('4 selected')).toBeInTheDocument();

	storyEntities.set([survivor]);
	maps.set([]);
	await tick();
	expect(view.getByText('1 selected')).toBeInTheDocument();
	await fireEvent.change(view.getByLabelText('Story item type'), { target: { value: 'all' } });
	await fireEvent.input(view.getByLabelText('Find story items'), { target: { value: '' } });
	expect(view.getByRole('checkbox', { name: /^Quay\s*Location$/ })).toBeChecked();
	await fireEvent.click(view.getByRole('button', { name: 'Add 1 item' }));
	expect(onAdd).toHaveBeenCalledExactlyOnceWith([{ kind: 'entity', id: 'quay' }]);
	expect(onClose).toHaveBeenCalledOnce();
});
