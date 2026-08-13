<!--
  ActsHeader — acts header row + scenes row for the Timeline.

  Renders act names, scene counts, and scene cells.
  Per-act affordances:
    - "Break into scenes" inline form (when act has no scenes yet)
    - "×" delete button with inline confirmation listing interval cascade impact
-->

<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { entities } from '$lib/stores/entities.js';
	import { intervals as intervalsStore } from '$lib/features/timeline/intervals-store.js';
	import { refreshTimelineStores } from '$lib/features/timeline/loaders.js';
	import { createAutoDismiss } from '$lib/features/timeline/auto-dismiss.js';
	import type { Entity } from '$lib/stores/entities.js';

	interface Props {
		acts: Entity[];
		scenesByActId: Map<string, Entity[]>;
		/** Currently selected entity id (Act or Scene). Used to render the
		 *  amber top-border on the selected act column header. (D2/2B-i) */
		selectedEntityId?: string | null;
		/** Per-act flex weights (parallel to `acts`). */
		weights?: number[];
		/** Per-act pixel widths (parallel to `acts`). Used directly as
		 *  flex-basis on both .acts-header and .scenes-row so the two rows
		 *  end at identical x. Avoids Firefox flex auto-min-size quirks. */
		actPxWidths?: number[];
		/** Track width in pixels — used to convert drag-dx to weight delta. */
		trackWidthPx?: number;
		/** Click on an act header (not on a button) selects the act. */
		onSelectAct?: (actId: string) => void;
		/** Click on a scene cell selects the scene. */
		onSelectScene?: (sceneId: string) => void;
		/** Live weight preview during act-resize drag. */
		onWeightPreview?: (updates: Record<string, number>) => void;
		/** Weight commit on mouseup (only changed acts). */
		onWeightCommit?: (updates: Record<string, number>) => void;
	}
	let {
		acts,
		scenesByActId,
		selectedEntityId = null,
		weights,
		actPxWidths,
		trackWidthPx = 0,
		onSelectAct,
		onSelectScene,
		onWeightPreview,
		onWeightCommit
	}: Props = $props();

	// ── Break into scenes state ───────────────────────────────────────────────
	let expandingActId: string | null = $state(null);
	let sceneNamesInput = $state('');
	let savingScenes = $state(false);
	let sceneError: string | null = $state(null);

	function openSceneForm(actId: string) {
		expandingActId = actId;
		sceneNamesInput = '';
		sceneError = null;
	}

	function cancelSceneForm() {
		expandingActId = null;
		sceneNamesInput = '';
		sceneError = null;
	}

	async function saveScenes() {
		if (!expandingActId) return;
		const actId = expandingActId;
		const names = sceneNamesInput
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
		if (names.length === 0) {
			sceneError = 'Enter at least one scene name.';
			return;
		}

		savingScenes = true;
		sceneError = null;
		try {
			// Create scenes sequentially so positions are stable.
			for (let i = 0; i < names.length; i++) {
				await fetch('/api/entities', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ type: 'Scene', name: names[i], parentId: actId, position: i })
				}).then(async (res) => {
					if (!res.ok) throw new Error(await res.text());
				});
			}
			// Scene insert changes scene count m → server's recomputeIntervalsForAct
			// rewrites every interval anchored to scenes in this act, so the intervals
			// store needs to refresh too. The other 4 mutation sites in this file use
			// refreshTimelineStores() for the same reason.
			await refreshTimelineStores();
			expandingActId = null;
			sceneNamesInput = '';
		} catch (err) {
			sceneError = (err as Error).message;
		} finally {
			savingScenes = false;
		}
	}

	// ── Act-delete state ──────────────────────────────────────────────────────
	let deletingActId: string | null = $state(null);
	let deletingAct: Entity | null = $state(null);
	let deleteCount = $state(0);
	let deletingInProgress = $state(false);
	let deleteError: string | null = $state(null);
	// Reparent target — '__delete__' = cascade-delete scenes; otherwise an actId.
	let reparentTarget: string = $state('__delete__');

	const deletingSceneCount = $derived(
		deletingActId ? scenesByActId.get(deletingActId)?.length ?? 0 : 0
	);
	// Other root acts the user could move scenes into.
	const reparentCandidates = $derived(
		deletingActId ? acts.filter((a) => a.id !== deletingActId) : []
	);

	function openDeleteConfirm(act: Entity) {
		deletingAct = act;
		deletingActId = act.id;
		deleteError = null;
		// Default: if scenes exist and there are other acts, prefer the next
		// sibling as the reparent target. Otherwise default to delete.
		const sceneCount = scenesByActId.get(act.id)?.length ?? 0;
		const others = acts.filter((a) => a.id !== act.id);
		if (sceneCount > 0 && others.length > 0) {
			const idx = acts.findIndex((a) => a.id === act.id);
			reparentTarget = (acts[idx + 1] ?? acts[idx - 1] ?? others[0]).id;
		} else {
			reparentTarget = '__delete__';
		}
		deleteCount = $intervalsStore.filter(
			(iv) => iv.startActId === act.id || iv.endActId === act.id
		).length;
	}

	function cancelDelete() {
		deletingActId = null;
		deletingAct = null;
		deleteError = null;
	}

	async function confirmDelete() {
		if (!deletingActId) return;
		deletingInProgress = true;
		deleteError = null;
		try {
			const url =
				deletingSceneCount > 0 && reparentTarget !== '__delete__'
					? `/api/entities/${deletingActId}?moveScenesTo=${reparentTarget}`
					: `/api/entities/${deletingActId}`;
			const res = await fetch(url, { method: 'DELETE' });
			if (!res.ok) throw new Error(await res.text());
			// Reload both stores; interval CASCADE happens server-side.
			await refreshTimelineStores();
			deletingActId = null;
			deletingAct = null;
		} catch (err) {
			deleteError = (err as Error).message;
		} finally {
			deletingInProgress = false;
		}
	}

	// ── Insert-between state ──────────────────────────────────────────────────
	// `insertingAtIdx` is the position the new Act will get. Server-side
	// PATCH/POST cascades siblings >= position by +1. (D1/1A + D6/5A)
	let insertingAtIdx: number | null = $state(null);
	let insertName = $state('');
	let savingInsert = $state(false);
	let insertError: string | null = $state(null);

	function openInsertAt(idx: number) {
		insertingAtIdx = idx;
		insertName = '';
		insertError = null;
	}
	function cancelInsert() {
		insertingAtIdx = null;
		insertName = '';
		insertError = null;
	}
	async function commitInsert() {
		if (insertingAtIdx == null) return;
		const name = insertName.trim();
		if (!name || savingInsert) return;
		savingInsert = true;
		insertError = null;
		try {
			const res = await fetch('/api/entities', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: 'Act', name, position: insertingAtIdx })
			});
			if (!res.ok) throw new Error(await res.text());
			await refreshTimelineStores();
			insertingAtIdx = null;
			insertName = '';
		} catch (err) {
			insertError = (err as Error).message;
		} finally {
			savingInsert = false;
		}
	}
	function handleInsertKey(e: KeyboardEvent) {
		if (e.key === 'Enter') commitInsert();
		if (e.key === 'Escape') cancelInsert();
	}

	// ── Act drag-reorder ──────────────────────────────────────────────────────
	const ACT_MIME = 'application/x-betwixt-act-reorder';
	const SCENE_MIME = 'application/x-betwixt-scene-move';

	let dragActId: string | null = $state(null);
	let actDropTarget: { idx: number; side: 'left' | 'right' } | null = $state(null);
	let keyboardActOrder: string[] | null = $state(null);
	let keyboardActPending = 0;
	let keyboardActTail: Promise<void> = Promise.resolve();
	let reorderError: string | null = $state(null);
	const reorderErrorToast = createAutoDismiss((msg) => {
		reorderError = msg;
	});
	onDestroy(() => reorderErrorToast.cancel());

	function actDragStart(e: DragEvent, actId: string) {
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData(ACT_MIME, actId);
		e.dataTransfer.setData('text/plain', actId);
		dragActId = actId;
	}
	function actDragEnd() {
		dragActId = null;
		actDropTarget = null;
	}
	function actDragOver(e: DragEvent, idx: number) {
		if (!e.dataTransfer?.types.some((t) => t.toLowerCase() === ACT_MIME)) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const side: 'left' | 'right' = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
		actDropTarget = { idx, side };
	}
	async function moveAct(actId: string, targetPos: number) {
		const movedFromIdx = acts.findIndex((act) => act.id === actId);
		if (movedFromIdx < 0) return;
		try {
			const res = await fetch(`/api/entities/${actId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ position: targetPos })
			});
			if (!res.ok) throw new Error(await res.text());
			await refreshTimelineStores();
		} catch (err) {
			reorderErrorToast.show((err as Error).message);
		}
	}
	function moveActWithKeyboard(e: KeyboardEvent, actId: string) {
		if (e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
		e.preventDefault();
		const order = keyboardActOrder ??= acts.map((act) => act.id);
		const from = order.indexOf(actId);
		if (from < 0) return;
		const target = Math.max(0, Math.min(acts.length - 1, from + (e.key === 'ArrowLeft' ? -1 : 1)));
		if (target === from) return;
		order.splice(target, 0, order.splice(from, 1)[0]);
		keyboardActPending++;
		const request = keyboardActTail.then(() => moveAct(actId, target));
		const tail = request.catch(() => {});
		keyboardActTail = tail;
		void tail.finally(() => {
			if (--keyboardActPending === 0) keyboardActOrder = null;
		});
	}
	async function actDrop(e: DragEvent, idx: number) {
		if (!e.dataTransfer?.types.some((t) => t.toLowerCase() === ACT_MIME)) return;
		e.preventDefault();
		const movedId = e.dataTransfer.getData(ACT_MIME);
		const target = actDropTarget ?? { idx, side: 'left' as const };
		actDropTarget = null;
		dragActId = null;
		if (!movedId) return;
		const movedFromIdx = acts.findIndex((a) => a.id === movedId);
		if (movedFromIdx < 0) return;
		// Convert (idx, side) into a target position. When moving rightward,
		// removal of the moved item from the front shifts indices by one.
		let targetPos = target.side === 'left' ? target.idx : target.idx + 1;
		if (movedFromIdx < targetPos) targetPos -= 1;
		if (targetPos === movedFromIdx) return; // no-op
		await moveAct(movedId, targetPos);
	}

	// ── Scene drag-reorder + cross-act move ──────────────────────────────────
	let dragSceneId: string | null = $state(null);
	let sceneDropTarget: { actId: string; idx: number } | null = $state(null);
	let keyboardSceneOrder: Map<string, string[]> | null = $state(null);
	let keyboardScenePending = 0;
	let keyboardSceneTail: Promise<void> = Promise.resolve();

	function sceneDragStart(e: DragEvent, sceneId: string) {
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData(SCENE_MIME, sceneId);
		e.dataTransfer.setData('text/plain', sceneId);
		dragSceneId = sceneId;
	}
	function sceneDragEnd() {
		dragSceneId = null;
		sceneDropTarget = null;
	}
	function sceneActDragOver(e: DragEvent, actId: string) {
		if (!e.dataTransfer?.types.some((t) => t.toLowerCase() === SCENE_MIME)) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		const list = scenesByActId.get(actId) ?? [];
		const container = e.currentTarget as HTMLElement;
		const rect = container.getBoundingClientRect();
		const relX = e.clientX - rect.left;
		const cellWidth = list.length > 0 ? rect.width / list.length : rect.width;
		const idx = Math.max(0, Math.min(Math.floor(relX / cellWidth + 0.5), list.length));
		sceneDropTarget = { actId, idx };
	}
	async function moveScene(sceneId: string, targetActId: string, targetPos: number, restoreFocus = false) {
		const focusOwner = restoreFocus && document.activeElement instanceof HTMLElement &&
			document.activeElement.dataset.entityId === sceneId
			? document.activeElement
			: null;
		try {
			const res = await fetch(`/api/entities/${sceneId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ parentId: targetActId, position: targetPos })
			});
			if (!res.ok) throw new Error(await res.text());
			await refreshTimelineStores();
			if (focusOwner) {
				await tick();
				if (document.activeElement === document.body || document.activeElement === focusOwner) {
					[...document.querySelectorAll<HTMLElement>('.scene-cell')]
						.find((element) => element.dataset.entityId === sceneId)
						?.focus();
				}
			}
		} catch (err) {
			reorderErrorToast.show((err as Error).message);
		}
	}
	function onSceneKeydown(e: KeyboardEvent, scene: Entity) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelectScene?.(scene.id);
			return;
		}
		if (!e.altKey || e.ctrlKey || e.metaKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
		e.preventDefault();
		const order = keyboardSceneOrder ??= new Map(
			acts.map((act) => [act.id, (scenesByActId.get(act.id) ?? []).map((item) => item.id)])
		);
		const currentActIdx = acts.findIndex((act) => order.get(act.id)?.includes(scene.id));
		const source = order.get(acts[currentActIdx]?.id) ?? [];
		const currentSceneIdx = source.indexOf(scene.id);
		if (currentActIdx < 0 || currentSceneIdx < 0) return;
		let targetActIdx = currentActIdx;
		let targetSceneIdx = currentSceneIdx;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			targetSceneIdx = Math.max(0, Math.min(source.length - 1, currentSceneIdx + (e.key === 'ArrowLeft' ? -1 : 1)));
		} else {
			targetActIdx = currentActIdx + (e.key === 'ArrowUp' ? -1 : 1);
			const targetAct = acts[targetActIdx];
			if (!targetAct) return;
			targetSceneIdx = Math.min(currentSceneIdx, order.get(targetAct.id)?.length ?? 0);
		}
		if (targetActIdx === currentActIdx && targetSceneIdx === currentSceneIdx) return;
		source.splice(currentSceneIdx, 1);
		const targetActId = acts[targetActIdx].id;
		(order.get(targetActId) ?? source).splice(targetSceneIdx, 0, scene.id);
		keyboardSceneOrder = new Map(order);
		keyboardScenePending++;
		const request = keyboardSceneTail.then(() => moveScene(scene.id, targetActId, targetSceneIdx, true));
		const tail = request.catch(() => {});
		keyboardSceneTail = tail;
		void tail.finally(() => {
			if (--keyboardScenePending === 0) keyboardSceneOrder = null;
		});
	}
	function scenePositionLabel(scene: Entity): string {
		const order = keyboardSceneOrder;
		const actIdx = acts.findIndex((act) => (order?.get(act.id) ?? scenesByActId.get(act.id) ?? []).some((item) =>
			typeof item === 'string' ? item === scene.id : item.id === scene.id
		));
		const siblings = order?.get(acts[actIdx]?.id) ?? (scenesByActId.get(acts[actIdx]?.id) ?? []).map((item) => item.id);
		return `${acts[actIdx]?.name ?? 'Unknown act'}, scene ${siblings.indexOf(scene.id) + 1} of ${siblings.length}`;
	}
	async function sceneActDrop(e: DragEvent, actId: string) {
		if (!e.dataTransfer?.types.some((t) => t.toLowerCase() === SCENE_MIME)) return;
		e.preventDefault();
		const movedId = e.dataTransfer.getData(SCENE_MIME);
		const target = sceneDropTarget ?? { actId, idx: scenesByActId.get(actId)?.length ?? 0 };
		sceneDropTarget = null;
		dragSceneId = null;
		if (!movedId) return;
		const moved = $entities.find((x) => x.id === movedId);
		if (!moved) return;
		let targetPos = target.idx;
		if (moved.parentId === target.actId) {
			// Same-act reorder: account for the moved scene being removed
			// from its current position before reinsertion.
			const fromIdx = (scenesByActId.get(target.actId) ?? []).findIndex(
				(s) => s.id === movedId
			);
			if (fromIdx >= 0 && fromIdx < targetPos) targetPos -= 1;
			if (targetPos === fromIdx) return;
		}
		await moveScene(movedId, target.actId, targetPos);
	}

	// ── Act-width resize ─────────────────────────────────────────────────────
	/* Drag handle on the right edge of each act header (except last) shifts
	   flex weight from the right neighbor to this act (or vice versa).
	   Total weight is preserved so other acts don't reflow. */
	let widthDrag: {
		idx: number;
		startX: number;
		startWeights: number[];
	} | null = $state(null);

	function startWidthDrag(e: PointerEvent, idx: number) {
		if (!weights || idx >= weights.length - 1) return;
		e.preventDefault();
		e.stopPropagation();
		widthDrag = {
			idx,
			startX: e.clientX,
			startWeights: [...weights]
		};
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}

	/* Pixel floor that matches the CSS min-width on .act-col-header and
	   .scenes-act below. Keeping JS + CSS in sync prevents the scenes row
	   from shrinking past where the act header stops (scenes have lower
	   natural min-content than the padded act header, so without an
	   explicit floor on both the rows desync visually). */
	const MIN_ACT_PX = 60;

	function moveWidthDrag(e: PointerEvent) {
		if (!widthDrag || !weights || trackWidthPx === 0) return;
		const dx = e.clientX - widthDrag.startX;
		const totalWeight = widthDrag.startWeights.reduce((a, b) => a + b, 0);
		// One pixel of drag = totalWeight / trackWidthPx in weight units.
		const deltaWeight = (dx / trackWidthPx) * totalWeight;
		const i = widthDrag.idx;
		const wi = widthDrag.startWeights[i] + deltaWeight;
		const wj = widthDrag.startWeights[i + 1] - deltaWeight;
		// Floor in weight units = floor in pixels mapped back via
		// totalWeight/trackWidthPx. Stays consistent with the CSS min-width.
		const minWeight = (MIN_ACT_PX / trackWidthPx) * totalWeight;
		if (wi < minWeight || wj < minWeight) return;
		onWeightPreview?.({
			[acts[i].id]: wi,
			[acts[i + 1].id]: wj
		});
	}

	function endWidthDrag(e: PointerEvent) {
		if (!widthDrag || !weights) return;
		const i = widthDrag.idx;
		const updates: Record<string, number> = {};
		if (Math.abs(weights[i] - widthDrag.startWeights[i]) > 1e-6) {
			updates[acts[i].id] = weights[i];
		}
		if (Math.abs(weights[i + 1] - widthDrag.startWeights[i + 1]) > 1e-6) {
			updates[acts[i + 1].id] = weights[i + 1];
		}
		widthDrag = null;
		(e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
		if (Object.keys(updates).length > 0) {
			onWeightCommit?.(updates);
		}
	}

	function resizeActWithKeyboard(e: KeyboardEvent, idx: number) {
		if (e.altKey || e.ctrlKey || e.metaKey || !weights || trackWidthPx === 0 || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
		e.preventDefault();
		const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
		const minWeight = (MIN_ACT_PX / trackWidthPx) * totalWeight;
		const delta = totalWeight * 0.025 * (e.key === 'ArrowLeft' ? -1 : 1);
		const pairWeight = weights[idx] + weights[idx + 1];
		if (
			(weights[idx] < minWeight && delta < 0) ||
			(weights[idx] > pairWeight - minWeight && delta > 0)
		) return;
		const left = Math.max(minWeight, Math.min(pairWeight - minWeight, weights[idx] + delta));
		const right = pairWeight - left;
		const updates = { [acts[idx].id]: left, [acts[idx + 1].id]: right };
		onWeightPreview?.(updates);
		pendingKeyboardWeightCommit = { ...pendingKeyboardWeightCommit, ...updates };
		if (keyboardWeightCommitTimer) clearTimeout(keyboardWeightCommitTimer);
		keyboardWeightCommitTimer = setTimeout(flushKeyboardWeightCommit, 150);
	}
	let keyboardWeightCommitTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingKeyboardWeightCommit: Record<string, number> | null = null;
	function flushKeyboardWeightCommit() {
		if (keyboardWeightCommitTimer) clearTimeout(keyboardWeightCommitTimer);
		keyboardWeightCommitTimer = null;
		if (pendingKeyboardWeightCommit) onWeightCommit?.(pendingKeyboardWeightCommit);
		pendingKeyboardWeightCommit = null;
	}
	onDestroy(flushKeyboardWeightCommit);
</script>

<div class="acts-header">
	{#each acts as act, actIdx (act.id)}
		{@const sceneCount = scenesByActId.get(act.id)?.length ?? 0}
		{@const totalWeight = weights?.reduce((sum, weight) => sum + weight, 0) ?? 0}
		{@const pairWeight = (weights?.[actIdx] ?? 0) + (weights?.[actIdx + 1] ?? 0)}
		{@const minWidthPercent = weights && trackWidthPx > 0 && pairWeight > 0
			? Math.ceil(MIN_ACT_PX / trackWidthPx * totalWeight / pairWeight * 100)
			: 0}
		{@const currentWidthPercent = Math.max(minWidthPercent, Math.min(
			100 - minWidthPercent,
			Math.round(weights && pairWeight > 0 ? weights[actIdx] / pairWeight * 100 : 50)
		))}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="act-col-header"
			data-entity-id={act.id}
			class:act-col-header--selected={selectedEntityId === act.id}
			class:act-col-header--dragging={dragActId === act.id}
			class:act-drop-left={actDropTarget?.idx === actIdx && actDropTarget?.side === 'left' && dragActId !== act.id}
			class:act-drop-right={actDropTarget?.idx === actIdx && actDropTarget?.side === 'right' && dragActId !== act.id}
			style={actPxWidths?.[actIdx] != null
				? `flex: 0 0 ${actPxWidths[actIdx]}px;`
				: `flex: ${weights?.[actIdx] ?? 1};`}
			ondragover={(e) => actDragOver(e, actIdx)}
			ondrop={(e) => actDrop(e, actIdx)}
			ondragleave={() => { if (actDropTarget?.idx === actIdx) actDropTarget = null; }}
			onclick={(e) => {
				/* Don't hijack clicks on inner buttons, inputs, textareas, the drag grip, or width-resize handle. */
				const t = e.target as HTMLElement;
				if (t.closest('button, input, textarea, .act-grip, .insert-overlay, .width-handle')) return;
				onSelectAct?.(act.id);
			}}
		>
			{#if actIdx < acts.length - 1 && minWidthPercent < 50}
				<!-- Right-edge handle for resizing this act vs. its neighbor. Hidden until hover. -->
					<div
						class="width-handle"
						class:dragging={widthDrag?.idx === actIdx}
						title="Drag to resize {act.name}"
						role="slider"
						aria-orientation="horizontal"
						aria-label="Width of {act.name} relative to {acts[actIdx + 1].name}"
						aria-valuemin={minWidthPercent}
						aria-valuemax={100 - minWidthPercent}
						aria-valuenow={currentWidthPercent}
						tabindex="0"
						onpointerdown={(e) => startWidthDrag(e, actIdx)}
						onpointermove={moveWidthDrag}
						onpointerup={endWidthDrag}
						onkeydown={(e) => resizeActWithKeyboard(e, actIdx)}
					></div>
			{/if}
			<!-- Insert-between overlay on the act's LEFT boundary. Absolute so it doesn't take flex space (D6/5A). -->
			<div class="insert-overlay" class:active={insertingAtIdx === actIdx}>
				{#if insertingAtIdx === actIdx}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="insert-input"
						type="text"
						placeholder="Act name"
						bind:value={insertName}
						onkeydown={handleInsertKey}
						onblur={() => { if (!savingInsert && !insertName.trim()) cancelInsert(); }}
						disabled={savingInsert}
						autofocus
						aria-label="Insert act before {act.name}"
					/>
					{#if insertError}<div class="insert-error">{insertError}</div>{/if}
				{:else}
					<button
						class="insert-btn"
						aria-label="Insert act before {act.name}"
						title="Insert act before {act.name}"
						onclick={(e) => { e.stopPropagation(); openInsertAt(actIdx); }}
					>+</button>
				{/if}
			</div>

			<div class="act-col-content">
				<div class="act-name-row">
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span
						class="act-grip"
						role="slider"
						tabindex="0"
						aria-label="Reorder {act.name} with left and right arrow keys"
						aria-orientation="horizontal"
						aria-valuemin={1}
						aria-valuemax={acts.length}
						aria-valuenow={(keyboardActOrder?.indexOf(act.id) ?? actIdx) + 1}
						title="Drag or use arrow keys to reorder"
						draggable="true"
						ondragstart={(e) => actDragStart(e, act.id)}
						ondragend={actDragEnd}
						onkeydown={(e) => moveActWithKeyboard(e, act.id)}
					>⋮⋮</span>
					<button class="act-name" onclick={() => onSelectAct?.(act.id)}>{act.name}</button>
					<button
						class="act-delete-btn"
						aria-label="Delete {act.name}"
						title="Delete act"
						onclick={() => openDeleteConfirm(act)}
					>×</button>
				</div>

			{#if deletingActId === act.id && deletingAct}
				<div class="delete-confirm">
					<span class="delete-confirm-msg">
						Delete <strong>{deletingAct.name}</strong>?
						{#if deleteCount > 0}
							This removes {deleteCount} interval{deleteCount === 1 ? '' : 's'}.
						{/if}
					</span>
					{#if deletingSceneCount > 0 && reparentCandidates.length > 0}
						<div class="reparent-picker">
							<div class="reparent-label">
								Move {deletingSceneCount} scene{deletingSceneCount === 1 ? '' : 's'} to:
							</div>
							{#each reparentCandidates as cand (cand.id)}
								<label class="reparent-opt">
									<input
										type="radio"
										name="reparent-{act.id}"
										value={cand.id}
										bind:group={reparentTarget}
										disabled={deletingInProgress}
									/>
									<span>{cand.name}</span>
								</label>
							{/each}
							<label class="reparent-opt reparent-opt--danger">
								<input
									type="radio"
									name="reparent-{act.id}"
									value="__delete__"
									bind:group={reparentTarget}
									disabled={deletingInProgress}
								/>
								<span>Delete scenes too</span>
							</label>
						</div>
					{/if}
					<div class="delete-confirm-btns">
						<button
							class="btn-danger"
							onclick={confirmDelete}
							disabled={deletingInProgress}
						>{deletingInProgress ? '…' : 'Delete'}</button>
						<button class="btn-cancel" onclick={cancelDelete} disabled={deletingInProgress}>Cancel</button>
					</div>
					{#if deleteError}<div class="scene-error">{deleteError}</div>{/if}
				</div>
			{:else if expandingActId === act.id}
				<div class="scene-form">
					<textarea
						class="scene-textarea"
						bind:value={sceneNamesInput}
						placeholder="One scene name per line"
						rows="3"
						disabled={savingScenes}
					></textarea>
					{#if sceneError}<div class="scene-error">{sceneError}</div>{/if}
					<div class="scene-form-btns">
						<button class="btn-save" onclick={saveScenes} disabled={savingScenes}>
							{savingScenes ? 'Saving…' : 'Save scenes'}
						</button>
						<button class="btn-cancel" onclick={cancelSceneForm} disabled={savingScenes}>Cancel</button>
					</div>
				</div>
			{:else}
				<div class="act-meta">
					{#if sceneCount > 0}
						{sceneCount} scene{sceneCount === 1 ? '' : 's'}
					{:else}
						<button class="break-btn" onclick={() => openSceneForm(act.id)}>
							Break into scenes
						</button>
					{/if}
				</div>
			{/if}
			</div>
		</div>
	{/each}

	{#if acts.length === 0}
		<div class="acts-empty">No acts yet. Click + Act to begin your story.</div>
	{/if}
</div>


{#if acts.length > 0}
	<div class="scenes-row">
		{#each acts as act, sceneActIdx (act.id)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="scenes-act"
				data-act-id={act.id}
				class:scenes-act--drop={sceneDropTarget?.actId === act.id}
				style={actPxWidths?.[sceneActIdx] != null
					? `flex: 0 0 ${actPxWidths[sceneActIdx]}px;`
					: `flex: ${weights?.[sceneActIdx] ?? 1};`}
				ondragover={(e) => sceneActDragOver(e, act.id)}
				ondrop={(e) => sceneActDrop(e, act.id)}
				ondragleave={() => { if (sceneDropTarget?.actId === act.id) sceneDropTarget = null; }}
			>
				{#if (scenesByActId.get(act.id)?.length ?? 0) > 0}
					{#each scenesByActId.get(act.id)! as scene, k (scene.id)}
						<div
							class="scene-cell"
							role="button"
							tabindex="0"
							aria-label="Select {scene.name}. {scenePositionLabel(scene)}. Alt plus left and right reorders; Alt plus up and down moves between acts."
							data-entity-id={scene.id}
							class:scene-cell--selected={selectedEntityId === scene.id}
							class:scene-cell--dragging={dragSceneId === scene.id}
							title={scene.name}
							draggable="true"
							ondragstart={(e) => sceneDragStart(e, scene.id)}
							ondragend={sceneDragEnd}
							onclick={() => onSelectScene?.(scene.id)}
							onkeydown={(e) => onSceneKeydown(e, scene)}
						>s{k + 1}</div>
					{/each}
				{:else}
					<div class="scenes-act-empty">· · · · ·</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

{#if reorderError}
	<div class="reorder-error" role="alert">{reorderError}</div>
{/if}

<style>
	.acts-header {
		display: flex;
		min-height: 56px;
		background: var(--color-surface-2, #1c1f28);
		border-bottom: 1px solid var(--color-border, #2a2d35);
		align-items: stretch;
		/* Mirror .rows' scrollbar-gutter reservation so act columns end at
		   the same x as the bars below. --tl-gutter is set by Timeline.svelte. */
		padding-right: var(--tl-gutter, 0px);
		box-sizing: border-box;
	}

	/* Insert-between overlay — absolute child of each act-col-header, positioned over the LEFT boundary so it doesn't take flex space. */
	.insert-overlay {
		position: absolute;
		top: 0;
		left: -12px;
		bottom: 0;
		width: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		/* Sits above .width-handle (z-index: 6) on the previous column so
		   the + isn't covered when the two affordances meet at a boundary. */
		z-index: 10;
		pointer-events: auto;
	}
	.insert-overlay.active {
		width: 160px;
		left: -80px;
		background: var(--color-surface-2, #1c1f28);
	}
	.insert-btn {
		opacity: 0;
		background: var(--color-surface, #161920);
		border: 1px dashed var(--color-text-muted, #6b7280);
		color: var(--color-text-muted, #6b7280);
		border-radius: 4px;
		font-size: 14px;
		line-height: 1;
		padding: 0;
		width: 24px;
		height: 24px;
		cursor: pointer;
		transition: opacity 0.12s, color 0.12s, border-color 0.12s;
	}
	.insert-overlay:hover .insert-btn {
		opacity: 1;
	}
	.insert-btn:focus-visible {
		opacity: 1;
	}
	.insert-btn:hover {
		color: var(--color-accent, #c8942a);
		border-color: var(--color-accent, #c8942a);
	}
	.insert-input {
		width: 100%;
		background: var(--color-surface, #161920);
		color: var(--color-text, #e8e0d0);
		border: 1px solid var(--color-accent, #c8942a);
		border-radius: 4px;
		padding: 4px 6px;
		font-family: var(--font-display, 'Fraunces', Georgia, serif);
		font-size: 13px;
		outline: none;
	}
	.insert-error {
		position: absolute;
		bottom: -14px;
		left: 0;
		right: 0;
		font-size: 10px;
		color: #ef4444;
		text-align: center;
	}
	.act-col-header {
		position: relative;
	}
	.act-col-header {
		border-right: 1px solid var(--color-border, #2a2d35);
		border-top: 2px solid transparent;
		padding: 8px 14px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		cursor: pointer;
		/* Override flex's default min-width: auto so the column actually
		   shrinks to its flex-allocated width. Without this, intrinsic
		   min-content (~87px from the Fraunces title + grip + delete +
		   "Break into scenes" link) pins the column wider than its flex
		   share, while .scenes-act below it (no padding, just s0/s1 text)
		   shrinks to the lower flex share. The two rows desync by exactly
		   that gap. The visual minimum is now enforced by the JS
		   MIN_ACT_PX clamp in moveWidthDrag instead. */
		min-width: 0;
		box-sizing: border-box;
		/* overflow stays visible so the absolute .insert-overlay can
		   straddle the left edge into the previous column. The inner
		   .act-col-content (added below) clips the flow content. */
	}
	.act-col-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		min-width: 0;
		overflow: hidden;
	}
	.act-col-header--selected {
		border-top-color: var(--color-accent, #c8942a);
		background: rgba(200, 148, 42, 0.04);
	}
	.act-col-header:last-child {
		border-right: none;
	}

	.act-name-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex: 1;
		gap: 6px;
		/* Break the min-content propagation chain so the parent
		   .act-col-header can actually shrink to its flex allocation. */
		min-width: 0;
	}
	.act-grip {
		opacity: 0;
		cursor: grab;
		color: var(--color-text-muted, #6b7280);
		font-size: 12px;
		letter-spacing: -1px;
		user-select: none;
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
		transition: opacity 0.15s, color 0.15s;
	}
	.act-col-header:hover .act-grip {
		opacity: 0.7;
	}
	.act-grip:focus-visible {
		opacity: 1;
	}
	.act-grip:hover {
		opacity: 1 !important;
		color: var(--color-text, #e8e0d0);
	}
	.act-grip:active {
		cursor: grabbing;
	}
	.act-col-header--dragging {
		opacity: 0.5;
	}
	.act-col-header.act-drop-left {
		box-shadow: inset 3px 0 0 var(--color-accent, #c8942a);
	}
	.act-col-header.act-drop-right {
		box-shadow: inset -3px 0 0 var(--color-accent, #c8942a);
	}

	/* Right-edge width-resize handle. Hidden by default; revealed on
	   act-col-header hover. Sits above the inset border so the cursor wins. */
	.width-handle {
		position: absolute;
		top: 0;
		right: -12px;
		bottom: 0;
		width: 24px;
		cursor: ew-resize;
		z-index: 6;
		opacity: 0;
		transition: opacity 0.12s ease;
	}
	.act-col-header:hover .width-handle,
	.width-handle.dragging,
	.width-handle:focus-visible {
		opacity: 1;
	}
	.width-handle::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 11px;
		width: 2px;
		background: rgba(200, 148, 42, 0.55);
	}
	.act-name {
		background: none;
		border: 0;
		padding: 0;
		font-family: var(--font-display, 'Fraunces', Georgia, serif);
		font-size: 17px;
		font-weight: 500;
		color: var(--color-text, #e8e0d0);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}
	.act-delete-btn {
		background: none;
		border: none;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		font-size: 15px;
		line-height: 1;
		width: 24px;
		height: 24px;
		padding: 0;
		border-radius: 3px;
		flex-shrink: 0;
		opacity: 0;
		transition: opacity 0.15s, color 0.15s;
	}
	.act-col-header:hover .act-delete-btn {
		opacity: 1;
	}
	.act-delete-btn:focus-visible {
		opacity: 1;
	}
	.act-delete-btn:hover {
		color: #ef4444;
	}

	.act-meta {
		font-size: 11px;
		color: var(--color-text-muted, #6b7280);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: center;
	}

	.break-btn {
		display: block;
		width: 100%;
		text-align: center;
		background: none;
		border: none;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		font-size: 11px;
		padding: 0;
		font-family: inherit;
		text-decoration: underline dotted;
		transition: color 0.15s;
		/* min-width: 0 removes the flex automatic-min-size floor so the column can shrink; overflow + ellipsis handle visual truncation. */
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.break-btn:hover {
		color: var(--color-accent, #c8942a);
	}

	.scene-form {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.scene-textarea {
		background: var(--color-desktop, #0d0f14);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		color: var(--color-text, #e8e0d0);
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 12px;
		padding: 4px 6px;
		resize: none;
		width: 100%;
		box-sizing: border-box;
	}
	.scene-textarea:focus {
		outline: 2px solid var(--color-focus);
	}
	.scene-error {
		font-size: 11px;
		color: #ef4444;
	}
	.scene-form-btns {
		display: flex;
		gap: 6px;
	}

	.delete-confirm {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 4px 0;
	}
	.delete-confirm-msg {
		font-size: 11px;
		color: var(--color-text, #e8e0d0);
	}
	.delete-confirm-btns {
		display: flex;
		gap: 6px;
	}
	.reparent-picker {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 4px 0;
	}
	.reparent-label {
		font-size: 11px;
		color: var(--color-text-muted, #6b7280);
		margin-bottom: 2px;
	}
	.reparent-opt {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--color-text, #e8e0d0);
		cursor: pointer;
	}
	.reparent-opt input[type='radio'] {
		margin: 0;
		accent-color: var(--color-accent, #c8942a);
	}
	.reparent-opt--danger {
		color: #ef4444;
	}

	/* Shared button styles */
	.btn-save,
	.btn-danger {
		background: var(--color-accent, #c8942a);
		border: none;
		border-radius: 4px;
		color: #0d0f14;
		cursor: pointer;
		font-size: 11px;
		font-family: inherit;
		font-weight: 600;
		padding: 3px 8px;
		transition: opacity 0.15s;
	}
	.btn-danger {
		background: #ef4444;
		color: #fff;
	}
	.btn-save:disabled,
	.btn-danger:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn-cancel {
		background: none;
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		font-size: 11px;
		font-family: inherit;
		padding: 3px 8px;
	}
	.btn-cancel:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.acts-empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
	}

	.scenes-row {
		display: flex;
		height: 24px;
		background: var(--color-desktop, #0d0f14);
		border-bottom: 1px solid var(--color-border, #2a2d35);
		padding-right: var(--tl-gutter, 0px);
		box-sizing: border-box;
	}
	.scenes-act {
		flex: 1;
		border-right: 1px solid var(--color-border, #2a2d35);
		display: flex;
		/* Match .act-col-header's min-width: 0 + JS-enforced floor. */
		min-width: 0;
		box-sizing: border-box;
	}
	.scenes-act:last-child {
		border-right: none;
	}
	.scene-cell {
		flex: 1;
		border-right: 1px dashed rgba(42, 45, 53, 0.6);
		font-size: 10px;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.scene-cell:hover {
		color: var(--color-text, #e8e0d0);
	}
	.scene-cell--selected {
		color: var(--color-accent, #c8942a);
		background: rgba(200, 148, 42, 0.06);
	}
	.scene-cell--dragging {
		opacity: 0.4;
	}
	.scenes-act--drop {
		background: rgba(200, 148, 42, 0.1);
		outline: 1px dashed var(--color-accent, #c8942a);
		outline-offset: -1px;
	}
	.scene-cell:last-child {
		border-right: none;
	}
	.scenes-act-empty {
		flex: 1;
		font-size: 10px;
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
		opacity: 0.5;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.reorder-error {
		position: fixed;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		background: #ef4444;
		color: #fff;
		font-size: 12px;
		padding: 6px 12px;
		border-radius: 4px;
		z-index: 100;
		pointer-events: none;
	}
</style>
