<!--
  CharacterEditorBody — the editor surface (avatar, role, affiliation,
  icon picker, relationship sections, timeline color, show-on-timeline,
  motivation, notes) for a Character entity. Owns all detail-mode local
  state and the multi-field saveAll() commit.

  Phase 1 wiki-rework slice 5.5. Mounted by both surfaces that need a
  Character editor:
    - CharacterEditor.svelte's detail-mode wrapper (still renders the
      mode-toggle + name InlineEdit + popout/close/delete chrome itself)
    - CharacterWikiEditor.svelte (used by EntityDetail, which provides
      its own header/footer chrome)

  Both wrappers control view/edit by passing the `readOnly` prop. The
  body itself never reads a `mode` state — it derives every conditional
  rendering off `readOnly`. When readOnly transitions false → true (via
  Cancel or Done), an effect re-syncs local state from the entity so any
  unsaved drafts are discarded; saveAll() bails when readOnly is true so
  a focus-shift-triggered blur from the Cancel button cannot commit a
  draft just before the wrapper flips back to view mode.
-->

<script lang="ts">
	import { entities } from '$lib/stores/entities.js';
	import { relationships, type Relationship } from '$lib/stores/relationships.js';
	import EntityLink from './EntityLink.svelte';
	import type { RelationshipType, EntityType } from '$lib/server/db/schema.js';
	import type { Entity } from '$lib/stores/entities.js';
	import { CHARACTER_COLORS, HEX_COLOR_RE, type TimelineLabelMode } from '$lib/timeline-v2-helpers.js';
	import {
		getCharacterIcon,
		listCharacterIcons,
		CHARACTER_ICON_CATEGORIES,
		type IconCategory
	} from '$lib/icons/registry.js';

	interface Props {
		entityId: string;
		readOnly?: boolean;
	}
	const { entityId, readOnly = false }: Props = $props();

	const ROLE_OPTIONS: { value: string; color: string }[] = [
		{ value: '',            color: 'var(--color-text-muted)' },
		{ value: 'Protagonist', color: 'var(--color-accent)' },
		{ value: 'Antagonist',  color: 'var(--color-rel-rival)' },
		{ value: 'Ally',        color: 'var(--color-rel-ally)' },
		{ value: 'Rival',       color: 'var(--color-rel-rival)' },
		{ value: 'Mentor',      color: 'var(--color-rel-mentor)' },
		{ value: 'Supporting',  color: 'var(--color-rel-event)' }
	];

	function roleColor(r: string): string {
		const lower = r.toLowerCase();
		return ROLE_OPTIONS.find((o) => o.value.toLowerCase() === lower)?.color ?? 'var(--color-text-muted)';
	}

	function readData(data: Record<string, unknown> | undefined): Record<string, string> {
		return (data ?? {}) as Record<string, string>;
	}

	function initials(name: string): string {
		return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
	}

	const entity = $derived($entities.find((e) => e.id === entityId));

	let saveError = $state('');
	let role = $state('');
	let affiliation = $state('');
	let motivation = $state('');
	let notes = $state('');
	let avatar = $state('');
	let icon = $state<string>('');
	let iconPickerOpen = $state(false);
	let color = $state<string | null>(null);
	let customHex = $state('');
	let customHexError = $state('');
	let timelineLabel = $state<TimelineLabelMode>({ mode: 'name-and-note' });

	let fileInput: HTMLInputElement = $state(null!);

	function syncFromEntity() {
		if (!entity) return;
		const d = readData(entity.data);
		role = d.role ?? '';
		affiliation = d.affiliation ?? '';
		motivation = d.motivation ?? '';
		notes = d.notes ?? '';
		avatar = d.avatar ?? '';
		icon = d.icon ?? '';
		iconPickerOpen = false;
		const rawColor = (d as Record<string, unknown>).color;
		color = typeof rawColor === 'string' && HEX_COLOR_RE.test(rawColor) ? rawColor : null;
		customHex = '';
		customHexError = '';
		const rawLabel = (d as Record<string, unknown>).timelineLabel as TimelineLabelMode | undefined;
		if (rawLabel && typeof rawLabel === 'object' && 'mode' in rawLabel) {
			if (rawLabel.mode === 'name-only' || rawLabel.mode === 'name-and-note') {
				timelineLabel = { mode: rawLabel.mode };
			} else if (rawLabel.mode === 'custom') {
				timelineLabel = { mode: 'custom', field: typeof rawLabel.field === 'string' ? rawLabel.field : '' };
			} else {
				timelineLabel = { mode: 'name-and-note' };
			}
		} else {
			timelineLabel = { mode: 'name-and-note' };
		}
	}

	$effect(() => {
		if (entity) syncFromEntity();
	});

	// Cancel-revert + transient-state-reset on edit → view transition.
	// Tracking with a plain `let` (not $state) so the effect doesn't track
	// it and avoids a redundant re-run cycle.
	let _prevReadOnly = readOnly;
	$effect(() => {
		const next = readOnly;
		if (next && !_prevReadOnly) {
			// Wrapper just flipped us into view (Done or Cancel). Discard
			// any unsaved drafts and close transient pickers.
			syncFromEntity();
			pickerGroup = null;
			iconPickerOpen = false;
		}
		_prevReadOnly = next;
	});

	async function saveAll() {
		if (!entityId) return;
		// Bail when in view mode. The wrapper Cancel button flips readOnly
		// on mousedown, ahead of the focused input's blur. Without this
		// guard, saveAll would PATCH the draft just before the cancel-revert
		// $effect runs, leaving the discarded text in the entity store.
		if (readOnly) return;
		saveError = '';
		const existing = entity ? readData(entity.data) : {};
		const data: Record<string, unknown> = {
			...existing,
			role,
			affiliation,
			motivation,
			notes,
			avatar,
			timelineLabel
		};
		if (color) {
			data.color = color;
		} else {
			delete data.color;
		}
		if (icon) {
			data.icon = icon;
		} else {
			delete data.icon;
		}
		try {
			await entities.updateEntity(entityId, { data });
		} catch {
			saveError = "Couldn't save.";
		}
	}

	// ── Color picker ────────────────────────────────────────────────────
	async function chooseColor(hex: string) {
		color = hex;
		customHex = '';
		customHexError = '';
		await saveAll();
	}
	async function resetColor() {
		color = null;
		customHex = '';
		customHexError = '';
		await saveAll();
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
		await saveAll();
	}
	function handleHexKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') commitCustomHex();
		if (e.key === 'Escape') { customHex = ''; customHexError = ''; }
	}

	const customHexPreview = $derived(
		customHex.trim() && HEX_COLOR_RE.test(customHex.trim())
			? customHex.trim().toLowerCase()
			: null
	);

	// ── Timeline label config ───────────────────────────────────────────
	async function setTimelineMode(mode: 'name-only' | 'name-and-note' | 'custom') {
		if (mode === 'custom') {
			const field = timelineLabel.mode === 'custom' ? timelineLabel.field : '';
			timelineLabel = { mode: 'custom', field };
		} else {
			timelineLabel = { mode };
		}
		await saveAll();
	}
	async function commitCustomField(field: string) {
		timelineLabel = { mode: 'custom', field: field.trim() };
		await saveAll();
	}

	async function pickIcon(id: string) {
		icon = id;
		avatar = '';
		iconPickerOpen = false;
		await saveAll();
	}
	async function clearIcon() {
		icon = '';
		iconPickerOpen = false;
		await saveAll();
	}
	function iconsInCategory(cat: IconCategory) {
		return listCharacterIcons().filter((i) => i.category === cat);
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

	const iconEntry = $derived(getCharacterIcon(icon));

	function triggerAvatarUpload() { fileInput.click(); }

	function handleAvatarUpload(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			const img = new Image();
			img.onload = async () => {
				const max = 200;
				const ratio = Math.min(1, max / img.width, max / img.height);
				const canvas = document.createElement('canvas');
				canvas.width = Math.round(img.width * ratio);
				canvas.height = Math.round(img.height * ratio);
				canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
				avatar = canvas.toDataURL('image/jpeg', 0.82);
				icon = '';
				await saveAll();
			};
			img.src = reader.result as string;
		};
		reader.readAsDataURL(file);
	}

	const REL_GROUPS: { label: string; type: RelationshipType }[] = [
		{ label: 'Allies',      type: 'allied_with' },
		{ label: 'Rivals',      type: 'rivals' },
		{ label: 'Mentors',     type: 'mentor_of' },
		{ label: 'Others',      type: 'other' },
		{ label: 'Locations',   type: 'located_at' },
		{ label: 'Key Events',  type: 'takes_place_at' }
	];

	function getLinked(type: RelationshipType): { rel: Relationship; other: Entity }[] {
		if (!entityId) return [];
		const out: { rel: Relationship; other: Entity }[] = [];
		for (const r of $relationships) {
			if (r.type !== type) continue;
			if (r.fromId !== entityId && r.toId !== entityId) continue;
			const linkedId = r.fromId === entityId ? r.toId : r.fromId;
			const other = $entities.find((e) => e.id === linkedId);
			if (other) out.push({ rel: r, other });
		}
		return out;
	}

	async function removeRelationship(id: string) {
		saveError = '';
		try {
			await relationships.deleteRelationship(id);
		} catch {
			saveError = "Couldn't remove relationship.";
		}
	}

	function timelineLabelDescription(tl: TimelineLabelMode): string {
		if (tl.mode === 'name-only') return 'Name only';
		if (tl.mode === 'custom') return tl.field ? `Custom field: ${tl.field}` : 'Custom field (none chosen)';
		return 'Name + note snippet';
	}

	const PICKER_TYPES: Partial<Record<RelationshipType, EntityType[]>> = {
		allied_with:    ['Character'],
		rivals:         ['Character'],
		mentor_of:      ['Character'],
		other:          ['Character'],
		located_at:     ['Location'],
		takes_place_at: ['Event', 'Scene'],
		caused_by:      ['Event', 'Scene']
	};

	let pickerGroup: RelationshipType | null = $state(null);

	function pickerOptions(relType: RelationshipType) {
		const types = PICKER_TYPES[relType] ?? [];
		const linked = new Set(getLinked(relType).map(({ other }) => other.id));
		return $entities.filter(
			(e) => types.includes(e.type as EntityType) && e.id !== entityId && !linked.has(e.id)
		);
	}

	async function pickEntity(relType: RelationshipType, targetId: string) {
		pickerGroup = null;
		try {
			await relationships.createRelationship(entityId, targetId, relType);
		} catch {
			saveError = "Couldn't add relationship.";
		}
	}
