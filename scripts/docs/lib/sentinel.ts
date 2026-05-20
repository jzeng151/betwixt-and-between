// Sentinel-block helpers for docs that mix generated + manual content.
//
// MANUAL blocks are extracted by key from the existing file and re-emitted
// verbatim on regeneration. If a key has no existing block, a stub is used.
// Re-running a generator on unchanged source produces byte-identical output.

import fs from 'node:fs';

const MANUAL_RE = /<!-- BEGIN MANUAL: (.+?) -->([\s\S]*?)<!-- END MANUAL: \1 -->/g;

export function readManualBlocks(path: string): Map<string, string> {
	if (!fs.existsSync(path)) return new Map();
	const text = fs.readFileSync(path, 'utf8');
	const blocks = new Map<string, string>();
	for (const m of text.matchAll(MANUAL_RE)) blocks.set(m[1], m[2]);
	return blocks;
}

export function manualBlock(
	key: string,
	existing: Map<string, string>,
	stub: string
): string {
	const body = existing.get(key) ?? stub;
	return `<!-- BEGIN MANUAL: ${key} -->${body}<!-- END MANUAL: ${key} -->`;
}

export function writeIfChanged(path: string, content: string): 'changed' | 'unchanged' {
	if (fs.existsSync(path) && fs.readFileSync(path, 'utf8') === content) return 'unchanged';
	fs.writeFileSync(path, content);
	return 'changed';
}
