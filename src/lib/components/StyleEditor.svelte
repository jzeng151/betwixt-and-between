<script lang="ts">
	/**
	 * StyleEditor — Slice 4 PR-C. Reusable editor for a `data.style` override
	 * (the closed-enum { color?, icon?, scale?, opacity? } shape). Used at two
	 * layers of the cascade:
	 *   - entity level  → writes entity.data.style   (sidebar STYLE section)
	 *   - placement level → writes placement.data.style (marker popover)
	 *
	 * Model: `value` is the EXPLICIT override (only keys the user has set).
	 * `inherited` is what the cascade resolves to WITHOUT this layer — shown as
	 * the placeholder / slider baseline so a cleared field visibly falls back to
	 * the inherited value. Clearing a field (empty text, or the ↺ button) removes
	 * the key from the override so it inherits again.
	 *
	 * Bounds mirror the server validator via the shared STYLE_BOUNDS; the server
	 * (style-validation.ts) remains the source of truth and rejects bad writes.
	 */
	import { STYLE_BOUNDS, HEX_COLOR_RE } from '$lib/style-bounds.js';
	import type { ResolvedStyle, StyleOverride } from '$lib/features/map/style-cascade.js';
	import { ENTITY_TYPE_HEX } from '$lib/entity-type-colors.js';

	interface Props {
		value: StyleOverride;
		inherited: ResolvedStyle;
		onChange: (next: StyleOverride) => void;
	}
	let { value, inherited, onChange }: Props = $props();

	// Preset swatches: the placeable-type palette hexes plus neutral, so a
	// one-click set is always on-palette. Sourced from ENTITY_TYPE_HEX (the single
	// palette source — Phase 2, Item 1 / CQ1) instead of the former hardcoded
	// blue/amber/green, which no longer matched the palette. Active swatch
	// (=== value.color) is ringed amber.
	const SWATCHES = [
		ENTITY_TYPE_HEX.Character,
		ENTITY_TYPE_HEX.Artifact,
		ENTITY_TYPE_HEX.Item,
		ENTITY_TYPE_HEX.Event,
		ENTITY_TYPE_HEX.Scene,
		'#9ca3af'
	];

	// Seed from the initial prop; the $effect below resyncs on external changes.
	// svelte-ignore state_referenced_locally
	let hexDraft = $state(value.color ?? '');
	let hexError = $state('');
	// svelte-ignore state_referenced_locally
	let iconDraft = $state(value.icon ?? '');
	// Resync drafts when the bound value changes from outside (a swatch click or
	// switching which placement/entity is being edited). Both color and icon
	// commit on blur/Enter, not per-keystroke.
	$effect(() => {
		hexDraft = value.color ?? '';
		hexError = '';
	});
	$effect(() => {
		iconDraft = value.icon ?? '';
	});

	function emit(next: StyleOverride) {
		onChange(next);
	}

	// Set or clear a single key, dropping undefined keys so the override only
	// carries what the user explicitly set.
	function setKey<K extends keyof StyleOverride>(key: K, v: StyleOverride[K] | undefined) {
		const next: StyleOverride = { ...value };
		if (v === undefined) delete next[key];
		else next[key] = v;
		emit(next);
	}

	// The marker renderer (PixiPlacementLayer.parseHex) draws only opaque RGB:
	// it ignores any alpha channel and reads transparency from the separate
	// opacity control. So accept only 3-/6-digit hex here even though the shared
	// HEX_COLOR_RE also allows 4-/8-digit alpha for other call sites (region
	// fills) — otherwise a saved marker would render opaque and mismatch this
	// preview (Codex P2).
	const MARKER_HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

	function commitHex() {
		const v = hexDraft.trim();
		if (v === '') {
			hexError = '';
			setKey('color', undefined);
			return;
		}
		if (!HEX_COLOR_RE.test(v)) {
			hexError = 'Enter a hex color like #aabbcc';
			return;
		}
		if (!MARKER_HEX_RE.test(v)) {
			hexError = 'Marker colors are opaque — set transparency with the opacity slider';
			return;
		}
		hexError = '';
		setKey('color', v);
	}

	function pickSwatch(c: string) {
		hexError = '';
		hexDraft = c;
		setKey('color', c);
	}

	function commitIcon() {
		const v = iconDraft.trim();
		setKey('icon', v === '' ? undefined : v);
	}

	function clampScale(n: number) {
		return Math.max(STYLE_BOUNDS.scale.min, Math.min(STYLE_BOUNDS.scale.max, n));
	}
	function clampOpacity(n: number) {
		return Math.max(STYLE_BOUNDS.opacity.min, Math.min(STYLE_BOUNDS.opacity.max, n));
	}

	// Effective display values (override falls back to inherited).
	let effColor = $derived(value.color ?? inherited.color);
	let effIcon = $derived(value.icon ?? inherited.icon);
	let effScale = $derived(value.scale ?? inherited.scale);
	let effOpacity = $derived(value.opacity ?? inherited.opacity);
</script>

