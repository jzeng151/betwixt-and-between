import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Window from '$lib/os/Window.svelte';
import { windowStore } from '$lib/os/windows-store.js';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('Window keyboard resizing', () => {
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
		expect(resize).toHaveBeenNthCalledWith(2, 'window-1', 300, 248);
	});
});
