// Shared story-structure derivations used by Timeline and PlayerDock. Both
// surfaces compute Acts / Scenes / scene boundaries / the "Act · Scene" label
// the same way; centralizing the logic keeps them from drifting.

import { get } from 'svelte/store';
import type { Entity } from '$lib/stores/entities.js';
import { playhead } from '$lib/stores/playhead.js';

const sortByPositionThenCreated = (a: Entity, b: Entity): number => {
	const ap = a.position ?? Number.MAX_SAFE_INTEGER;
	const bp = b.position ?? Number.MAX_SAFE_INTEGER;
	if (ap !== bp) return ap - bp;
	return Number(a.createdAt) - Number(b.createdAt);
};

/** Root-level Acts ordered by (position, createdAt) — matches server actIndexOf. */
export function getActs(entities: Entity[]): Entity[] {
	return entities
		.filter((e) => e.type === 'Act' && e.parentId == null)
		.sort(sortByPositionThenCreated);
}

/** Scenes grouped by parent Act id, each list sorted by (position, createdAt). */
export function getScenesByActId(entities: Entity[]): Map<string, Entity[]> {
	const m = new Map<string, Entity[]>();
	for (const e of entities) {
		if (e.type !== 'Scene' || !e.parentId) continue;
		if (!m.has(e.parentId)) m.set(e.parentId, []);
		m.get(e.parentId)!.push(e);
	}
	for (const list of m.values()) list.sort(sortByPositionThenCreated);
	return m;
}

/**
 * Sorted scene-granular snap positions: each act start, plus interior
 * fractional points (k/m for k=1..m-1) when the act has m≥2 scenes, plus
 * the final upper bound `acts.length`.
 */
export function getSceneBoundaries(
	acts: Entity[],
	scenesByActId: Map<string, Entity[]>
): number[] {
	const pts: number[] = [];
	acts.forEach((act, i) => {
		pts.push(i);
		const scenes = scenesByActId.get(act.id) ?? [];
		const m = scenes.length;
		for (let k = 1; k < m; k++) pts.push(i + k / m);
	});
	pts.push(acts.length);
	return pts;
}

/** Human-readable "Act · Scene N: name" for the current playhead position. */
export function getSpotlightLabel(
	playheadPos: number | null,
	acts: Entity[],
	scenesByActId: Map<string, Entity[]>
): string {
	if (playheadPos == null || acts.length === 0) return '';
	const actIdx = Math.max(0, Math.min(Math.floor(playheadPos), acts.length - 1));
	const act = acts[actIdx];
	const scenes = scenesByActId.get(act.id) ?? [];
	if (scenes.length === 0) return act.name;
	const f = playheadPos - actIdx;
	const sceneIdx = Math.min(Math.floor(f * scenes.length), scenes.length - 1);
	return `${act.name} · Scene ${sceneIdx + 1}: ${scenes[sceneIdx].name}`;
}

export function stepForwardScene(boundaries: number[], maxT: number): void {
	playhead.pause();
	const cur = get(playhead) ?? 0;
	const next = boundaries.find((b) => b > cur + 1e-9);
	if (next !== undefined) playhead.scrubTo(Math.min(next, maxT));
}

export function stepBackScene(boundaries: number[]): void {
	playhead.pause();
	const cur = get(playhead) ?? 0;
	const prev = [...boundaries].reverse().find((b) => b < cur - 1e-9);
	if (prev !== undefined) playhead.scrubTo(Math.max(prev, 0));
}
