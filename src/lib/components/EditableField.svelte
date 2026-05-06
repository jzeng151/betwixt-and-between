<!--
  EditableField — atomic edit-on-blur field component.

  Locked 2026-04-29 by /plan-eng-review (D13/Issue 10A). Used by ActEditor /
  EventEditor / SceneEditor and (future) any other entity-detail surface.

  Reads current value from `$entities.find(id).data[field]`. Commits via
  `entities.updateEntity(id, { data: { ...existing, [field]: draft } })` —
  preserves other fields in the data blob (P2-5: merged, not overwritten).

  Commit timing (D14):
    - kind='textarea' / 'single-line': commit on blur. Single-line also
      commits on Enter.
    - kind='picklist' / 'swatches' / 'multi-entity-picker': commit on change.
    - Esc cancels (no commit).

  Errors (D15): inline red message + Retry button on PATCH failure. Writer's
  text preserved client-side.

  Multi-entity-picker (kind='multi-entity-picker') writes to the relationships
  table (D4/4C + D4-extension/18B). Multi-select chip picker; toggling a
  candidate either creates or deletes a relationships row of the given
  `relationshipType`.
-->

<script lang="ts">
	import { entities } from '$lib/stores/entities.js';
	import { relationships } from '$lib/stores/relationships.js';
	import type { Entity } from '$lib/stores/entities.js';
	import type { RelationshipType, EntityType } from '$lib/server/db/schema.js';
	import WikiLinkText from './WikiLinkText.svelte';
	import { setDraft, clearDraft } from '$lib/stores/editable-drafts.js';
	import {
		registerDirtyField,
		unregisterDirtyField,
		type EditableFieldHandle
	} from '$lib/util/pending-commit.js';
	import { parseWikiLinks } from '$lib/wiki-links.js';
	import { preferences } from '$lib/stores/preferences.js';

	type Kind =
		| 'single-line'
		| 'textarea'
		| 'picklist'
		| 'swatches'
		| 'multi-entity-picker';

	interface PicklistOption {
		value: string;
		label: string;
	}
	interface SwatchOption {
		value: string;
		label: string;
		color?: string;
	}

	interface Props {
		entityId: string;
		field: string;
		/** Field label rendered above the input. Pass an empty string to
		 *  skip the label header entirely — used when the surrounding
		 *  context already names the field (e.g. NotesSection's
		 *  disclosure summary makes "Body" redundant). */
		label?: string;
		kind: Kind;
		placeholder?: string;
		rows?: number;
		picklistOptions?: PicklistOption[];
		swatchOptions?: SwatchOption[];
		relationshipType?: RelationshipType;
		targetEntityType?: EntityType;
		/** Optional explicit list of currently-linked entity ids (for tests
		 *  or pre-seeded state). If omitted, derives from $relationships. */
		currentIds?: string[];
		/** When true, render the field as read-only text instead of inputs.
		 *  Used by EntityDetail's view mode. */
		readOnly?: boolean;
		/** Render a decorative chip preview below the textarea showing
		 *  resolved [[Name]] markers as the user types. textarea-kind only.
		 *  Undefined defaults to true (will derive from preferences once
		 *  slice 7 commit 5 lands). Suppressed below 480px viewport
		 *  regardless. */
		showLinkPreview?: boolean;
	}

	const {
		entityId,
		field,
		label = '',
		kind,
		placeholder = '',
		rows = 4,
		picklistOptions = [],
		swatchOptions = [],
		relationshipType,
		targetEntityType,
		currentIds = undefined,
		readOnly = false,
		showLinkPreview
	}: Props = $props();

	const entity = $derived(($entities as Entity[]).find((e) => e.id === entityId));

	// entity.data is jsonb (object) post-T8a; no parse needed.
	const data = $derived(entity ? entity.data : {});
	const currentValue = $derived(
		typeof data[field] === 'string' ? (data[field] as string) : ''
	);

	// Draft: synced from store when not focused.
	let draft = $state('');
	let focused = $state(false);
	let saveError = $state<string | null>(null);
	let lastAttempt = $state<string | null>(null);

	$effect(() => {
		if (!focused) draft = currentValue;
	});

	/* Track in-flight drafts so the EntityDetail draft-preview toast (D16/14A)
	   can recover the user's last-typed text if the entity is deleted
	   from another window mid-edit. */
	$effect(() => {
		if (focused && draft && draft !== currentValue) {
			setDraft(entityId, field, draft);
		} else {
			clearDraft(entityId, field);
		}
		return () => clearDraft(entityId, field);
	});

	/* Pending-commit handle: lets EntityLink chip clicks (slice 7) drain
	   in-flight textarea drafts BEFORE swapping EntityDetail context.
	   Without this, the navigate-then-blur sequence commits AGAINST the
	   wrong entity reference. The handle is stable across re-renders so
	   the registry Set dedupes correctly.

	   Captures draft at call time to eliminate theoretical race where
	   draft changes between the dirty check and commitText's local capture. */
	const fieldHandle: EditableFieldHandle = {
		commitNow: async () => {
			const valueToCommit = draft;
			if (valueToCommit !== currentValue) {
				const value = valueToCommit;
				lastAttempt = value;
				saveError = null;
				const existing = entity ? (entity.data ?? {}) : {};
				try {
					await entities.updateEntity(entityId, {
						data: { ...existing, [field]: value }
					});
					lastAttempt = null;
				} catch (err) {
					saveError = (err as Error).message || 'Save failed';
				}
			}
		}
	};

	$effect(() => {
		const isDirty = focused && draft !== currentValue;
		if (isDirty) {
			registerDirtyField(fieldHandle);
		} else {
			unregisterDirtyField(fieldHandle);
		}
		return () => unregisterDirtyField(fieldHandle);
	});

	async function commitText() {
		const value = draft;
		lastAttempt = value;
		saveError = null;
		const existing = entity ? (entity.data ?? {}) : {};
		try {
			await entities.updateEntity(entityId, {
				data: { ...existing, [field]: value }
			});
			lastAttempt = null;
		} catch (err) {
			saveError = (err as Error).message || 'Save failed';
		}
	}

	async function retry() {
		if (lastAttempt == null) return;
		const value = lastAttempt;
		saveError = null;
		const existing = entity ? (entity.data ?? {}) : {};
		try {
			await entities.updateEntity(entityId, {
				data: { ...existing, [field]: value }
			});
			lastAttempt = null;
		} catch (err) {
			saveError = (err as Error).message || 'Save failed';
		}
	}

	function onTextBlur() {
		focused = false;
		if (draft !== currentValue) commitText();
	}

	// ── Edit-mode preview pane ────────────────────────────────────────
	// When the textarea draft contains resolved [[Name]] markers, show
	// decorative chips below the textarea so the writer can confirm the
	// link parsed (Pass 6: chips are not clickable; navigate via View
	// mode). Suppressed below 480px viewport (mobile gating).
	const effectiveShowLinkPreview = $derived(
		showLinkPreview ?? $preferences.editor.linkPreviewEnabled
	);

	let viewportWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1024);
	$effect(() => {
		if (typeof window === 'undefined') return;
		const onResize = () => (viewportWidth = window.innerWidth);
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});
	const isMobile = $derived(viewportWidth < 480);

	// Debounced parse — for short bodies the parse is cheap enough to run
	// synchronously on every keystroke; for long bodies we coalesce via
	// 100ms timeout so typing doesn't lag.
	let debouncedDraft = $state('');
	$effect(() => {
		if (draft.length < 100) {
			debouncedDraft = draft;
			return;
		}
		const id = setTimeout(() => {
			debouncedDraft = draft;
		}, 100);
		return () => clearTimeout(id);
	});

	const previewPool = $derived(
		($entities as Entity[]).map((e) => ({ id: e.id, name: e.name, type: e.type }))
	);
	const previewSegments = $derived(
		!readOnly && kind === 'textarea' && effectiveShowLinkPreview && !isMobile
			? parseWikiLinks(debouncedDraft, previewPool)
			: []
	);
	const previewLinks = $derived(
		previewSegments.flatMap((s) =>
			s.kind === 'link' && s.entity ? [{ entity: s.entity, name: s.name }] : []
		)
	);
	const hasResolvedLinks = $derived(previewLinks.length > 0);

	const REL_COLOR_MAP: Record<string, string> = {
		Character: 'var(--color-rel-arc)',
		Location: 'var(--color-rel-loc)',
		Event: 'var(--color-rel-event)',
		Scene: 'var(--color-rel-event)',
		Act: 'var(--color-rel-arc)',
		Note: 'var(--color-rel-other)'
	};
	function previewChipColor(type: string): string {
		return REL_COLOR_MAP[type] ?? 'var(--color-rel-other)';
	}

	function onTextKeydown(e: KeyboardEvent, allowEnter: boolean) {
		if (e.key === 'Escape') {
			draft = currentValue;
			focused = false;
			(e.target as HTMLElement).blur();
		} else if (allowEnter && e.key === 'Enter') {
			e.preventDefault();
			focused = false;
			(e.target as HTMLElement).blur();
			if (draft !== currentValue) commitText();
		}
	}

	// Picklist / swatches: commit on change.
	async function commitValue(value: string) {
		const existing = entity ? (entity.data ?? {}) : {};
		try {
			await entities.updateEntity(entityId, {
				data: { ...existing, [field]: value }
			});
			saveError = null;
			lastAttempt = null;
		} catch (err) {
			saveError = (err as Error).message || 'Save failed';
			lastAttempt = value;
		}
	}

	// Derive linked ids from relationships unless currentIds was explicitly provided.
	const linkedIds = $derived.by(() => {
		if (Array.isArray(currentIds)) return currentIds;
		if (!relationshipType) return [] as string[];
		return ($relationships as Array<{ fromId: string; toId: string; type: string }>)
			.filter((r) => r.fromId === entityId && r.type === relationshipType)
			.map((r) => r.toId);
	});

	const candidates = $derived.by(() => {
		if (!targetEntityType) return [] as Entity[];
		const linkedSet = new Set(linkedIds);
		return ($entities as Entity[]).filter(
			(e) => e.type === targetEntityType && !linkedSet.has(e.id)
		);
	});

	const linkedEntities = $derived.by(() => {
		const linkedSet = new Set(linkedIds);
		return ($entities as Entity[]).filter((e) => linkedSet.has(e.id));
	});

	async function pickCandidate(targetId: string) {
		if (!relationshipType) return;
		try {
			await relationships.createRelationship(entityId, targetId, relationshipType);
		} catch (err) {
			saveError = (err as Error).message || 'Save failed';
		}
	}

	async function removeChip(targetId: string) {
		if (!relationshipType) return;
		const existing = ($relationships as Array<{
			id: string;
			fromId: string;
			toId: string;
			type: string;
		}>).find(
			(r) => r.fromId === entityId && r.toId === targetId && r.type === relationshipType
		);
		if (existing) {
			try {
				await relationships.deleteRelationship(existing.id);
			} catch (err) {
				saveError = (err as Error).message || 'Save failed';
			}
		}
	}
