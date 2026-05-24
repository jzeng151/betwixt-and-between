// Pure helpers for converting a set of selected scene ids into the contiguous
// (startScene, endScene) intervals the API expects, and for expanding an
// interval back into its constituent scene ids. Extracted from WorldMap.svelte
// for testability; behavior must remain identical (scenesInInterval requires
// startActId == endActId — cross-act intervals collapse to empty per the
// existing UI invariant).

import type { Entity } from '$lib/stores/entities.js';
import type { Interval } from '$lib/features/timeline/intervals-store.js';

export type SceneRange = {
	startActId: string;
	startSceneId: string;
	endActId: string;
	endSceneId: string;
};

export function coalesceToRanges(
	selectedSceneIds: Set<string>,
	scenesByAct: Map<string, Entity[]>
): SceneRange[] {
	const ranges: SceneRange[] = [];
	for (const [actId, scenes] of scenesByAct) {
		const selected = scenes.filter((s) => selectedSceneIds.has(s.id));
		if (selected.length === 0) continue;
		let runStart = selected[0];
		let runEnd = selected[0];
		for (let i = 1; i < selected.length; i++) {
			const prevIdx = scenes.indexOf(runEnd);
			const currIdx = scenes.indexOf(selected[i]);
			if (currIdx === prevIdx + 1) {
				runEnd = selected[i];
			} else {
				ranges.push({
					startActId: actId,
					startSceneId: runStart.id,
					endActId: actId,
					endSceneId: runEnd.id
				});
				runStart = selected[i];
				runEnd = selected[i];
			}
		}
		ranges.push({
			startActId: actId,
			startSceneId: runStart.id,
			endActId: actId,
			endSceneId: runEnd.id
		});
	}
	return ranges;
}

export function scenesInInterval(
	iv: Interval,
	scenesByAct: Map<string, Entity[]>
): string[] {
	if (!iv.startSceneId || !iv.endSceneId || iv.startActId !== iv.endActId) return [];
	const scenes = scenesByAct.get(iv.startActId) ?? [];
	const startIdx = scenes.findIndex((s) => s.id === iv.startSceneId);
	const endIdx = scenes.findIndex((s) => s.id === iv.endSceneId);
	if (startIdx < 0 || endIdx < 0) return [];
	const lo = Math.min(startIdx, endIdx);
	const hi = Math.max(startIdx, endIdx);
	return scenes.slice(lo, hi + 1).map((s) => s.id);
}
