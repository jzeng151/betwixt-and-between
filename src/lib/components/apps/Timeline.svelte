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
	import { onMount, onDestroy } from 'svelte';
	import { entities, type Entity } from '$lib/stores/entities.js';
	import { intervals as intervalsStore, type Interval } from '$lib/stores/intervals.js';
	import Palette from '$lib/components/Palette.svelte';
	import ActsHeader from '$lib/components/ActsHeader.svelte';
	import IntervalRow from '$lib/components/IntervalRow.svelte';
	import PlayheadOverlay from '$lib/components/PlayheadOverlay.svelte';
	import EntityDetail from '$lib/components/EntityDetail.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { playhead, isPlaying, playbackSpeed } from '$lib/stores/playhead.js';
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

	onDestroy(() => {
		playhead.pause();
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
	// Scrollbar gutter reserved by .rows when its content overflows
	// vertically. .acts-header and .scenes-row don't have overflow, so they
	// extend further right than bars unless we mirror the gutter as
	// padding-right. Driven via the --tl-gutter CSS variable below.
	let gutterPx = $state(0);

	$effect(() => {
		if (!trackEl) return;
		const measure = () => {
			trackWidthPx = trackEl?.clientWidth ?? 0;
			gutterPx = (trackEl?.offsetWidth ?? 0) - (trackEl?.clientWidth ?? 0);
		};
		const ro = new ResizeObserver(measure);
		ro.observe(trackEl);
		measure();
		return () => ro.disconnect();
	});

	const N = $derived(acts.length);
	// Max story-time position: the playback upper bound for play/stepForward.
	const maxT = $derived(acts.length);

	// Sorted snap positions for scene-granular stepping: act starts + scene
	// sub-boundaries within each act. Acts with no scenes contribute only their
	// start; acts with m scenes add m-1 interior points (k/m for k=1..m-1).
	const sceneBoundaries = $derived.by(() => {
		const pts: number[] = [];
		acts.forEach((act, i) => {
			pts.push(i);
			const scenes = scenesByActId.get(act.id) ?? [];
			const m = scenes.length;
			for (let k = 1; k < m; k++) pts.push(i + k / m);
		});
		pts.push(N);
		return pts; // already sorted: acts are sorted, subdivisions are fractional
	});

	function stepForwardScene() {
		playhead.pause();
		const cur = $playhead ?? 0;
		const next = sceneBoundaries.find((b) => b > cur + 1e-9);
		if (next !== undefined) playhead.scrubTo(Math.min(next, maxT));
	}

	function stepBackScene() {
		playhead.pause();
		const cur = $playhead ?? 0;
		const prev = [...sceneBoundaries].reverse().find((b) => b < cur - 1e-9);
		if (prev !== undefined) playhead.scrubTo(Math.max(prev, 0));
	}

	// ── Per-act weights for variable-width acts ──────────────────────────────
	// Each Act's data.timelineWeight (default 1) controls its share of the
	// timeline track. posToFrac/fracToPos translate story-time positions
	// (0..N) to/from cumulative track fractions (0..1) accounting for the
	// per-act weights. With all weights = 1 these reduce to pos/N and frac*N
	// (the original uniform-width behavior).
	// Override map populated by ActsHeader during a live act-resize drag so
	// bars and act columns stay in lockstep. Cleared on mouseup; persisted
	// values come back through the entity store.
	let weightOverride = $state<Record<string, number>>({});

	function actBaseWeight(a: Entity): number {
		const raw = a.data?.timelineWeight;
		if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
		return 1;
	}

	const weights = $derived.by(() => {
		return acts.map((a) => weightOverride[a.id] ?? actBaseWeight(a));
	});

	async function commitActWeights(updates: { id: string; weight: number }[]) {
		try {
			await Promise.all(
				updates.map(async ({ id, weight }) => {
					const e = $entities.find((x) => x.id === id);
					if (!e) return;
					const existing = e.data ?? {};
					await entities.updateEntity(id, {
						data: { ...existing, timelineWeight: weight }
					});
				})
			);
		} catch (err) {
			showError((err as Error).message);
		} finally {
			weightOverride = {};
		}
	}
	const totalWeight = $derived(weights.reduce((a, b) => a + b, 0));

	function posToFrac(p: number): number {
		if (totalWeight === 0 || N === 0) return 0;
		const i = Math.floor(p);
		let cum = 0;
		for (let k = 0; k < Math.min(i, weights.length); k++) cum += weights[k];
		if (i < weights.length) cum += (p - i) * weights[i];
		else cum = totalWeight; // p >= N → end of track
		return cum / totalWeight;
	}

	function fracToPos(f: number): number {
		if (totalWeight === 0 || N === 0) return 0;
		const target = f * totalWeight;
		let cum = 0;
		for (let i = 0; i < weights.length; i++) {
			const next = cum + weights[i];
			if (next >= target) {
				return i + (target - cum) / weights[i];
			}
			cum = next;
		}
		return N;
	}

	function pxForRange(start: number, end: number): number {
		return (posToFrac(end) - posToFrac(start)) * trackWidthPx;
	}

	// Pixel widths for each act, parallel to acts/weights. Used to pin both
	// the .acts-header and .scenes-row columns to identical pixel widths
	// instead of relying on flex auto-sizing, which Firefox refuses to
	// shrink below the act header's min-content even with min-width: 0
	// declared. By writing the width inline as flex-basis on both rows,
	// we get pixel-exact alignment regardless of inner content min-size.
	const actPxWidths = $derived.by(() => {
		if (totalWeight === 0 || trackWidthPx === 0) return [] as number[];
		return weights.map((w) => (w / totalWeight) * trackWidthPx);
	});

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

		// Map drop x-coord to act index using cumulative weights.
		const rect = trackEl.getBoundingClientRect();
		const relX = e.clientX - rect.left;
		const rawPos = fracToPos(relX / trackWidthPx);
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
	// Mode to pass to EntityDetail when the side panel opens. Reset to
	// 'view' on plain selects; set to 'edit' after creating a new act or
	// event so the user lands in the editor for the empty fields.
	let selectedInitialMode: 'view' | 'edit' = $state('view');

	function selectFromTimeline(id: string, mode: 'view' | 'edit' = 'view') {
		// Scrub mode is exclusive — clicks on bars / act headers / scene
		// cells should scrub the playhead, not open the side panel. The
		// rows-level click handler (clickTrackToScrub) does the scrub
		// once the bubbling reaches .rows.
		if ($playhead != null) return;
		const existing = windowStore.findOpenEditorFor(id);
		if (existing) {
			windowStore.focus(existing.id);
			selectedEntityId = null;
			return;
		}
		selectedInitialMode = mode;
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
	// ── + Act control (creates immediately, opens editor) ───────────────
	let savingAct = $state(false);

	async function addAct() {
		if (savingAct) return;
		savingAct = true;
		try {
			const created = await entities.createEntity('Act', `Act ${acts.length + 1}`, {
				position: acts.length
			});
			// Land in the editor — name is editable in the title bar.
			selectFromTimeline(created.id, 'edit');
		} catch (err) {
			showError((err as Error).message);
		} finally {
			savingAct = false;
		}
	}

	// ── Spotlight help popover ──────────────────────────────────────────────
	let spotlightHelpOpen = $state(false);
	let spotlightHelpWrapEl: HTMLDivElement | null = $state(null);
	// Position the popover via fixed coords derived from the (?) wrap
	// rect so it escapes any overflow:hidden ancestor (e.g. .timeline)
	// and clamps inside the viewport at narrow widths.
	const spotlightHelpStyle = $derived.by(() => {
		if (!spotlightHelpOpen || !spotlightHelpWrapEl) return '';
		const r = spotlightHelpWrapEl.getBoundingClientRect();
		const W = 260;
		const PAD = 8;
		const top = r.bottom + 6;
		let left = r.right - W;
		if (left < PAD) left = PAD;
		const maxLeft = window.innerWidth - W - PAD;
		if (left > maxLeft) left = maxLeft;
		return `position: fixed; top: ${top}px; left: ${left}px; right: auto;`;
	});
	$effect(() => {
		if (!spotlightHelpOpen) return;
		// Close on outside click / Escape so a second toggle of the (?) is
		// the only persistent way to dismiss.
		function handleDocClick(ev: MouseEvent) {
			const t = ev.target as HTMLElement;
			if (t.closest('.spotlight-help, .spotlight-help-popover')) return;
			spotlightHelpOpen = false;
		}
		function handleKey(ev: KeyboardEvent) {
			if (ev.key === 'Escape') spotlightHelpOpen = false;
		}
		document.addEventListener('mousedown', handleDocClick);
		document.addEventListener('keydown', handleKey);
		return () => {
			document.removeEventListener('mousedown', handleDocClick);
			document.removeEventListener('keydown', handleKey);
		};
	});

	const SPEED_STEPS = [0.25, 0.5, 1, 2];

	function handleKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;
		if ($playhead == null) return;
		switch (e.key) {
			case ' ':
				e.preventDefault();
				if ($isPlaying) playhead.pause();
				else playhead.play(maxT);
				break;
			case 'ArrowLeft':
				e.preventDefault();
				stepBackScene();
				break;
			case 'ArrowRight':
				e.preventDefault();
				stepForwardScene();
				break;
			case 'ArrowUp': {
				e.preventDefault();
				const idx = SPEED_STEPS.indexOf($playbackSpeed);
				playbackSpeed.set(SPEED_STEPS[Math.min(idx + 1, SPEED_STEPS.length - 1)] ?? SPEED_STEPS[SPEED_STEPS.length - 1]);
				break;
			}
			case 'ArrowDown': {
				e.preventDefault();
				const idx = SPEED_STEPS.indexOf($playbackSpeed);
				playbackSpeed.set(SPEED_STEPS[Math.max(idx - 1, 0)] ?? SPEED_STEPS[0]);
				break;
			}
		}
	}

	function clickTrackToScrub(e: MouseEvent) {
		// Only scrub when the playhead is active. Idle = let drag handlers run.
		if ($playhead == null) return;
		// Ignore clicks on the playhead handle itself (it has its own pointerdown).
		const target = e.target as HTMLElement;
		if (target.closest('.playhead')) return;
		if (!trackEl || trackWidthPx === 0 || N === 0) return;
		const rect = trackEl.getBoundingClientRect();
		const t = fracToPos((e.clientX - rect.left) / trackWidthPx);
		playhead.scrubTo(Math.max(0, Math.min(t, N)));
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="tl2">
	<Palette
		{characters}
		{events}
		{placedEntityIds}
		{colorFor}
		onCreateEvent={async () => {
			const created = await entities.createEntity(
				'Event',
				`Event ${events.length + 1}`
			);
			// Open the new event in the side panel in edit mode so the
			// user can fill in description / POV / outcome / etc.
			selectFromTimeline(created.id, 'edit');
		}}
	/>

	<!-- ── Main timeline ──────────────────────────────────────────────── -->
	<div class="timeline" style="--tl-gutter: {gutterPx}px">
		<div class="timeline-controls">
			<span class="ctrl-spacer"></span>
			<div class="ctrl-center">
				<button
					class="scrub-toggle"
					class:active={$playhead != null}
					onclick={() => playhead.toggle(0)}
					title={$playhead == null
						? 'Spotlight a moment in story-time'
						: 'Hide the spotlight'}
				>
					{#if $playhead == null}
						▶ Spotlight
					{:else}
						◼ Hide spotlight
						<span class="scrub-pos">Time = {$playhead.toFixed(2)}</span>
					{/if}
				</button>
				{#if $playhead != null}
					<div class="media-controls">
						<button
							class="media-btn"
							title="Step back one scene"
							aria-label="Step back"
							onclick={() => stepBackScene()}
						>⏮</button>
						<button
							class="media-btn media-play"
							class:playing={$isPlaying}
							title={$isPlaying ? 'Pause (Space)' : 'Play (Space)'}
							aria-label={$isPlaying ? 'Pause' : 'Play'}
							onclick={() => ($isPlaying ? playhead.pause() : playhead.play(maxT))}
						>{$isPlaying ? '⏸' : '▶'}</button>
						<button
							class="media-btn"
							title="Step forward one scene"
							aria-label="Step forward"
							onclick={() => stepForwardScene()}
						>⏭</button>
						<select
							class="speed-select"
							value={$playbackSpeed}
							onchange={(e) => playbackSpeed.set(Number((e.currentTarget as HTMLSelectElement).value))}
							title="Playback speed"
							aria-label="Playback speed"
						>
							<option value={0.25}>¼×</option>
							<option value={0.5}>½×</option>
							<option value={1}>1×</option>
							<option value={2}>2×</option>
						</select>
					</div>
				{/if}
				<div class="spotlight-help-wrap" bind:this={spotlightHelpWrapEl}>
					<button
						type="button"
						class="spotlight-help"
						class:open={spotlightHelpOpen}
						aria-label="What is Spotlight?"
						aria-expanded={spotlightHelpOpen}
						onclick={() => (spotlightHelpOpen = !spotlightHelpOpen)}
					>?</button>
					{#if spotlightHelpOpen}
						<div
							class="spotlight-help-popover"
							role="dialog"
							aria-label="Spotlight help"
							style={spotlightHelpStyle}
						>
							<p class="spotlight-help-title">Spotlight a moment in story-time.</p>
							<p>Story Graph dims characters and events not present at this moment.</p>
							<p>World Map dims locations no one is at.</p>
							<p>Drag the amber line on the timeline to move.</p>
						</div>
					{/if}
				</div>
			</div>
			<div class="ctrl-right">
				<button
					class="act-add-btn"
					aria-label="Add act"
					disabled={savingAct}
					onclick={addAct}
				>+ Act</button>
			</div>
		</div>

		<ActsHeader
			{acts}
			{scenesByActId}
			{selectedEntityId}
			{weights}
			{actPxWidths}
			{trackWidthPx}
			onSelectAct={selectFromTimeline}
			onSelectScene={selectFromTimeline}
			onWeightPreview={(updates) => {
				weightOverride = { ...weightOverride, ...updates };
			}}
			onWeightCommit={(updates) => {
				commitActWeights(
					Object.entries(updates).map(([id, weight]) => ({ id, weight }))
				);
			}}
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
					{posToFrac}
					{fracToPos}
					{pxForRange}
					onLockAcquire={() => { interactionLock = true; }}
					onLockRelease={() => { interactionLock = false; }}
					onError={showError}
					onSelect={(id) => selectFromTimeline(id)}
				/>
			{/each}

			<PlayheadOverlay {trackWidthPx} actCount={N} {posToFrac} />
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
				initialMode={selectedInitialMode}
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
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		padding: 8px 14px;
		border-bottom: 1px solid var(--color-border, #2a2d35);
		background: var(--color-surface-2, #1c1f28);
		gap: 8px;
	}
	.ctrl-spacer {
		display: block;
	}
	.ctrl-center {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.ctrl-right {
		display: flex;
		justify-content: flex-end;
	}
	.act-add-btn {
		background: transparent;
		border: 1px dashed var(--color-text-muted, #6b7280);
		color: var(--color-text-muted, #6b7280);
		border-radius: 4px;
		padding: 5px 10px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: color 0.12s, border-color 0.12s, background 0.12s;
	}
	.act-add-btn:hover {
		color: var(--color-accent, #c8942a);
		border-color: var(--color-accent, #c8942a);
		background: rgba(200, 148, 42, 0.06);
	}
	.act-add-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.scrub-toggle {
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 12px;
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

	/* Spotlight help (?) icon + popover. The popover anchors to the wrap
	   so it stays positioned when the controls bar reflows. */
	.spotlight-help-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.spotlight-help {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: transparent;
		border: 1px solid var(--color-border, #2a2d35);
		color: var(--color-text-muted, #6b7280);
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 12px;
		font-weight: 600;
		line-height: 1;
		cursor: pointer;
		padding: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: color 0.12s, border-color 0.12s;
	}
	.spotlight-help:hover,
	.spotlight-help.open {
		color: var(--color-accent, #c8942a);
		border-color: var(--color-accent, #c8942a);
	}
	.spotlight-help-popover {
		/* Position is set inline via spotlightHelpStyle (fixed coords
		   derived from the (?) bounding rect). Inline style escapes
		   .timeline's overflow: hidden and clamps inside the viewport. */
		z-index: 20;
		width: 260px;
		background: var(--color-surface-2, #1c1f28);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 6px;
		padding: 10px 12px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-text-muted, #6b7280);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
	}
	.spotlight-help-popover p {
		margin: 0 0 6px;
	}
	.spotlight-help-popover p:last-child {
		margin-bottom: 0;
	}
	.spotlight-help-title {
		color: var(--color-text, #e8e0d0);
		font-weight: 600;
	}

	.rows {
		flex: 1;
		position: relative;
		overflow-y: auto;
		/* Always reserve the scrollbar gutter so .rows content-box width
		   doesn't jump when row count crosses the overflow threshold. The
		   --tl-gutter CSS variable on .timeline mirrors this width to
		   .acts-header / .scenes-row so bars and act columns stay aligned. */
		scrollbar-gutter: stable;
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
		font-size: 12px;
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
		font-size: 13px;
		padding: 8px 16px;
		border-radius: 6px;
		max-width: 80%;
		text-align: center;
		pointer-events: none;
		z-index: 10;
	}

	.media-controls {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	.media-btn {
		width: 26px;
		height: 26px;
		padding: 0;
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		background: transparent;
		color: var(--color-text-muted, #6b7280);
		font-size: 11px;
		line-height: 1;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: color 0.12s, border-color 0.12s, background 0.12s;
	}
	.media-btn:hover {
		color: var(--color-text, #e8e0d0);
		border-color: var(--color-text-muted, #6b7280);
	}
	.media-btn.media-play.playing {
		color: var(--color-accent, #c8942a);
		border-color: var(--color-accent, #c8942a);
		background: rgba(200, 148, 42, 0.08);
	}

	.speed-select {
		height: 26px;
		background: transparent;
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		color: var(--color-text-muted, #6b7280);
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 11px;
		padding: 0 4px;
		cursor: pointer;
	}
</style>
