<!--
  CharacterHeader — avatar + role + affiliation + icon-pick toggle.
  Owns the hidden file input and avatar-resize pipeline; emits the
  resulting JPEG data-URL up via onAvatarChange so the body can also
  clear `icon` and trigger saveAll.

  role and affiliation are $bindable so the body retains them as the
  source of truth for saveAll(); onSaveAll is invoked on select-change
  and input-blur, matching the pre-carve behavior.
-->

<script lang="ts">
	import { getCharacterIcon } from '$lib/icons/registry.js';

	interface Props {
		entityName: string;
		avatar: string;
		icon: string;
		role: string;
		affiliation: string;
		readOnly: boolean;
		iconPickerOpen: boolean;
		onSaveAll: () => Promise<void>;
		onToggleIconPicker: () => void;
		onAvatarChange: (dataUrl: string) => Promise<void>;
	}
	let {
		entityName,
		avatar,
		icon,
		role = $bindable(''),
		affiliation = $bindable(''),
		readOnly,
		iconPickerOpen,
		onSaveAll,
		onToggleIconPicker,
		onAvatarChange
	}: Props = $props();

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

	function initials(name: string): string {
		return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
	}

	const iconEntry = $derived(getCharacterIcon(icon));

	let fileInput: HTMLInputElement = $state(null!);

	function triggerAvatarUpload() {
		fileInput.click();
	}

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
				await onAvatarChange(canvas.toDataURL('image/jpeg', 0.82));
			};
			img.src = reader.result as string;
		};
		reader.readAsDataURL(file);
	}
</script>

<div class="header">
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="avatar-stack">
		<div
			class="avatar-lg"
			class:avatar-lg-roled={!avatar && (role || iconEntry)}
			style={!avatar && (role || iconEntry) ? `--rc:${roleColor(role)}` : ''}
			onclick={!readOnly ? triggerAvatarUpload : undefined}
			title={readOnly ? undefined : 'Click to change avatar'}
			role={readOnly ? undefined : 'button'}
			tabindex={readOnly ? -1 : 0}
			onkeydown={(e) => !readOnly && e.key === 'Enter' && triggerAvatarUpload()}
		>
			{#if avatar}
				<img src={avatar} alt={entityName} class="avatar-lg-img" />
			{:else if iconEntry}
				{@const IconComp = iconEntry.component}
				<span class="avatar-lg-icon" aria-label={iconEntry.label}>
					<IconComp size={26} strokeWidth={1.6} />
				</span>
			{:else}
				<span class="avatar-lg-initials">{initials(entityName)}</span>
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
				onclick={onToggleIconPicker}
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
				<select class="hfield-select" bind:value={role} onchange={onSaveAll}>
					{#each ROLE_OPTIONS as opt}
						<option value={opt.value}>{opt.value || '— none —'}</option>
					{/each}
				</select>
			{:else if role}
				<span class="role-badge" style="--rc:{roleColor(role)}">{role}</span>
			{:else}
				<span class="hfield-empty">Role</span>
			{/if}
			{#if !readOnly}
				<input
					class="hfield-input"
					bind:value={affiliation}
					onblur={onSaveAll}
					placeholder="Affiliation"
				/>
			{:else if affiliation}
				<span class="hfield-text">{affiliation}</span>
			{:else}
				<span class="hfield-empty">Affiliation</span>
			{/if}
		</div>
	</div>
</div>

<style>
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
</style>
