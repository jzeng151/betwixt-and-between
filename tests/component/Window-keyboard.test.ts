import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Window from '$lib/os/Window.svelte';
import { windowStore } from '$lib/os/windows-store.js';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	document.documentElement.style.removeProperty('--taskbar-height');
});

describe('Window keyboard resizing', () => {
	it('leaves geometry shortcuts with extra modifiers to the browser', () => {
		const focus = vi.spyOn(windowStore, 'focus').mockImplementation(() => {});
		const view = render(Window, {
			props: {
				id: 'window-1', title: 'Test', x: 0, y: 0, width: 300, height: 248,
				zIndex: 1, minimized: false, maximized: false
			}
		});
		const titlebar = view.getByRole('toolbar');
		for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
			const event = new KeyboardEvent('keydown', {
				key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true, ...modifier
			});
			titlebar.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
		}
		expect(focus).not.toHaveBeenCalled();
	});

	it('caps growth at the usable viewport edge', async () => {
		Object.defineProperties(window, {
			innerWidth: { value: 800, configurable: true },
			innerHeight: { value: 600, configurable: true }
		});
		const resize = vi.spyOn(windowStore, 'resize').mockImplementation(() => {});
		const view = render(Window, {
			props: {
				id: 'window-1', title: 'Test', x: 500, y: 300, width: 300, height: 248,
				zIndex: 1, minimized: false, maximized: false
			}
		});
		const titlebar = view.getByRole('toolbar');

		await fireEvent.keyDown(titlebar, { key: 'ArrowRight', altKey: true, shiftKey: true });
		await fireEvent.keyDown(titlebar, { key: 'ArrowDown', altKey: true, shiftKey: true });

		expect(resize).toHaveBeenNthCalledWith(1, 'window-1', 300, 248);
		expect(resize).toHaveBeenNthCalledWith(2, 'window-1', 300, 256);
	});

	it.each([
		// A window with 8px of room can grow by 8, not the full 16px step.
		{ initialHeight: 212, displayedTop: 300, resizedHeight: 220 },
		// An overlapping saved window moves up on display; growing at the edge must not shrink it.
		{ initialHeight: 248, displayedTop: 272, resizedHeight: 248 }
	])('respects the taskbar when growing a $initialHeight px window', async ({ initialHeight, displayedTop, resizedHeight }) => {
		Object.defineProperties(window, {
			innerWidth: { value: 800, configurable: true },
			innerHeight: { value: 600, configurable: true }
		});
		document.documentElement.style.setProperty('--taskbar-height', '80px');
		const resize = vi.spyOn(windowStore, 'resize').mockImplementation(() => {});
		const view = render(Window, {
			props: {
				id: 'window-1', title: 'Test', x: 500, y: 300, width: 300, height: initialHeight,
				zIndex: 1, minimized: false, maximized: false
			}
		});

		await fireEvent.keyDown(view.getByRole('toolbar'), {
			key: 'ArrowDown', altKey: true, shiftKey: true
		});

		expect(view.getByRole('dialog').style.top).toBe(`${displayedTop}px`);
		expect(resize).toHaveBeenCalledWith('window-1', 300, resizedHeight);
	});
});