</script>

{#if entity}
	<div class="char-detail" class:view-mode={readOnly}>
		<!-- Avatar + role + affiliation row. The wrapping window (CharacterEditor
		     or EntityDetail) renders the entity name above this; we keep the
		     avatar here since it's a Character-specific identity affordance. -->
		<div class="header">
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class="avatar-stack">
				<div
					class="avatar-lg"
					class:avatar-lg-roled={!avatar && (role || iconEntry)}
					style={!avatar && (role || iconEntry) ? `--rc:${roleColor(role)}` : ''}
					onclick={triggerAvatarUpload}
					title="Click to change avatar"
					role="button"
					tabindex="0"
					onkeydown={(e) => e.key === 'Enter' && triggerAvatarUpload()}
				>
					{#if avatar}
						<img src={avatar} alt={entity.name} class="avatar-lg-img" />
					{:else if iconEntry}
						{@const IconComp = iconEntry.component}
						<span class="avatar-lg-icon" aria-label={iconEntry.label}>
							<IconComp size={26} strokeWidth={1.6} />
						</span>
					{:else}
						<span class="avatar-lg-initials">{initials(entity.name)}</span>
					{/if}
					<div class="avatar-overlay">
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
							<path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/>
						</svg>
					</div>
				</div>
				{#if !readOnly}
					<button
						type="button"
						class="icon-pick-link"
						onclick={() => (iconPickerOpen = !iconPickerOpen)}
						aria-expanded={iconPickerOpen}
					>{iconEntry ? 'Change icon' : 'Pick icon'}</button>
				{/if}
			</div>
			<input
				type="file"
				accept="image/*"
				class="file-input-hidden"
				bind:this={fileInput}
				onchange={handleAvatarUpload}
			/>

			<div class="header-info">
				<div class="header-meta">
					{#if !readOnly}
						<select class="hfield-select" bind:value={role} onchange={saveAll}>
							{#each ROLE_OPTIONS as opt}
								<option value={opt.value}>{opt.value || '— none —'}</option>
							{/each}
						</select>
					{:else}
						{#if role}
							<span class="role-badge" style="--rc:{roleColor(role)}">{role}</span>
						{:else}
							<span class="hfield-empty">Role</span>
						{/if}
					{/if}
					{#if !readOnly}
						<input
							class="hfield-input"
							bind:value={affiliation}
							onblur={saveAll}
							placeholder="Affiliation"
						/>
					{:else}
						{#if affiliation}
							<span class="hfield-text">{affiliation}</span>
						{:else}
							<span class="hfield-empty">Affiliation</span>
						{/if}
					{/if}
				</div>
			</div>
		</div>

		{#if iconPickerOpen && !readOnly}
			<div class="icon-picker">
				{#each CHARACTER_ICON_CATEGORIES as cat}
					<div class="icon-picker-cat">
						<p class="section-label">{cat}</p>
						<div class="icon-grid">
							{#each iconsInCategory(cat) as entry}
								{@const IconComp = entry.component}
								<button
									type="button"
									class="icon-tile"
									class:icon-tile-selected={icon === entry.id}
									title={entry.label}
									aria-label={entry.label}
									aria-pressed={icon === entry.id}
									onclick={() => pickIcon(entry.id)}
								>
									<IconComp size={20} strokeWidth={1.6} />
								</button>
							{/each}
						</div>
					</div>
				{/each}
				{#if iconEntry}
					<button type="button" class="icon-picker-clear" onclick={clearIcon}>Clear icon</button>
				{/if}
			</div>
		{/if}

		{#if saveError}<p class="save-error">{saveError}</p>{/if}

		{#if !readOnly && pickerGroup}
			<div class="picker-backdrop" role="presentation" onclick={() => (pickerGroup = null)} onkeydown={() => (pickerGroup = null)}></div>
		{/if}

		{#each REL_GROUPS as group}
			{@const linked = getLinked(group.type)}
			<section class="rel-group">
				<p class="section-label">{group.label}</p>
				<div class="chip-row">
					{#each linked as link (link.rel.id)}
						<EntityLink
							id={link.other.id}
							name={link.other.name}
							relationshipType={group.type}
							onRemove={!readOnly ? () => removeRelationship(link.rel.id) : undefined}
						/>
					{/each}
					<div class="picker-wrap">
						{#if !readOnly}
							<button
								class="chip-add"
								class:chip-add-open={pickerGroup === group.type}
								onclick={() => (pickerGroup = pickerGroup === group.type ? null : group.type)}
								title="Add {group.label}"
							>+</button>
						{/if}
						{#if !readOnly && pickerGroup === group.type}
							{@const opts = pickerOptions(group.type)}
							<div class="picker-dropdown">
								{#if opts.length === 0}
									<p class="picker-empty">Nothing available to add.</p>
								{:else}
									{#each opts as opt}
										<button class="picker-item" onclick={() => pickEntity(group.type, opt.id)}>
											<span class="picker-name">{opt.name}</span>
											<span class="picker-type">{opt.type}</span>
										</button>
									{/each}
								{/if}
							</div>
						{/if}
					</div>
				</div>
			</section>
		{/each}

		<hr class="divider" />

		<div class="details">
			<!-- Timeline color picker -->
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

			<label class="field-label" for="char-motivation">Motivation</label>
			{#if !readOnly}
				<textarea
					id="char-motivation"
					class="field-textarea"
					placeholder="What drives this character?"
					bind:value={motivation}
					onblur={saveAll}
					rows="3"
				></textarea>
			{:else}
				<p class="field-display" class:field-empty={!motivation}>
					{motivation || 'Not set.'}
				</p>
			{/if}

			<label class="field-label" for="char-notes">Notes</label>
			{#if !readOnly}
				<textarea
					id="char-notes"
					class="field-textarea"
					placeholder="Additional notes…"
					bind:value={notes}
					onblur={saveAll}
					rows="4"
				></textarea>
			{:else}
				<p class="field-display" class:field-empty={!notes}>
					{notes || 'Not set.'}
				</p>
			{/if}

			{#if saveError}<p class="save-error">{saveError}</p>{/if}
		</div>
	</div>
{/if}

<style>
	.char-detail {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 14px 18px;
	}

	.header {
		display: flex;
		align-items: flex-start;
		gap: 14px;
	}

	.avatar-lg {
		position: relative;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--color-surface, #161920);
		border: 1px solid var(--color-border, #2a2d35);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		overflow: hidden;
	}

	.avatar-lg-roled {
		border-color: var(--rc, var(--color-text-muted));
	}

	.avatar-lg-initials {
		font-family: var(--font-display, 'Fraunces', serif);
		font-size: 20px;
		font-weight: 500;
		color: var(--color-text);
	}

	.avatar-lg-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text);
	}

	.avatar-stack {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.icon-pick-link {
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		font-size: 10px;
		cursor: pointer;
		padding: 0;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.icon-pick-link:hover { color: var(--color-text); }

	.icon-picker {
		background: var(--color-surface, #161920);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 6px;
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.icon-picker-cat { display: flex; flex-direction: column; gap: 4px; }

	.icon-grid {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 4px;
	}

	.icon-tile {
		background: transparent;
		border: 1px solid var(--color-border, #2a2d35);
		color: var(--color-text);
		border-radius: 4px;
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.icon-tile:hover {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}
	.icon-tile-selected {
		border-color: var(--color-accent);
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 13%, transparent);
	}

	.icon-picker-clear {
		align-self: flex-start;
		background: transparent;
		border: 1px solid var(--color-border, #2a2d35);
		color: var(--color-text-muted, #6b7280);
		font-size: 10px;
		padding: 3px 8px;
		border-radius: 4px;
		cursor: pointer;
	}
	.icon-picker-clear:hover { color: var(--color-text); }

	.avatar-lg-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.avatar-overlay {
		position: absolute;
		bottom: 0;
		right: 0;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--color-surface-2, #1c1f28);
		border: 1px solid var(--color-border, #2a2d35);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted, #6b7280);
	}

	.file-input-hidden { display: none; }

	.header-info {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1 1 auto;
		min-width: 0;
	}

	.role-badge {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 11px;
		font-weight: 500;
		border-radius: 999px;
		color: var(--rc, var(--color-text-muted));
		background: color-mix(in srgb, var(--rc, var(--color-text-muted)) 13%, transparent);
		border: 1px solid color-mix(in srgb, var(--rc, var(--color-text-muted)) 33%, transparent);
	}

	.header-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}

	.hfield-empty {
		font-size: 11px;
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
	}
	.hfield-text {
		font-size: 11px;
		color: var(--color-text);
	}

	.hfield-select {
		font-size: 11px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		background: var(--color-surface-2, #1c1f28);
		color: var(--color-text);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		padding: 2px 6px;
	}
	.hfield-input {
		font-size: 11px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		background: var(--color-surface-2, #1c1f28);
		color: var(--color-text);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		padding: 2px 6px;
	}

	.rel-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.section-label {
		font-size: 9px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		margin: 0;
	}

	.chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		align-items: center;
	}

	.chip-add {
		background: transparent;
		border: 1px dashed var(--color-border, #2a2d35);
		color: var(--color-text-muted, #6b7280);
		border-radius: 999px;
		width: 22px;
		height: 22px;
		font-size: 12px;
		cursor: pointer;
	}
	.chip-add:hover {
		color: var(--color-accent);
		border-color: var(--color-accent);
	}
	.chip-add-open {
		color: var(--color-accent);
		border-color: var(--color-accent);
	}

	.picker-backdrop {
		position: fixed;
		inset: 0;
		z-index: 5;
	}

	.picker-wrap { position: relative; }

	.picker-dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		min-width: 200px;
		max-height: 240px;
		overflow-y: auto;
		background: var(--color-surface-2, #1c1f28);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 6px;
		box-shadow: 0 8px 16px rgba(0, 0, 0, 0.4);
		padding: 4px;
		z-index: 10;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.picker-item {
		background: transparent;
		border: none;
		color: var(--color-text);
		text-align: left;
		font-size: 11px;
		padding: 4px 8px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		border-radius: 4px;
	}
	.picker-item:hover { background: var(--color-surface, #161920); }

	.picker-name { color: var(--color-text); }
	.picker-type {
		font-size: 9px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.picker-empty {
		font-size: 11px;
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
		padding: 6px 8px;
		margin: 0;
	}

	.divider {
		border: none;
		border-top: 1px solid var(--color-border, #2a2d35);
		margin: 8px 0 0;
	}

	.details {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

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

	.save-error { color: var(--color-rel-rival, #ef4444); font-size: 12px; }

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
