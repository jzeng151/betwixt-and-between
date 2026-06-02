// EditRelationshipModal — WM3 Slice 5 PR-B. Scene-level scope inputs.
// Pins the client-only logic that lives nowhere else (the integration test
// covers the server scene-equality math, not the modal):
//   - scene options are gated to the selected act (scenesForAct filter);
//   - changing the act clears the chosen scene (onchange reset) so a scene
//     whose parent act no longer matches is never forwarded;
//   - save forwards startSceneId/endSceneId, force-nulled when no act is set.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import EditRelationshipModal from '$lib/components/EditRelationshipModal.svelte';
import type { Relationship } from '$lib/stores/relationships.js';

const ACT0 = 'act-0';
const ACT1 = 'act-1';
const A0S1 = 'a0-s1';
const A1S0 = 'a1-s0';

const acts = [
	{ id: ACT0, name: 'Act 0', position: 0 },
	{ id: ACT1, name: 'Act 1', position: 1 }
];
const scenes = [
	{ id: 'a0-s0', name: 'A0S0', actId: ACT0, position: 0 },
	{ id: A0S1, name: 'A0S1', actId: ACT0, position: 1 },
	{ id: A1S0, name: 'A1S0', actId: ACT1, position: 0 }
];

function makeRel(over: Partial<Relationship> = {}): Relationship {
	return {
		id: 'r1',
		fromId: 'effect',
		toId: 'cause',
		type: 'caused_by',
		label: null,
		startActId: null,
		startSceneId: null,
		endActId: null,
		endSceneId: null,
		startPosition: null,
		endPosition: null,
		revealedAtPosition: null,
		...over
	};
}

function renderModal(rel: Relationship, onSave = vi.fn().mockResolvedValue(undefined)) {
	const r = render(EditRelationshipModal, {
		props: { relationship: rel, acts, scenes, onSave, onClose: vi.fn() }
	});
	return { ...r, onSave };
}

describe('EditRelationshipModal — scene scope (Slice 5 PR-B)', () => {
	beforeEach(() => cleanup());

	it('preselects the scoped scene and shows only the start act’s scenes', () => {
		const { getByLabelText } = renderModal(
			makeRel({ startActId: ACT0, startSceneId: A0S1, endActId: ACT0, endSceneId: A0S1 })
		);
		const startScene = getByLabelText('↳ start scene') as HTMLSelectElement;
		expect(startScene.value).toBe(A0S1);
		// Only act0's scenes + "Whole act" — act1's scene is absent.
		const opts = Array.from(startScene.options).map((o) => o.value);
		expect(opts).toEqual(['', 'a0-s0', A0S1]);
		expect(opts).not.toContain(A1S0);
	});

	it('changing the start act clears the previously chosen scene', async () => {
		const { getByLabelText } = renderModal(
			makeRel({ startActId: ACT0, startSceneId: A0S1, endActId: ACT0, endSceneId: A0S1 })
		);
		const startAct = getByLabelText('Starts') as HTMLSelectElement;
		await fireEvent.change(startAct, { target: { value: ACT1 } });
		const startScene = getByLabelText('↳ start scene') as HTMLSelectElement;
		// Reset to "Whole act"; now offers act1's scenes only.
		expect(startScene.value).toBe('');
		expect(Array.from(startScene.options).map((o) => o.value)).toEqual(['', A1S0]);
	});

	it('save forwards startSceneId / endSceneId', async () => {
		const { getByText, onSave } = renderModal(
			makeRel({ startActId: ACT0, startSceneId: A0S1, endActId: ACT0, endSceneId: A0S1 })
		);
		await fireEvent.click(getByText('Save'));
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(onSave.mock.calls[0][0]).toMatchObject({
			startActId: ACT0,
			startSceneId: A0S1,
			endActId: ACT0,
			endSceneId: A0S1
		});
	});

	it('no act selected: no scene row, save force-nulls the scene', async () => {
		const { getByText, queryByLabelText, onSave } = renderModal(makeRel());
		expect(queryByLabelText('↳ start scene')).toBeNull();
		await fireEvent.click(getByText('Save'));
		expect(onSave.mock.calls[0][0]).toMatchObject({
			startActId: null,
			startSceneId: null,
			endActId: null,
			endSceneId: null
		});
	});
});
