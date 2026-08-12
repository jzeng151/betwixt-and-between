import { cleanup, render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RegionFormModal from '$lib/features/map/RegionFormModal.svelte';

beforeEach(cleanup);

function props() {
	return {
		isEditing: false,
		regionFormLocations: [],
		acts: [],
		scenesByAct: new Map(),
		locationId: null,
		color: '#c8942a',
		sceneIds: new Set<string>(),
		creatingLocation: true,
		newLocationName: '',
		newLocationError: '',
		newLocationBusy: false,
		onSave: vi.fn(),
		onCancel: vi.fn(),
		onStartCreateLocation: vi.fn(),
		onCancelCreateLocation: vi.fn(),
		onCommitCreateLocation: vi.fn(),
		onToggleScene: vi.fn()
	};
}

describe('RegionFormModal accessibility', () => {
	it('keeps inline Escape inside the location flow', async () => {
		const handlers = props();
		const { getByRole } = render(RegionFormModal, { props: handlers });

		const input = getByRole('textbox', { name: 'Name of new location' });
		input.focus();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

		expect(handlers.onCancelCreateLocation).toHaveBeenCalledOnce();
		expect(handlers.onCancel).not.toHaveBeenCalled();
	});

	it('uses unique labels for concurrent dialogs', () => {
		render(RegionFormModal, { props: props() });
		render(RegionFormModal, { props: props() });

		const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
		expect(dialogs).toHaveLength(2);
		expect(dialogs[0].getAttribute('aria-labelledby')).not.toBe(
			dialogs[1].getAttribute('aria-labelledby')
		);
	});
});
