<!--
  Timeline — V1 retired 2026-04-28 (was apps/TimelineV2.svelte)

  Reads $entities + $intervals and renders the locked layout:
    - 240px palette sidebar (characters + events, draggable chips)
    - main timeline area: acts header → optional scenes row → entity rows of bars

  Interactions:
    - Drag chip from palette → drop on track → creates interval spanning the act
    - Drag left/right edge of a bar → edge-resize (default = free-fraction;
      hold Alt to snap to act/scene grid)
    - interactionLock blocks palette drops while edge-resize is in progress
-->

<script lang="ts">
	import { onMount } from 'svelte';
	import { entities, type Entity } from '$lib/stores/entities.js';
	import { intervals as intervalsStore, type Interval } from '$lib/stores/intervals.js';
	import Palette from '$lib/components/Palette.svelte';
	import ActsHeader from '$lib/components/ActsHeader.svelte';
	import IntervalRow from '$lib/components/IntervalRow.svelte';
	import PlayheadOverlay from '$lib/components/PlayheadOverlay.svelte';
	import EntityDetail from '$lib/components/EntityDetail.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { playhead } from '$lib/stores/playhead.js';
	import { windowStore } from '$lib/stores/windows.js';
	import { getDraftPreview, clearAllDraftsFor } from '$lib/stores/editable-drafts.js';
	import { presenceLabel, colorFor, dataNoteSnippet } from '$lib/timeline-v2-helpers.js';

	interface Props {
		entityId: string | null;
	}
	let { entityId }: Props = $props();

	// ── Data load ────────────────────────────────────────────────────────────
	let loaded = $state(false);
	onMount(async () => {
		try {
			await Promise.all([entities.load(), intervalsStore.load()]);
		} catch (err) {
			console.error('[TimelineV2] failed to load:', err);
		} finally {
			loaded = true;
		}
	});

	// ── Interaction lock — blocks palette drops while edge-resize is active ──
	let interactionLock = $state(false);

	// ── Error toast ───────────────────────────────────────────────────────────
	let errorMsg: string | null = $state(null);
	let errorTimer: ReturnType<typeof setTimeout> | null = null;

	function showError(msg: string) {
		errorMsg = msg;
		if (errorTimer != null) clearTimeout(errorTimer);
		errorTimer = setTimeout(() => {
			errorMsg = null;
			errorTimer = null;
		}, 4000);
	}

	// ── Derived data ─────────────────────────────────────────────────────────

	// Root-level Acts ordered by position (with createdAt as tiebreaker — matches
	// server-side actIndexOf).
	const acts = $derived(
		$entities
			.filter((e) => e.type === 'Act' && e.parentId == null)
			.sort((a, b) => {
				const ap = a.position ?? Number.MAX_SAFE_INTEGER;
				const bp = b.position ?? Number.MAX_SAFE_INTEGER;
				if (ap !== bp) return ap - bp;
				return Number(a.createdAt) - Number(b.createdAt);
			})
	);

	// Scenes grouped by parent Act id.
	const scenesByActId = $derived(
		(() => {
			const m = new Map<string, Entity[]>();
			for (const e of $entities) {
				if (e.type !== 'Scene') continue;
				if (!e.parentId) continue;
				if (!m.has(e.parentId)) m.set(e.parentId, []);
				m.get(e.parentId)!.push(e);
			}
			for (const list of m.values()) {
				list.sort((a, b) => {
					const ap = a.position ?? Number.MAX_SAFE_INTEGER;
					const bp = b.position ?? Number.MAX_SAFE_INTEGER;
					if (ap !== bp) return ap - bp;
					return Number(a.createdAt) - Number(b.createdAt);
				});
			}
			return m;
		})()
	);

	const characters = $derived($entities.filter((e) => e.type === 'Character'));
	const events = $derived($entities.filter((e) => e.type === 'Event'));

	// entityId → all its intervals, ordered by start_position
	const intervalsByEntityId = $derived(
		(() => {
			const m = new Map<string, Interval[]>();
			for (const i of $intervalsStore) {
				if (!m.has(i.entityId)) m.set(i.entityId, []);
				m.get(i.entityId)!.push(i);
			}
			for (const list of m.values()) {
				list.sort((a, b) => a.startPosition - b.startPosition);
			}
			return m;
		})()
	);

	// Rows: characters + events that have at least one interval
	const rowEntities = $derived(
		[...characters, ...events].filter((e) => (intervalsByEntityId.get(e.id)?.length ?? 0) > 0)
	);

	// Set of entity ids with ≥1 interval — Palette greys out placed items so
	// the writer can see who's still missing from the timeline at a glance.
	const placedEntityIds = $derived(
		new Set(rowEntities.map((e) => e.id))
	);

	// ── Track measurement ────────────────────────────────────────────────────
	let trackEl: HTMLDivElement | null = $state(null);
	let trackWidthPx = $state(0);

	$effect(() => {
		if (!trackEl) return;
		const ro = new ResizeObserver(() => {
			trackWidthPx = trackEl?.clientWidth ?? 0;
		});
		ro.observe(trackEl);
		trackWidthPx = trackEl.clientWidth;
		return () => ro.disconnect();
	});

	const N = $derived(acts.length);
	function pxForFractionalSpan(span: number): number {
		if (N === 0 || trackWidthPx === 0) return 0;
		return (span / N) * trackWidthPx;
	}

	// ── Per-bar render state ─────────────────────────────────────────────────
	function tooltipFor(entity: Entity, interval: Interval): string {
		const range = presenceLabel(interval.startPosition, interval.endPosition);
		return `${entity.name} · ${range}`;
	}

	// ── Drag-from-palette drop handler ───────────────────────────────────────
	let dragOver = $state(false);

	// MIME types: V2 uses a custom application type so V1 Timeline (which
	// reads text/plain) doesn't misinterpret our drags. V2 still sets
	// text/plain on the source for browser-DnD compat but the drop handler
	// reads from the custom type to confirm the drag belongs to V2.
	const V2_MIME = 'application/x-betwixt-v2-entity';

	function handleDragover(e: DragEvent) {
		if (interactionLock || N === 0) return;
		// Only react to drags that carry our marker. dataTransfer.types is
		// the only field readable during dragover (the actual data is hidden
		// until drop). Match case-insensitively per the spec.
		if (!e.dataTransfer?.types.some((t) => t.toLowerCase() === V2_MIME)) return;
		e.preventDefault();
		dragOver = true;
	}

	function handleDragleave() {
		dragOver = false;
	}

	async function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (interactionLock || N === 0 || !trackEl) return;

		// Read from the V2-specific MIME first; fall back to text/plain only
		// if the custom type is present (defensive — should always be set).
		const entityId =
			e.dataTransfer?.getData(V2_MIME) || e.dataTransfer?.getData('text/plain');
		if (!entityId) return;
		if (!e.dataTransfer?.types.some((t) => t.toLowerCase() === V2_MIME)) return;

		// Map drop x-coord to act index
		const rect = trackEl.getBoundingClientRect();
		const relX = e.clientX - rect.left;
		const rawPos = (relX / trackWidthPx) * N;
		const actIdx = Math.max(0, Math.min(Math.floor(rawPos), N - 1));
		const act = acts[actIdx];
		if (!act) return;

		try {
			// Create an interval spanning the entire act (user can resize afterward).
			await intervalsStore.createInterval({
				entityId,
				startActId: act.id,
				endActId: act.id
			});
		} catch (err) {
			showError((err as Error).message);
		}
	}

	// ── Side panel selection (Phase 1.6 / Lane C) ───────────────────────────
	// selectedEntityId drives the right-hand EntityDetail side panel. Only
	// one editor is open at a time per D10/9A — clicking a bar/act/scene
	// either opens the side panel or, if a popout window already exists for
	// that entity, focuses the existing window instead. (D10/9A + D10-ext/19A)
	let selectedEntityId: string | null = $state(null);

	function selectFromTimeline(id: string) {
		const existing = windowStore.findOpenEditorFor(id);
		if (existing) {
			windowStore.focus(existing.id);
			selectedEntityId = null;
			return;
		}
		selectedEntityId = id;
	}

	function moveSelectedToWindow() {
		if (!selectedEntityId) return;
		const id = selectedEntityId;
		windowStore.open('entity-detail', id);
		selectedEntityId = null;
	}

	// Draft-preview toast (D16/14A) — fires when EntityDetail's currently
	// rendered entity disappears from $entities (e.g. confirmed-delete from
	// another window). We capture both the entity name (looked up before
	// nulling out the selection) and any in-flight EditableField draft from
	// the module-level drafts bus.
	type DraftToast = { name: string; draft: string | null };
	let draftToast: DraftToast | null = $state(null);

	function handleEntityVanished(lastName: string) {
		if (!selectedEntityId) return;
		const id = selectedEntityId;
		const draftInfo = getDraftPreview(id);
		clearAllDraftsFor(id);
		draftToast = {
			name: lastName,
			draft: draftInfo?.text ?? null
		};
		selectedEntityId = null;
	}

	// If the host window opens with an entity prop pointed at an Act/Event/Scene,
	// preselect it. Other types fall through (no-op — Wiki/etc handle them).
	$effect(() => {
		if (entityId && entityId !== selectedEntityId) {
			const e = $entities.find((x) => x.id === entityId);
			if (e && (e.type === 'Act' || e.type === 'Event' || e.type === 'Scene')) {
				selectedEntityId = entityId;
			}
		}
	});

	// ── Playhead (Phase 1.5 scrubber) ────────────────────────────────────────
	function clickTrackToScrub(e: MouseEvent) {
		// Only scrub when the playhead is active. Idle = let drag handlers run.
		if ($playhead == null) return;
		// Ignore clicks on the playhead handle itself (it has its own pointerdown).
		const target = e.target as HTMLElement;
		if (target.closest('.playhead')) return;
		if (!trackEl || trackWidthPx === 0 || N === 0) return;
		const rect = trackEl.getBoundingClientRect();
		const t = ((e.clientX - rect.left) / trackWidthPx) * N;
		playhead.scrubTo(Math.max(0, Math.min(t, N)));
	}