</script>

<div class="field-row" data-field={field} class:readonly={readOnly}>
	{#if label}
		<div class="field-header">
			<span class="field-label">{label}</span>
		</div>
	{/if}

	{#if readOnly}
		{#if kind === 'multi-entity-picker'}
			<div class="readonly-chips">
				{#if linkedEntities.length === 0}
					<span class="readonly-empty">{placeholder || 'None'}</span>
				{:else}
					{#each linkedEntities as ent}
						<span class="chip">{ent.name}</span>
					{/each}
				{/if}
			</div>
		{:else if kind === 'swatches'}
			{#if currentValue}
				<span class="swatch readonly-swatch" style:background={currentValue}></span>
			{:else}
				<span class="readonly-empty">{placeholder || 'None'}</span>
			{/if}
		{:else if kind === 'picklist'}
			{@const matchedOpt = picklistOptions.find((o) => o.value === currentValue)}
			<span class="readonly-text">
				{matchedOpt?.label ?? (currentValue || placeholder || '—')}
			</span>
		{:else if kind === 'textarea'}
			<div class="readonly-textarea">
				<WikiLinkText body={String(currentValue ?? '')} placeholder={placeholder || '—'} />
			</div>
		{:else}
			<span class="readonly-text">
				{currentValue || placeholder || '—'}
			</span>
		{/if}
	{:else if kind === 'textarea'}
		<textarea
			class="field-textarea"
			placeholder={placeholder}
			rows={rows}
			value={draft}
			oninput={(e) => (draft = (e.target as HTMLTextAreaElement).value)}
			onfocus={() => (focused = true)}
			onblur={onTextBlur}
			onkeydown={(e) => onTextKeydown(e, false)}
		></textarea>
		{#if hasResolvedLinks}
			<div
				class="wiki-link-preview"
				role="status"
				aria-live="polite"
				aria-label="Linked entities in this body"
			>
				{#each previewLinks as { entity, name }, i (`${entity.id}-${i}`)}
					<span
						class="entity-chip preview-chip"
						style="--chip-color: {previewChipColor(entity.type)}"
					>{name}</span>
				{/each}
			</div>
		{/if}
	{:else if kind === 'single-line'}
		<input
			type="text"
			class="field-input"
			placeholder={placeholder}
			value={draft}
			oninput={(e) => (draft = (e.target as HTMLInputElement).value)}
			onfocus={() => (focused = true)}
			onblur={onTextBlur}
			onkeydown={(e) => onTextKeydown(e, true)}
		/>
	{:else if kind === 'picklist'}
		<select
			class="field-input"
			value={currentValue}
			onchange={(e) => commitValue((e.target as HTMLSelectElement).value)}
		>
			<option value="" disabled>{placeholder || 'Select…'}</option>
			{#each picklistOptions as opt}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
	{:else if kind === 'swatches'}
		<div class="swatch-row" role="group" aria-label={label}>
			{#each swatchOptions as opt}
				<button
					type="button"
					class="swatch"
					class:swatch-selected={currentValue === opt.value}
					data-swatch-value={opt.value}
					style:background={opt.color ?? opt.value}
					aria-label={opt.label}
					aria-pressed={currentValue === opt.value}
					onclick={() => commitValue(opt.value)}
				></button>
			{/each}
		</div>
	{:else if kind === 'multi-entity-picker'}
		<div class="picker-chips">
			{#each linkedEntities as ent}
				<span class="chip" data-chip-id={ent.id}>
					{ent.name}
					<button
						type="button"
						class="chip-remove"
						data-remove-id={ent.id}
						aria-label="Remove {ent.name}"
						onclick={() => removeChip(ent.id)}
					>×</button>
				</span>
			{/each}
		</div>
		<div class="picker-candidates">
			{#each candidates as cand}
				<button
					type="button"
					class="picker-candidate"
					data-pick-id={cand.id}
					onclick={() => pickCandidate(cand.id)}
				>+ {cand.name}</button>
			{/each}
		</div>
	{/if}

	{#if saveError}
		<p class="field-error">
			{saveError}
			<button type="button" class="retry" onclick={retry}>Retry</button>
		</p>
	{/if}
</div>

<style>
	.field-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 14px;
	}
	/* View-mode (readOnly) styling — render values as plain text rather than
	   inputs. Layout matches the editor so toggling between view/edit doesn't
	   shift the page. */
	.readonly-text {
		font-size: 14px;
		color: var(--color-text, #e8e0d0);
		min-height: 22px;
		padding: 4px 0;
	}
	.readonly-textarea {
		font-size: 14px;
		line-height: 1.45;
		color: var(--color-text, #e8e0d0);
		white-space: pre-wrap;
		padding: 4px 0;
		min-height: 22px;
	}
	.readonly-empty {
		font-size: 14px;
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
		padding: 4px 0;
	}
	.readonly-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 4px 0;
	}
	.readonly-swatch {
		display: inline-block;
		width: 18px;
		height: 18px;
		border-radius: 4px;
		border: 1px solid var(--color-border, #2a2d35);
	}
	.field-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}
	.field-label {
		font-size: 10px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}
	.field-input,
	.field-textarea {
		background: var(--color-surface, #161920);
		color: var(--color-text, #e8e0d0);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		padding: 7px 10px;
		font-family: var(--font-display, 'Fraunces', Georgia, serif);
		font-size: 14px;
		outline: none;
		resize: vertical;
		width: 100%;
	}
	.field-textarea {
		min-height: 64px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 13px;
		line-height: 1.5;
	}
	.field-input:focus,
	.field-textarea:focus {
		border-color: var(--color-accent, #c8942a);
	}

	/* Edit-mode link preview pane (slice 7 commit 4). Subtle inline
	   treatment per /plan-design-review Pass 5: same surface as the
	   textarea, no border, just enough padding to separate visually.
	   Chips are decorative spans (Pass 6) — no click handler, no focus
	   ring, no hover state beyond the existing entity-chip tokens.
	   Suppressed below 480px viewport in JS (mobile gating). */
	.wiki-link-preview {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
		padding: 6px 8px;
		background: var(--color-surface-2, #1c1f28);
	}
	.preview-chip {
		cursor: default;
	}
	.swatch-row {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.swatch {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1.5px solid transparent;
		cursor: pointer;
		padding: 0;
	}
	.swatch-selected {
		border-color: var(--color-text, #e8e0d0);
	}
	.picker-chips {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: rgba(200, 148, 42, 0.12);
		color: var(--color-text, #e8e0d0);
		border: 1px solid color-mix(in srgb, var(--color-accent, #c8942a) 40%, transparent);
		border-radius: 12px;
		padding: 3px 8px;
		font-family: var(--font-display, 'Fraunces', Georgia, serif);
		font-size: 13px;
	}
	.chip-remove {
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		font-size: 15px;
		line-height: 1;
		cursor: pointer;
		padding: 0;
	}
	.picker-candidates {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin-top: 4px;
	}
	.picker-candidate {
		background: transparent;
		border: 1px dashed var(--color-text-muted, #6b7280);
		color: var(--color-text-muted, #6b7280);
		border-radius: 12px;
		padding: 3px 8px;
		font-family: var(--font-display, 'Fraunces', Georgia, serif);
		font-size: 12px;
		cursor: pointer;
	}
	.picker-candidate:hover {
		color: var(--color-text, #e8e0d0);
		border-color: var(--color-text, #e8e0d0);
	}
	.field-error {
		color: #ef4444;
		font-size: 12px;
		margin-top: 4px;
	}
	.retry {
		margin-left: 6px;
		background: transparent;
		border: 1px solid #ef4444;
		color: #ef4444;
		border-radius: 3px;
		padding: 2px 6px;
		font-size: 11px;
		cursor: pointer;
	}
</style>
