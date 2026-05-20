// Regenerates docs/edges.md from RelationshipType enum + edge-policy.ts.
// Run: npm run docs:edges
//
// Per-type endpoint shapes and temporal eligibility are sourced from the
// static ENDPOINT_MAP / TEMPORAL_MAP below — these reflect Phase 1 / Part A
// verification. Update them in this file when a new edge type lands.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManualBlocks, manualBlock, writeIfChanged } from './lib/sentinel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA = path.join(ROOT, 'src/lib/server/db/schema.ts');
const POLICY = path.join(ROOT, 'src/lib/graph/edge-policy.ts');
const OUT = path.join(ROOT, 'docs/edges.md');

const ENDPOINT_MAP: Record<string, string> = {
	appears_in: 'Character ↔ Act/Scene (legacy; writes blocked, see ADR-0002)',
	takes_place_at: 'Event → Location',
	caused_by: 'Event/Scene → Event/Scene  (from = effect, to = cause)',
	allied_with: 'Character ↔ Character',
	rivals: 'Character ↔ Character',
	mentor_of: 'Character → Character (mentor → mentee)',
	located_at: 'Character → Location',
	pov_of: 'Event/Scene → Character',
	note_of: 'Note → any entity',
	part_of: 'Location → Location (child → parent)',
	other: 'any ↔ any'
};

// "always-temporal" = bounds are required.  "sometimes" = user can attach
// bounds via the generic relationship UI. "never" = code path always writes
// null bounds (or write is blocked).
const TEMPORAL_MAP: Record<string, 'always' | 'sometimes' | 'never' | 'n/a'> = {
	appears_in: 'n/a',
	takes_place_at: 'sometimes',
	caused_by: 'sometimes',
	allied_with: 'sometimes',
	rivals: 'sometimes',
	mentor_of: 'sometimes',
	located_at: 'sometimes',
	pov_of: 'never',
	note_of: 'never',
	part_of: 'never',
	other: 'sometimes'
};

function parseEnum(src: string): string[] {
	const m = src.match(/export const RelationshipType\s*=\s*\[([\s\S]+?)\]\s*as const/);
	if (!m) throw new Error('Could not locate RelationshipType enum in schema.ts');
	return [...m[1].matchAll(/'([^']+)'/g)].map((mm) => mm[1]);
}

function parseDirection(src: string): Record<string, 'directed' | 'symmetric'> {
	const m = src.match(/DIRECTION:\s*Record<RelationshipType,\s*'directed'\s*\|\s*'symmetric'>\s*=\s*\{([\s\S]+?)\}/);
	if (!m) throw new Error('Could not locate DIRECTION map in edge-policy.ts');
	const map: Record<string, 'directed' | 'symmetric'> = {};
	for (const mm of m[1].matchAll(/(\w+):\s*'(directed|symmetric)'/g)) {
		map[mm[1]] = mm[2] as 'directed' | 'symmetric';
	}
	return map;
}

interface Hits {
	writes: string[];
	reads: string[];
}

function grepHits(rt: string): Hits {
	const writes: string[] = [];
	const reads: string[] = [];
	const stack: string[] = [path.join(ROOT, 'src')];
	while (stack.length) {
		const cur = stack.pop()!;
		for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
			const p = path.join(cur, ent.name);
			if (ent.isDirectory()) {
				if (ent.name === 'server' || /tests?/.test(ent.name)) {
					// Server modules can be both read+write; tests excluded.
					if (/tests?/.test(ent.name)) continue;
				}
				stack.push(p);
			} else if (/\.(ts|svelte)$/.test(ent.name)) {
				const src = fs.readFileSync(p, 'utf8');
				const rel = path.relative(ROOT, p);
				const lines = src.split('\n');
				lines.forEach((line, i) => {
					if (!line.includes(`'${rt}'`) && !line.includes(`"${rt}"`)) return;
					// Heuristic: write if line contains createRelationship( or
					// .insert(relationships) or .update(relationships) or
					// `type: '<rt>'` inside an insert .values(). Read otherwise.
					const isWriteCall = /createRelationship\s*\(/.test(line) || /\.insert\(\s*relationships\s*\)/.test(line) || /type:\s*['"]/.test(line);
					if (isWriteCall) writes.push(`${rel}:${i + 1}`);
					else reads.push(`${rel}:${i + 1}`);
				});
			}
		}
	}
	return { writes: dedupeShort(writes), reads: dedupeShort(reads) };
}

function dedupeShort(arr: string[]): string[] {
	// Keep distinct file paths, collapse multiple lines per file into "file:L1,L2".
	const m = new Map<string, number[]>();
	for (const x of arr) {
		const [file, line] = x.split(':');
		if (!m.has(file)) m.set(file, []);
		m.get(file)!.push(Number(line));
	}
	return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([f, ls]) => `${f}:${ls.join(',')}`);
}

