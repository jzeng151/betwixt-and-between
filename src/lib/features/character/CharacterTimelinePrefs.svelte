<!--
  CharacterTimelinePrefs — three timeline-affecting controls:
    1. Timeline color: 16 swatches + #rrggbb input + native color wheel
    2. Show on timeline: 3-mode radio + optional custom-field input
    3. Timeline snippet: textarea (first line shows on this character's bars)

  Owns customHex / customHexError local state (UI-only — never persisted).
  color, timelineLabel, notes are $bindable so the body holds the source
  of truth for saveAll(). entityId scopes the usedColors collision map.
-->

<script lang="ts">
	import { entities } from '$lib/stores/entities.js';
	import { CHARACTER_COLORS, HEX_COLOR_RE, type TimelineLabelMode } from '$lib/features/timeline/timeline-helpers.js';

	interface Props {
		entityId: string;
		color: string | null;
		timelineLabel: TimelineLabelMode;
		notes: string;
		readOnly: boolean;
		onSaveAll: () => Promise<void>;
	}
	let {
		entityId,
		color = $bindable(null),
		timelineLabel = $bindable({ mode: 'name-and-note' } as TimelineLabelMode),
		notes = $bindable(''),
		readOnly,
		onSaveAll
	}: Props = $props();

	let customHex = $state('');
	let customHexError = $state('');

	function readData(data: Record<string, unknown> | undefined): Record<string, string> {
		return (data ?? {}) as Record<string, string>;
	}

	const usedColors = $derived.by(() => {
		const m = new Map<string, string>();
		for (const e of $entities) {
			if (e.id === entityId) continue;
			const d = readData(e.data);
			const c = typeof d.color === 'string' ? d.color.toLowerCase() : '';
			if (c && HEX_COLOR_RE.test(c)) m.set(c, e.name);
		}
		return m;
	});

	const autoColor = $derived.by(() => {
		if (!entityId) return CHARACTER_COLORS[0];
		const chars = $entities.filter((e) => e.type === 'Character');
		const idx = chars.findIndex((e) => e.id === entityId);
		return CHARACTER_COLORS[(idx < 0 ? 0 : idx) % CHARACTER_COLORS.length];
	});

	const customHexPreview = $derived(
		customHex.trim() && HEX_COLOR_RE.test(customHex.trim())
			? customHex.trim().toLowerCase()
			: null
	);

	async function chooseColor(hex: string) {
		color = hex;
		customHex = '';
		customHexError = '';
		await onSaveAll();
	}
	async function resetColor() {
		color = null;
		customHex = '';
		customHexError = '';
		await onSaveAll();
	}
	async function commitCustomHex() {
		const val = customHex.trim();
		if (!val) { customHexError = ''; return; }
		if (!HEX_COLOR_RE.test(val)) {
			customHexError = 'Use #rrggbb (e.g. #c8942a)';
			return;
		}
		customHexError = '';
		color = val.toLowerCase();
		customHex = '';
		await onSaveAll();
	}
	function handleHexKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') commitCustomHex();
		if (e.key === 'Escape') { customHex = ''; customHexError = ''; }
	}

	async function setTimelineMode(mode: 'name-only' | 'name-and-note' | 'custom') {
		if (mode === 'custom') {
			const field = timelineLabel.mode === 'custom' ? timelineLabel.field : '';
			timelineLabel = { mode: 'custom', field };
		} else {
			timelineLabel = { mode };
		}
		await onSaveAll();
	}
	async function commitCustomField(field: string) {
		timelineLabel = { mode: 'custom', field: field.trim() };
		await onSaveAll();
	}

	function timelineLabelDescription(tl: TimelineLabelMode): string {
		if (tl.mode === 'name-only') return 'Name only';
		if (tl.mode === 'custom') return tl.field ? `Custom field: ${tl.field}` : 'Custom field (none chosen)';
		return 'Name + note snippet';
	}
</script>