</script>

<div class="tl2">
	<Palette
		{characters}
		{events}
		{placedEntityIds}
		{colorFor}
		onCreateEvent={async (name) => {
			await entities.createEntity('Event', name);
		}}
	/>

	<!-- ── Main timeline ──────────────────────────────────────────────── -->
	<div class="timeline">
		<div class="timeline-controls">
			<button
				class="scrub-toggle"
				class:active={$playhead != null}
				onclick={() => playhead.toggle(0)}
				title={$playhead == null ? 'Activate the scrubber' : 'Deactivate the scrubber'}
			>
				{#if $playhead == null}
					▶ Scrub
				{:else}
					◼ Stop scrubbing
					<span class="scrub-pos">T = {$playhead.toFixed(2)}</span>
				{/if}
			</button>
		</div>

		<ActsHeader
			{acts}
			{scenesByActId}
			{selectedEntityId}
			onSelectAct={selectFromTimeline}
			onSelectScene={selectFromTimeline}
		/>

		<!-- Rows of intervals — also the palette drop target -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="rows"
			class:drag-over={dragOver}
			class:scrubbing={$playhead != null}
			role="region"
			aria-label="Timeline track"
			bind:this={trackEl}
			ondragover={handleDragover}
			ondragleave={handleDragleave}
			ondrop={handleDrop}
			onclick={clickTrackToScrub}
		>
			{#if !loaded}
				<div class="row-empty">Loading…</div>
			{:else if rowEntities.length === 0 && acts.length > 0}
				<div class="row-empty drop-hint">
					{#if N > 0}
						Drag a character or event from the palette onto the timeline to begin.
					{:else}
						No presences yet. Add acts to begin your story.
					{/if}
				</div>
			{/if}

			{#each rowEntities as entity, idx (entity.id)}
				<IntervalRow
					{entity}
					intervals={intervalsByEntityId.get(entity.id) ?? []}
					{idx}
					{trackWidthPx}
					actCount={N}
					{acts}
					{scenesByActId}
					{colorFor}
					{dataNoteSnippet}
					{tooltipFor}
					{pxForFractionalSpan}
					onLockAcquire={() => { interactionLock = true; }}
					onLockRelease={() => { interactionLock = false; }}
					onError={showError}
					onSelect={(id) => selectFromTimeline(id)}
				/>
			{/each}

			<PlayheadOverlay {trackWidthPx} actCount={N} />
		</div>

		<!-- Error toast -->
		{#if errorMsg}
			<div class="error-toast" role="alert">{errorMsg}</div>
		{/if}
	</div>

	{#if selectedEntityId}
		<aside class="side-panel">
			<EntityDetail
				entityId={selectedEntityId}
				onMoveToWindow={moveSelectedToWindow}
				onClose={() => (selectedEntityId = null)}
				onEntityVanished={handleEntityVanished}
			/>
		</aside>
	{/if}

	{#if draftToast}
		<Toast
			kind={draftToast.draft ? 'draft-preview' : 'info'}
			message={draftToast.draft
				? `${draftToast.name} was deleted while you were editing.`
				: `${draftToast.name} was deleted.`}
			draft={draftToast.draft}
			onDismiss={() => (draftToast = null)}
		/>
	{/if}
</div>

<style>
	.tl2 {
		display: flex;
		height: 100%;
		background: var(--color-surface, #161920);
		color: var(--color-text, #e8e0d0);
		font-family: var(--font-ui, 'Inter', sans-serif);
		overflow: hidden;
	}

	/* ── Main timeline ───────────────────────────────────────────────── */
	.timeline {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: relative;
	}

	/* ── Side panel (Variant A from plan-design-review) ──────────────── */
	.side-panel {
		flex: 0 0 360px;
		min-width: 360px;
		max-width: 480px;
		border-left: 1px solid var(--color-border, #2a2d35);
		background: var(--color-surface-2, #1c1f28);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.timeline-controls {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding: 8px 14px;
		border-bottom: 1px solid var(--color-border, #2a2d35);
		background: var(--color-surface-2, #1c1f28);
		gap: 8px;
	}
	.scrub-toggle {
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 11px;
		font-weight: 500;
		color: var(--color-text-muted, #6b7280);
		background: transparent;
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		padding: 5px 10px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		transition: color 0.12s, border-color 0.12s, background 0.12s;
	}
	.scrub-toggle:hover {
		color: var(--color-text, #e8e0d0);
		border-color: var(--color-text-muted, #6b7280);
	}
	.scrub-toggle.active {
		color: var(--color-accent, #c8942a);
		border-color: var(--color-accent, #c8942a);
		background: rgba(200, 148, 42, 0.08);
	}
	.scrub-pos {
		font-variant-numeric: tabular-nums;
		opacity: 0.8;
	}

	.rows {
		flex: 1;
		position: relative;
		overflow-y: auto;
		transition: background 0.1s ease;
	}
	.rows.drag-over {
		background: rgba(200, 148, 42, 0.04);
	}
	.rows.scrubbing {
		cursor: ew-resize;
	}

	.row-empty {
		padding: 24px;
		color: var(--color-text-muted, #6b7280);
		font-size: 11px;
		text-align: center;
		font-style: italic;
	}
	.drop-hint {
		border: 1px dashed rgba(200, 148, 42, 0.2);
		margin: 16px;
		border-radius: 6px;
		padding: 32px 24px;
	}
	.rows.drag-over .drop-hint {
		border-color: rgba(200, 148, 42, 0.5);
		color: var(--color-accent, #c8942a);
	}

	.error-toast {
		position: absolute;
		bottom: 12px;
		left: 50%;
		transform: translateX(-50%);
		background: #ef4444;
		color: #fff;
		font-size: 12px;
		padding: 8px 16px;
		border-radius: 6px;
		max-width: 80%;
		text-align: center;
		pointer-events: none;
		z-index: 10;
	}
</style>
