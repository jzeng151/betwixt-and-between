import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setNextFocusTrapReturn } from '$lib/actions/focus-trap.js';
import EntityColorPopover from '$lib/components/EntityColorPopover.svelte';
import type { Entity } from '$lib/stores/entities.js';

afterEach(cleanup);

describe('EntityColorPopover focus', () => {
	it('takes focus from its menu opener and restores it on Escape', async () => {
		const opener = document.body.appendChild(document.createElement('button'));
		opener.focus();
		setNextFocusTrapReturn(opener);
		const onClose = vi.fn();
		const view = render(EntityColorPopover, {
			props: {
				entity: { id: 'entity-1', type: 'Character', name: 'Mara', data: {} } as Entity,
				x: 0,
				y: 0,
				onClose
			}
		});
		await Promise.resolve();

		expect(view.getAllByRole('button', { name: /^#/ })[0]).toHaveFocus();
		await fireEvent.keyDown(view.getByRole('dialog'), { key: 'Escape' });
		await Promise.resolve();

		expect(onClose).toHaveBeenCalledOnce();
		expect(opener).toHaveFocus();
		opener.remove();
	});
});