<div class="style-editor">
	<!-- Color -->
	<div class="field">
		<label class="field-label" for="se-color">Color</label>
		<div class="field-row">
			<span class="color-preview" style="background: {effColor}" aria-hidden="true"></span>
			<input
				id="se-color"
				class="hex-input"
				class:overridden={value.color !== undefined}
				type="text"
				inputmode="text"
				autocomplete="off"
				spellcheck="false"
				placeholder={inherited.color}
				bind:value={hexDraft}
				oninput={() => (hexError = '')}
				onblur={commitHex}
				onkeydown={(e) => e.key === 'Enter' && commitHex()}
			/>
			{#if value.color !== undefined}
				<button type="button" class="clear" title="Reset to inherited" onclick={() => { hexDraft = ''; setKey('color', undefined); }}>↺</button>
			{/if}
		</div>
		<div class="swatches">
			{#each SWATCHES as c (c)}
				<button
					type="button"
					class="swatch"
					class:active={value.color === c}
					style="background: {c}"
					title={c}
					aria-label={`Set color ${c}`}
					onclick={() => pickSwatch(c)}
				></button>
			{/each}
		</div>
		{#if hexError}<div class="err" role="alert">{hexError}</div>{/if}
	</div>

	<!-- Icon -->
	<div class="field">
		<label class="field-label" for="se-icon">Icon URL</label>
		<div class="field-row">
			{#if effIcon}
				<img class="icon-preview" src={effIcon} alt="" />
			{:else}
				<span class="icon-preview none" aria-hidden="true"></span>
			{/if}
			<input
				id="se-icon"
				class="text-input"
				class:overridden={value.icon !== undefined}
				type="text"
				autocomplete="off"
				spellcheck="false"
				placeholder={inherited.icon ?? 'default glyph'}
				bind:value={iconDraft}
				onblur={commitIcon}
				onkeydown={(e) => e.key === 'Enter' && commitIcon()}
			/>
			{#if value.icon !== undefined}
				<button type="button" class="clear" title="Reset to inherited" onclick={() => { iconDraft = ''; setKey('icon', undefined); }}>↺</button>
			{/if}
		</div>
	</div>

	<!-- Scale -->
	<div class="field">
		<label class="field-label" for="se-scale">
			Scale
			<span class="val" class:inherited={value.scale === undefined}>{effScale.toFixed(2)}</span>
		</label>
		<div class="field-row">
			<input
				id="se-scale"
				type="range"
				min={STYLE_BOUNDS.scale.min}
				max={STYLE_BOUNDS.scale.max}
				step="0.05"
				value={effScale}
				oninput={(e) => setKey('scale', clampScale(Number((e.currentTarget as HTMLInputElement).value)))}
			/>
			{#if value.scale !== undefined}
				<button type="button" class="clear" title="Reset to inherited" onclick={() => setKey('scale', undefined)}>↺</button>
			{/if}
		</div>
	</div>

	<!-- Opacity -->
	<div class="field">
		<label class="field-label" for="se-opacity">
			Opacity
			<span class="val" class:inherited={value.opacity === undefined}>{effOpacity.toFixed(2)}</span>
		</label>
		<div class="field-row">
			<input
				id="se-opacity"
				type="range"
				min={STYLE_BOUNDS.opacity.min}
				max={STYLE_BOUNDS.opacity.max}
				step="0.05"
				value={effOpacity}
				oninput={(e) => setKey('opacity', clampOpacity(Number((e.currentTarget as HTMLInputElement).value)))}
			/>
			{#if value.opacity !== undefined}
				<button type="button" class="clear" title="Reset to inherited" onclick={() => setKey('opacity', undefined)}>↺</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.style-editor {
		display: flex;
		flex-direction: column;
		gap: 10px;
		font-family: var(--font-ui, sans-serif);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.field-label {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--color-text-muted, #6b7280);
	}
	.val {
		font-variant-numeric: tabular-nums;
		letter-spacing: 0;
		color: var(--color-text, #e8e0d0);
	}
	.val.inherited {
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
	}
	.field-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.field-row :global(input[type='range']) {
		flex: 1;
		accent-color: var(--color-accent, #c8942a);
	}
	.hex-input,
	.text-input {
		flex: 1;
		min-width: 0;
		padding: 3px 6px;
		font-size: 11px;
		font-family: var(--font-ui, sans-serif);
		color: var(--color-text, #e8e0d0);
		background: var(--color-surface, #161920);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
	}
	.hex-input::placeholder,
	.text-input::placeholder {
		color: var(--color-text-muted, #6b7280);
		opacity: 0.7;
	}
	.hex-input.overridden,
	.text-input.overridden {
		border-color: var(--color-accent, #c8942a);
	}
	.hex-input:focus-visible,
	.text-input:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	.color-preview {
		width: 18px;
		height: 18px;
		border-radius: 4px;
		border: 1px solid var(--color-border, #2a2d35);
		flex: none;
	}
	.icon-preview {
		width: 24px;
		height: 24px;
		object-fit: contain;
		border-radius: 4px;
		flex: none;
	}
	.icon-preview.none {
		border: 1px dashed var(--color-border, #2a2d35);
	}
	.swatches {
		display: flex;
		gap: 4px;
	}
	.swatch {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1px solid var(--color-border, #2a2d35);
		cursor: pointer;
		padding: 0;
	}
	.swatch.active {
		box-shadow: 0 0 0 2px var(--color-accent, #c8942a);
	}
	.swatch:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	.clear {
		flex: none;
		font-size: 12px;
		line-height: 1;
		padding: 2px 5px;
		border-radius: 4px;
		border: 1px solid var(--color-border, #2a2d35);
		background: transparent;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
	}
	.clear:hover {
		color: var(--color-text, #e8e0d0);
		border-color: var(--color-accent, #c8942a);
	}
	.err {
		font-size: 11px;
		color: var(--color-danger);
	}
</style>
