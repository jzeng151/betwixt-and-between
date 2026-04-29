<!--
  TimelineV2 — Phase 1A PR 2

  Reads $entities + $intervals and renders the locked v2 layout:
    - 240px palette sidebar (characters + events, draggable chips)
    - main timeline area: acts header → optional scenes row → entity rows of bars

  Interactions:
    - Drag chip from palette → drop on track → creates interval spanning the act
    - Drag left/right edge of a bar → edge-resize with smart snap
    - interactionLock blocks palette drops while edge-resize is in progress

  Visual reference:
    ~/.gstack/projects/jzeng151-betwixt-and-between/designs/v2-timeline-20260428/v2-timeline-mockup-v2.html
  Spec:
    CONSIDERATIONS.md → "[2026-04-28] /plan-design-review resolutions"
-->

<script lang="ts">
	import { onMount } from 'svelte';
	import { entities, type Entity } from '$lib/stores/entities.js';
	import { intervals as intervalsStore, type Interval } from '$lib/stores/intervals.js';
	import Palette from '$lib/components/Palette.svelte';
	import ActsHeader from '$lib/components/ActsHeader.svelte';
	import IntervalRow from '$lib/components/IntervalRow.svelte';
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

	// Touch entityId so prop is "used" (PR 2 will use it to scroll/highlight).
	$effect(() => {
		void entityId;
	});
</script>

<div class="tl2">
	<Palette {characters} {events} {placedEntityIds} {colorFor} />

	<!-- ── Main timeline ──────────────────────────────────────────────── -->
	<div class="timeline">
		<ActsHeader {acts} {scenesByActId} />

		<!-- Rows of intervals — also the palette drop target -->
		<div
			class="rows"
			class:drag-over={dragOver}
			role="region"
			aria-label="Timeline track"
			bind:this={trackEl}
			ondragover={handleDragover}
			ondragleave={handleDragleave}
			ondrop={handleDrop}
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
				/>
			{/each}
		</div>

		<!-- Error toast -->
		{#if errorMsg}
			<div class="error-toast" role="alert">{errorMsg}</div>
		{/if}
	</div>
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

	.rows {
		flex: 1;
		position: relative;
		overflow-y: auto;
		transition: background 0.1s ease;
	}
	.rows.drag-over {
		background: rgba(200, 148, 42, 0.04);
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
