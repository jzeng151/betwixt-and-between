<!--
  PlayerDock — Story Player transport. Mounted as its own floating window
  by WindowManager (appId 'story-player'). Activates the playhead on mount,
  dismisses it on unmount. Self-contained: derives scene boundaries from
  $entities so it can run independently of Timeline.
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { entities, type Entity } from '$lib/stores/entities.js';
	import { playhead, isPlaying, secondsPerScene } from '$lib/stores/playhead.js';
	import { windowStore } from '$lib/stores/windows.js';

	type Props = { winId: string; pinned: boolean };
	const { winId, pinned }: Props = $props();

	const SPEED_OPTIONS = [.5, 1, 2, 4, 8, 16];

	// Derive acts and scene boundaries from the entities store. Mirrors the
	// same logic Timeline uses (acts sorted by position, scenes grouped by
	// parent act). Boundaries: act starts + interior scene fractions + final.
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

	const scenesByActId = $derived.by(() => {
		const m = new Map<string, Entity[]>();
		for (const e of $entities) {
			if (e.type !== 'Scene' || !e.parentId) continue;
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
	});

	const maxT = $derived(acts.length);

	// Human-readable "Act · Scene" label for the current playhead position.
	const spotlightLabel = $derived.by(() => {
		if ($playhead == null || acts.length === 0) return '';
		const actIdx = Math.max(0, Math.min(Math.floor($playhead), acts.length - 1));
		const act = acts[actIdx];
		const scenes = scenesByActId.get(act.id) ?? [];
		if (scenes.length === 0) return act.name;
		const f = $playhead - actIdx;
		const sceneIdx = Math.min(Math.floor(f * scenes.length), scenes.length - 1);
		return `${act.name} · Scene ${sceneIdx + 1}: ${scenes[sceneIdx].name}`;
	});

	const sceneBoundaries = $derived.by(() => {
		const pts: number[] = [];
		acts.forEach((act, i) => {
			pts.push(i);
			const scenes = scenesByActId.get(act.id) ?? [];
			const m = scenes.length;
			for (let k = 1; k < m; k++) pts.push(i + k / m);
		});
		pts.push(acts.length);
		return pts;
	});

	// Activate the playhead when the dock opens; idle it when closed.
	onMount(() => {
		// Ensure entities are loaded so boundaries derive correctly. Cheap if
		// already loaded — the store dedupes.
		void entities.load();
		if ($playhead == null) playhead.scrubTo(0);
	});

	onDestroy(() => {
		// Minimize unmounts content via {#if !minimized} in Window.svelte, so
		// onDestroy fires on both close and minimize. Only dismiss when the
		// window has actually been removed from the store (real close) —
		// otherwise minimize would clear playback state.
		const stillOpen = get(windowStore).some((w) => w.id === winId);
		if (!stillOpen) playhead.dismiss();
	});

	function togglePlay() {
		if ($isPlaying) playhead.pause();
		else playhead.play(maxT, sceneBoundaries);
	}

	function stepForward() {
		playhead.pause();
		const cur = $playhead ?? 0;
		const next = sceneBoundaries.find((b) => b > cur + 1e-9);
		if (next !== undefined) playhead.scrubTo(Math.min(next, maxT));
	}

	function stepBack() {
		playhead.pause();
		const cur = $playhead ?? 0;
		const prev = [...sceneBoundaries].reverse().find((b) => b < cur - 1e-9);
		if (prev !== undefined) playhead.scrubTo(Math.max(prev, 0));
	}
</script>

<div class="player-shell">
<div class="player-label" aria-live="polite" title={spotlightLabel || ''}>
	{spotlightLabel || '—'}
</div>
<div class="player-dock" role="toolbar" aria-label="Story Player controls">
	<button
		class="dock-btn play-btn"
		class:playing={$isPlaying}
		title={$isPlaying ? 'Pause (Space)' : 'Play (Space)'}
		aria-label={$isPlaying ? 'Pause' : 'Play'}
		onclick={togglePlay}
	>{$isPlaying ? '⏸' : '▶'}</button>

	<button
		class="dock-btn"
		title="Step back one scene (←)"
		aria-label="Step back"
		onclick={stepBack}
	>⏮</button>

	<button
		class="dock-btn"
		title="Step forward one scene (→)"
		aria-label="Step forward"
		onclick={stepForward}
	>⏭</button>

	<label class="speed-wrap">
		<select
			class="speed-select"
			value={$secondsPerScene}
			onchange={(e) => secondsPerScene.set(Number((e.currentTarget as HTMLSelectElement).value))}
			aria-label="Playback speed"
		>
			{#each SPEED_OPTIONS as s}
				<option value={s}>{s}s/scene</option>
			{/each}
		</select>
	</label>

	<span class="dock-spacer"></span>

	<button
		class="dock-btn pin-btn"
		class:active={pinned}
		title={pinned ? 'Unpin from top' : 'Pin to top'}
		aria-label={pinned ? 'Unpin window' : 'Pin window on top'}
		aria-pressed={pinned}
		onclick={() => windowStore.togglePin(winId)}
	>📌</button>
</div>
</div>

<style>
	.player-shell {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--color-surface-2, #1c1f28);
	}
	.player-label {
		flex-shrink: 0;
		padding: 6px 12px 0;
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 11px;
		font-weight: 500;
		color: var(--color-text, #e8e0d0);
		letter-spacing: 0.02em;
		text-align: center;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.player-dock {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		padding: 0 10px;
	}

	.dock-btn {
		width: 24px;
		height: 24px;
		padding: 0;
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		background: transparent;
		color: var(--color-text-muted, #6b7280);
		font-size: 12px;
		line-height: 1;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: color 0.12s, border-color 0.12s, background 0.12s;
	}
	.dock-btn:hover {
		color: var(--color-text, #e8e0d0);
		border-color: var(--color-text-muted, #6b7280);
	}
	.dock-btn.play-btn {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		font-size: 14px;
	}
	.dock-btn.play-btn.playing {
		color: var(--color-accent, #c8942a);
		border-color: var(--color-accent, #c8942a);
		background: rgba(200, 148, 42, 0.08);
	}

	.speed-wrap {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-left: 4px;
	}
	.dock-spacer {
		flex: 1;
	}
	.dock-btn.pin-btn {
		font-size: 13px;
		filter: grayscale(1);
		opacity: 0.6;
	}
	.dock-btn.pin-btn.active {
		filter: none;
		opacity: 1;
		border-color: var(--color-accent, #c8942a);
		background: rgba(200, 148, 42, 0.1);
	}
	.speed-select {
		height: 26px;
		background: var(--color-surface, #161920);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		color: var(--color-text-muted, #6b7280);
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 11px;
		font-weight: 500;
		padding: 0 4px;
		cursor: pointer;
	}
</style>