function main() {
	const schemaSrc = fs.readFileSync(SCHEMA, 'utf8');
	const policySrc = fs.readFileSync(POLICY, 'utf8');
	const types = parseEnum(schemaSrc);
	const direction = parseDirection(policySrc);
	const existingManual = readManualBlocks(OUT);

	const header = [
		'# Relationship edges',
		'',
		'_Generated from `src/lib/server/db/schema.ts` (RelationshipType enum), `src/lib/graph/edge-policy.ts` (DIRECTION map), and static endpoint/temporal maps in `scripts/docs/generate-edges-md.ts`._',
		'_Regenerate: `npm run docs:edges`. Adding a new edge type: extend the static maps in the generator and re-run._',
		'',
		'See [schema.md](schema.md) for the `relationships` table and dedup indexes, and [architecture.md](architecture.md) for graph-traversal context.',
		'',
		'## Summary table',
		'',
		'| Type | Direction | Endpoints | Temporal | Cascade on endpoint delete |',
		'|---|---|---|---|---|'
	];

	for (const t of types) {
		header.push(
			`| \`${t}\` | ${direction[t] ?? '?'} | ${ENDPOINT_MAP[t] ?? '?'} | ${TEMPORAL_MAP[t] ?? '?'} | from/to → entities CASCADE; act/scene FKs → SET NULL |`
		);
	}
	header.push('');
	header.push('## Per-type detail');
	header.push('');

	for (const t of types) {
		const hits = grepHits(t);
		header.push(`### \`${t}\``);
		header.push('');
		header.push(`- **Direction:** ${direction[t] ?? '?'}`);
		header.push(`- **Endpoints:** ${ENDPOINT_MAP[t] ?? '?'}`);
		header.push(`- **Temporal eligibility:** ${TEMPORAL_MAP[t] ?? '?'}`);
		header.push(`- **Cascade:** from_id / to_id → \`entities\` ON DELETE CASCADE; bound act/scene FKs → ON DELETE SET NULL`);
		header.push('- **Write sites:**');
		if (hits.writes.length) for (const w of hits.writes) header.push(`  - \`${w}\``);
		else header.push('  - _none found_');
		header.push('- **Read sites:**');
		if (hits.reads.length) for (const r of hits.reads) header.push(`  - \`${r}\``);
		else header.push('  - _none found_');
		header.push('');
		header.push(manualBlock(t, existingManual, '\n_no additional notes_\n'));
		header.push('');
	}

	header.push('## Dedup-index resolution (from Part A verification)');
	header.push('');
	header.push('- `relationships_dedup` (migration `0000`) was a UNIQUE on `(from_id, to_id, type)`. It is **dropped** in migration `0002` (`DROP INDEX IF EXISTS "relationships_dedup"`).');
	header.push('- Replaced by two partial unique indexes:');
	header.push('  - `relationships_timeless_dedup` — UNIQUE`(from, to, type)` WHERE `start_position IS NULL`. At most one timeless edge per (pair, type).');
	header.push('  - `relationships_temporal_dedup` — UNIQUE`(from, to, type, start_position)` WHERE `start_position IS NOT NULL`. Temporal rows of the same (pair, type) may differ by start_position.');
	header.push('- `part_of` has an additional partial unique: `relationships_one_part_of_parent` UNIQUE`(user_id, from_id)` WHERE `type = \'part_of\'`. This is the final arbiter for the single-parent invariant; app-layer cycle / single-parent checks (`assertPartOfInvariants`) are racy under concurrent writes.');
	header.push('');

	const out = header.join('\n').replace(/\n{3,}/g, '\n\n');
	const result = writeIfChanged(OUT, out.endsWith('\n') ? out : out + '\n');
	console.log(`[docs:edges] ${result} ${path.relative(ROOT, OUT)}`);
}

main();
