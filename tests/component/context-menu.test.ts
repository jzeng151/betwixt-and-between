import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import ContextMenu from '$lib/components/ContextMenu.svelte';

beforeEach(() => {
	cleanup();
});

function makeItems(spec: Array<{ label: string; disabled?: boolean }>) {
	return spec.map((s) => ({
		label: s.label,
		disabled: s.disabled,
		onSelect: vi.fn()
	}));
}

describe('ContextMenu', () => {
	it('renders all items with correct labels', () => {
		const items = makeItems([{ label: 'One' }, { label: 'Two' }, { label: 'Three' }]);
		const { getByText } = render(ContextMenu, {
			props: { items, x: 0, y: 0, onClose: vi.fn() }
		});
		expect(getByText('One')).toBeInTheDocument();
		expect(getByText('Two')).toBeInTheDocument();
		expect(getByText('Three')).toBeInTheDocument();
	});

	it('selecting an item also fires onClose (Greptile P1)', async () => {
		const onClose = vi.fn();
		const items = makeItems([{ label: 'A' }]);
		const { getByText } = render(ContextMenu, {
			props: { items, x: 0, y: 0, onClose }
		});
		await fireEvent.click(getByText('A'));
		expect(items[0].onSelect).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('clicking an enabled item fires its onSelect', async () => {
		const items = makeItems([{ label: 'Pick me' }, { label: 'Other' }]);
		const { getByText } = render(ContextMenu, {
			props: { items, x: 0, y: 0, onClose: vi.fn() }
		});
		await fireEvent.click(getByText('Pick me'));
		expect(items[0].onSelect).toHaveBeenCalledTimes(1);
		expect(items[1].onSelect).not.toHaveBeenCalled();
	});

	it('clicking a disabled item does not fire its onSelect', async () => {
		const items = makeItems([{ label: 'Disabled', disabled: true }, { label: 'Enabled' }]);
		const { getByText } = render(ContextMenu, {
			props: { items, x: 0, y: 0, onClose: vi.fn() }
		});
		await fireEvent.click(getByText('Disabled'));
		expect(items[0].onSelect).not.toHaveBeenCalled();
	});

	it('Escape key fires onClose without selecting', async () => {
		const onClose = vi.fn();
		const items = makeItems([{ label: 'A' }, { label: 'B' }]);
		const { getByRole } = render(ContextMenu, {
			props: { items, x: 0, y: 0, onClose }
		});
		await fireEvent.keyDown(getByRole('menu'), { key: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(items[0].onSelect).not.toHaveBeenCalled();
		expect(items[1].onSelect).not.toHaveBeenCalled();
	});

	it('ArrowDown moves focus to next enabled item; wraps from last to first', async () => {
		const items = makeItems([{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
		const { getByRole, getByText } = render(ContextMenu, {
			props: { items, x: 0, y: 0, onClose: vi.fn() }
		});
		await tick();
		const menu = getByRole('menu');
		// First non-disabled item (A) is auto-focused on mount.
		expect(document.activeElement).toBe(getByText('A').closest('button'));
		await fireEvent.keyDown(menu, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(getByText('B').closest('button'));
		await fireEvent.keyDown(menu, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(getByText('C').closest('button'));
		// Wrap from last back to first
		await fireEvent.keyDown(menu, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(getByText('A').closest('button'));
	});

	it('ArrowUp wraps from first to last', async () => {
		const items = makeItems([{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
		const { getByRole, getByText } = render(ContextMenu, {
			props: { items, x: 0, y: 0, onClose: vi.fn() }
		});
		await tick();
		const menu = getByRole('menu');
		expect(document.activeElement).toBe(getByText('A').closest('button'));
		await fireEvent.keyDown(menu, { key: 'ArrowUp' });
		expect(document.activeElement).toBe(getByText('C').closest('button'));
	});

	it('ArrowDown skips disabled items', async () => {
		const items = makeItems([
			{ label: 'A' },
			{ label: 'B', disabled: true },
			{ label: 'C' }
		]);
		const { getByRole, getByText } = render(ContextMenu, {
			props: { items, x: 0, y: 0, onClose: vi.fn() }
		});
		await tick();
		const menu = getByRole('menu');
		expect(document.activeElement).toBe(getByText('A').closest('button'));
		await fireEvent.keyDown(menu, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(getByText('C').closest('button'));
	});

	it('Enter on focused item fires that item onSelect', async () => {
		const items = makeItems([{ label: 'A' }, { label: 'B' }]);
		const { getByRole } = render(ContextMenu, {
			props: { items, x: 0, y: 0, onClose: vi.fn() }
		});
		await tick();
		const menu = getByRole('menu');
		// Focus starts on A; ArrowDown to B, then Enter.
		await fireEvent.keyDown(menu, { key: 'ArrowDown' });
		await fireEvent.keyDown(menu, { key: 'Enter' });
		expect(items[1].onSelect).toHaveBeenCalledTimes(1);
		expect(items[0].onSelect).not.toHaveBeenCalled();
	});

	it('click outside the menu fires onClose', async () => {
		const onClose = vi.fn();
		const items = makeItems([{ label: 'A' }]);
		render(ContextMenu, { props: { items, x: 0, y: 0, onClose } });
		// The click-outside listener registers inside a $effect, which
		// fires after the initial render microtask. Wait for tick() so the
		// listener is wired up — without this the test passes only by luck.
		await tick();
		// pointerdown on document.body (outside the menu)
		await fireEvent.pointerDown(document.body);
		expect(onClose).toHaveBeenCalled();
	});
});