<!-- Timeline color -->
<div class="field-header">
	<span class="field-label">Timeline color</span>
	{#if !readOnly && color}
		<button class="field-edit-btn" onclick={resetColor} data-testid="char-color-reset">Reset to default</button>
	{/if}
</div>
{#if !readOnly}
	<div class="color-grid">
		<div class="swatch-row" role="group" aria-label="Timeline color">
			{#each CHARACTER_COLORS as hex}
				{@const inUse = usedColors.has(hex.toLowerCase())}
				<button
					type="button"
					class="swatch"
					class:swatch-selected={color === hex}
					class:swatch-used={inUse && color !== hex}
					style="--sw:{hex}"
					aria-label={inUse ? `${hex} (used by ${usedColors.get(hex.toLowerCase())})` : hex}
					aria-pressed={color === hex}
					data-testid="char-color-{hex}"
					title={inUse ? `Already used by ${usedColors.get(hex.toLowerCase())}` : hex}
					onclick={() => chooseColor(hex)}
				></button>
			{/each}
		</div>
		<div class="hex-row">
			<input
				class="hex-input"
				type="text"
				placeholder="#rrggbb"
				maxlength="7"
				bind:value={customHex}
				onblur={commitCustomHex}
				onkeydown={handleHexKeydown}
				data-testid="char-color-custom-input"
			/>
			{#if customHexPreview}
				<span
					class="swatch swatch-display"
					style="--sw:{customHexPreview}"
					aria-hidden="true"
					data-testid="char-color-custom-preview"
				></span>
			{/if}
		</div>
		<input
			type="color"
			class="color-wheel"
			value={color ?? autoColor}
			onchange={(e) => chooseColor((e.currentTarget as HTMLInputElement).value.toLowerCase())}
			aria-label="Custom color picker"
			data-testid="char-color-wheel"
		/>
	</div>
	{#if customHexError}
		<p class="hex-error" data-testid="char-color-custom-error">{customHexError}</p>
	{/if}
	{#if color && usedColors.has(color)}
		<p class="color-collision" data-testid="char-color-collision">
			Also used by {usedColors.get(color)}.
		</p>
	{/if}
{:else}
	<div class="display-row">
		{#if color}
			<span class="swatch swatch-display" style="--sw:{color}" aria-hidden="true"></span>
			<span class="display-text">{color}</span>
		{:else}
			<span class="swatch swatch-display" style="--sw:{autoColor}" aria-hidden="true"></span>
			<span class="display-text display-muted">Default ({autoColor})</span>
		{/if}
	</div>
{/if}

<!-- Show on timeline -->
<div class="field-header">
	<span class="field-label">Show on timeline</span>
</div>
{#if !readOnly}
	<div class="radio-group" role="radiogroup" aria-label="Show on timeline">
		<label class="radio-row">
			<input
				type="radio"
				name="timelineLabelMode"
				value="name-only"
				checked={timelineLabel.mode === 'name-only'}
				onchange={() => setTimelineMode('name-only')}
				data-testid="char-tl-name-only"
			/>
			<span class="radio-text">Name only</span>
		</label>
		<label class="radio-row">
			<input
				type="radio"
				name="timelineLabelMode"
				value="name-and-note"
				checked={timelineLabel.mode === 'name-and-note'}
				onchange={() => setTimelineMode('name-and-note')}
				data-testid="char-tl-name-and-note"
			/>
			<span class="radio-text">Name + note snippet (default)</span>
		</label>
		<label class="radio-row">
			<input
				type="radio"
				name="timelineLabelMode"
				value="custom"
				checked={timelineLabel.mode === 'custom'}
				onchange={() => setTimelineMode('custom')}
				data-testid="char-tl-custom"
			/>
			<span class="radio-text">Custom field</span>
		</label>
		{#if timelineLabel.mode === 'custom'}
			<input
				class="custom-field-input"
				type="text"
				placeholder="field name (e.g. motivation)"
				value={timelineLabel.field}
				onblur={(e) => commitCustomField((e.currentTarget as HTMLInputElement).value)}
				onkeydown={(e) => { if (e.key === 'Enter') commitCustomField((e.currentTarget as HTMLInputElement).value); }}
				data-testid="char-tl-custom-field"
			/>
		{/if}
	</div>
{:else}
	<div class="display-row">
		<span class="display-text">{timelineLabelDescription(timelineLabel)}</span>
	</div>
{/if}

<!-- Timeline snippet: source of the second-line label rendered on this
     character's timeline bars when "Name + note snippet" mode is selected
     (the default). Field name in the entity data blob is still `notes` for
     backward compatibility with timeline-v2-helpers' dataNoteSnippet(). -->
<label class="field-label" for="char-notes">Timeline snippet</label>
{#if !readOnly}
	<textarea
		id="char-notes"
		class="field-textarea"
		placeholder="One short line — appears on the timeline bar."
		bind:value={notes}
		onblur={onSaveAll}
		rows="2"
	></textarea>
	<p class="field-hint">
		First line shows on this character's timeline bars when "Name + note
		snippet" is selected above.
	</p>
{:else}
	<p class="field-display" class:field-empty={!notes}>
		{notes || 'Not set.'}
	</p>
{/if}

<style>
	.field-label {
		font-size: 9px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}

	.field-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.field-edit-btn {
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		font-size: 10px;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
		padding: 0;
	}
	.field-edit-btn:hover { color: var(--color-accent); }

	.field-display {
		font-size: 13px;
		color: var(--color-text);
		margin: 0;
		white-space: pre-wrap;
		word-wrap: break-word;
	}
	.field-empty {
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
	}

	.field-textarea {
		background: var(--color-surface-2, #1c1f28);
		color: var(--color-text);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		padding: 6px 8px;
		font-size: 13px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		line-height: 1.5;
		resize: vertical;
	}
	.field-textarea:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.field-hint {
		margin: 0;
		font-size: 10px;
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
		line-height: 1.4;
	}

	.swatch-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.swatch {
		position: relative;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--sw);
		border: 1px solid var(--color-border, #2a2d35);
		cursor: pointer;
	}

	.swatch-selected {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.hex-input {
		flex: 1 1 auto;
		min-width: 0;
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 11px;
		background: var(--color-surface-2, #1c1f28);
		color: var(--color-text);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		padding: 4px 6px;
	}

	.color-grid {
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-rows: auto auto;
		gap: 6px 10px;
		align-items: center;
	}

	.hex-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.color-wheel {
		grid-row: 1 / 3;
		grid-column: 2;
		width: 36px;
		height: 36px;
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		padding: 0;
		background: transparent;
		cursor: pointer;
		align-self: stretch;
	}

	.color-collision {
		font-size: 10px;
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
		margin: 0;
	}

	.display-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.display-text { font-size: 13px; color: var(--color-text); }
	.display-muted { color: var(--color-text-muted, #6b7280); font-style: italic; }
	.swatch-display {
		cursor: default;
	}

	.hex-error {
		color: var(--color-rel-rival, #ef4444);
		font-size: 11px;
		margin: 0;
	}

	.radio-group {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.radio-row {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--color-text);
		cursor: pointer;
	}

	.radio-text { font-size: 12px; }

	.custom-field-input {
		background: var(--color-surface-2, #1c1f28);
		color: var(--color-text);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		padding: 4px 6px;
		font-size: 11px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		margin-left: 22px;
	}
</style>
