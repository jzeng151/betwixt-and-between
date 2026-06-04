// Slice 4 PR-C — StyleEditor. The reusable editor for a data.style override.
// Pins: inherited values shown as placeholders, client-side hex validation,
// swatch/slider → onChange, bound clamping, and field-clear (↺ removes a key so
// it inherits again). The server validator (style-validation.ts) is the source
// of truth; these tests cover the client mirror's observable contract.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import StyleEditor from '$lib/components/StyleEditor.svelte';
import type { ResolvedStyle } from '$lib/features/map/style-cascade.js';
import { ENTITY_TYPE_HEX } from '$lib/entity-type-colors.js';

const INHERITED: ResolvedStyle = { color: '#123456', icon: null, scale: 1, opacity: 1 };

beforeEach(() => cleanup());

describe('StyleEditor — inherited placeholders', () => {
	it('shows the inherited color as the hex placeholder when unset', () => {
		const { container } = render(StyleEditor, {
			props: { value: {}, inherited: INHERITED, onChange: vi.fn() }
		});
		const hex = container.querySelector('#se-color') as HTMLInputElement;
		expect(hex.value).toBe('');
		expect(hex.placeholder).toBe('#123456');
	});

	it('marks scale/opacity as inherited when no override is set', () => {
		const { container } = render(StyleEditor, {
			props: { value: {}, inherited: INHERITED, onChange: vi.fn() }
		});
		// The .val.inherited class flags an unset (inherited) numeric field.
		expect(container.querySelectorAll('.val.inherited').length).toBe(2);
	});
});

describe('StyleEditor — hex validation', () => {
	it('rejects an invalid hex on blur and does not emit a color', async () => {
		const onChange = vi.fn();
		const { container, getByRole } = render(StyleEditor, {
			props: { value: {}, inherited: INHERITED, onChange }
		});
		const hex = container.querySelector('#se-color') as HTMLInputElement;
		await fireEvent.input(hex, { target: { value: 'nope' } });
		await fireEvent.blur(hex);
		expect(getByRole('alert').textContent).toMatch(/hex color/i);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('accepts a valid hex on blur and emits { color }', async () => {
		const onChange = vi.fn();
		const { container } = render(StyleEditor, {
			props: { value: {}, inherited: INHERITED, onChange }
		});
		const hex = container.querySelector('#se-color') as HTMLInputElement;
		await fireEvent.input(hex, { target: { value: '#abcdef' } });
		await fireEvent.blur(hex);
		expect(onChange).toHaveBeenCalledWith({ color: '#abcdef' });
	});

	it('rejects an alpha hex (4-/8-digit) and points at the opacity slider', async () => {
		// HEX_COLOR_RE accepts 4-/8-digit alpha hex (region fills use it), but the
		// marker renderer (PixiPlacementLayer.parseHex) strips alpha, so the editor
		// rejects it here rather than silently rendering an opaque marker (Codex P2).
		const onChange = vi.fn();
		const { container, getByRole } = render(StyleEditor, {
			props: { value: {}, inherited: INHERITED, onChange }
		});
		const hex = container.querySelector('#se-color') as HTMLInputElement;
		await fireEvent.input(hex, { target: { value: '#ff000080' } });
		await fireEvent.blur(hex);
		expect(getByRole('alert').textContent).toMatch(/opacity/i);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('empty hex on blur clears the override (inherits)', async () => {
		const onChange = vi.fn();
		const { container } = render(StyleEditor, {
			props: { value: { color: '#abcdef' }, inherited: INHERITED, onChange }
		});
		const hex = container.querySelector('#se-color') as HTMLInputElement;
		await fireEvent.input(hex, { target: { value: '' } });
		await fireEvent.blur(hex);
		expect(onChange).toHaveBeenCalledWith({});
	});
});

describe('StyleEditor — icon (commits on blur)', () => {
	it('emits { icon } on blur, not per keystroke', async () => {
		const onChange = vi.fn();
		const { container } = render(StyleEditor, {
			props: { value: {}, inherited: INHERITED, onChange }
		});
		const icon = container.querySelector('#se-icon') as HTMLInputElement;
		await fireEvent.input(icon, { target: { value: 'https://x/i.png' } });
		expect(onChange).not.toHaveBeenCalled(); // not committed mid-typing
		await fireEvent.blur(icon);
		expect(onChange).toHaveBeenCalledWith({ icon: 'https://x/i.png' });
	});

	it('empty icon on blur clears the override', async () => {
		const onChange = vi.fn();
		const { container } = render(StyleEditor, {
			props: { value: { icon: 'https://x/i.png' }, inherited: INHERITED, onChange }
		});
		const icon = container.querySelector('#se-icon') as HTMLInputElement;
		await fireEvent.input(icon, { target: { value: '' } });
		await fireEvent.blur(icon);
		expect(onChange).toHaveBeenCalledWith({});
	});
});

describe('StyleEditor — swatches & sliders', () => {
	it('clicking a swatch emits that color', async () => {
		const onChange = vi.fn();
		const { container } = render(StyleEditor, {
			props: { value: {}, inherited: INHERITED, onChange }
		});
		// First preset swatch = ENTITY_TYPE_HEX.Character (Phase 2, Item 1 / CQ1:
		// the presets now source the palette instead of the old hardcoded blue).
		const swatch = container.querySelector('.swatch') as HTMLButtonElement;
		await fireEvent.click(swatch);
		expect(onChange).toHaveBeenCalledWith({ color: ENTITY_TYPE_HEX.Character });
	});

	it('scale slider emits the dragged value', async () => {
		const onChange = vi.fn();
		const { container } = render(StyleEditor, {
			props: { value: {}, inherited: INHERITED, onChange }
		});
		const scale = container.querySelector('#se-scale') as HTMLInputElement;
		await fireEvent.input(scale, { target: { value: '3' } });
		expect(onChange).toHaveBeenCalledWith({ scale: 3 });
	});

	it('a field clear (↺) removes that key from the override', async () => {
		const onChange = vi.fn();
		const { container } = render(StyleEditor, {
			props: { value: { scale: 2, color: '#abcdef' }, inherited: INHERITED, onChange }
		});
		// The scale field's clear button is the ↺ inside the scale field-row.
		const clears = Array.from(container.querySelectorAll('button.clear')) as HTMLButtonElement[];
		// color clear + scale clear both present; click the last (scale).
		await fireEvent.click(clears[clears.length - 1]);
		expect(onChange).toHaveBeenCalledWith({ color: '#abcdef' });
	});
});
