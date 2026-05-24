// Verifies that patches under patches/ landed on the installed node_modules
// files. Run in CI after `npm ci` so that a missing postinstall step, a
// dropped patches/ entry, or an svelte-pixi version bump produces a hard
// failure instead of a silent revert to the broken upstream behavior.
//
// Why hashes (not a softer presence check): the upstream defects we patch
// (Application teardown, Ticker null-guard — see
// docs/plans/world-map-v3-pre-slice-0-spike-findings.md § HMR teardown) are
// load-bearing for Slice 1's Pixi renderer. A drifted file should block
// merge, not warn.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

type PatchedFile = {
	path: string;
	expectedSha256: string;
	sentinel: string;
};

const ROOT = resolve(import.meta.dirname, '..');

const FILES: PatchedFile[] = [
	{
		path: 'node_modules/svelte-pixi/dist/svelte-5/Application.svelte',
		expectedSha256: '5e65cc5c83113cf671ecfb4fd22ffb85f7f8b23f5150dceebd36573af9ab5de8',
		sentinel: 'betwixt-and-between patch: upstream svelte-pixi@8.0.1 never calls'
	},
	{
		path: 'node_modules/svelte-pixi/dist/svelte-5/Ticker.svelte',
		expectedSha256: 'c118b48f2ee3e617135c43d409c2de02d0f0011f60bf9f20133c196399f31161',
		sentinel: 'betwixt-and-between patch: Pixi 8 Ticker.destroy() walks an internal'
	}
];

let failed = false;

for (const file of FILES) {
	const abs = resolve(ROOT, file.path);
	let contents: string;
	try {
		contents = readFileSync(abs, 'utf8');
	} catch {
		console.error(`FAIL  ${file.path}  (missing — did npm ci run?)`);
		failed = true;
		continue;
	}
	const actualSha = createHash('sha256').update(contents).digest('hex');
	const hasSentinel = contents.includes(file.sentinel);
	if (actualSha === file.expectedSha256 && hasSentinel) {
		console.log(`OK    ${file.path}`);
		continue;
	}
	failed = true;
	console.error(`FAIL  ${file.path}`);
	console.error(`        expected sha256: ${file.expectedSha256}`);
	console.error(`        actual sha256:   ${actualSha}`);
	console.error(`        sentinel found:  ${hasSentinel}`);
}

if (failed) {
	console.error('\nPatch verification failed. Run `npx patch-package svelte-pixi` to regenerate after intentional changes, or check that the postinstall hook ran.');
	process.exit(1);
}

console.log('\nAll patches verified.');
