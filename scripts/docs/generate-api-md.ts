// Regenerates docs/api.md from src/routes/api/**/+server.ts.
// Run: npm run docs:api
//
// Per-route MANUAL blocks (error responses, list bounds) are preserved
// across regenerations via sentinel markers. Re-running with unchanged
// sources produces byte-identical output.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManualBlocks, manualBlock, writeIfChanged } from './lib/sentinel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_DIR = path.join(ROOT, 'src/routes/api');
const OUT = path.join(ROOT, 'docs/api.md');

// Table-name → Drizzle TS identifier. Anything in this map and imported from
// $lib/server/db/schema.js by a route is reported as a touched table.
const KNOWN_TABLES: Record<string, string> = {
	entities: 'entities',
	relationships: 'relationships',
	canvasPositions: 'canvas_positions',
	windowCanvasState: 'window_canvas_state',
	intervals: 'intervals',
	entityAliases: 'entity_aliases',
	worldMaps: 'world_maps',
	mapRegions: 'map_regions',
	user: 'user',
	session: 'session',
	account: 'account',
	verification: 'verification'
};

// Known Cloudflare bindings (declared in wrangler.jsonc). A route touches a
// binding if it reads `event.platform?.env?.<NAME>` (or `platform.env.<NAME>`).
const KNOWN_BINDINGS = ['MAP_UPLOADS', 'ASSETS'];

interface RouteRow {
	route: string;
	methods: string[];
	tables: Record<string, Set<'r' | 'w'>>;
	bindings: string[];
}

function walk(dir: string, acc: string[] = []): string[] {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) walk(p, acc);
		else if (ent.isFile() && ent.name === '+server.ts') acc.push(p);
	}
	return acc;
}

function routePathOf(absPath: string): string {
	const rel = path.relative(API_DIR, path.dirname(absPath));
	return '/api' + (rel === '' ? '' : '/' + rel.split(path.sep).join('/'));
}

function parseRoute(absPath: string): RouteRow {
	const src = fs.readFileSync(absPath, 'utf8');
	const methods: string[] = [];
	for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
		if (new RegExp(`export const ${m}\\b`).test(src) || new RegExp(`export async function ${m}\\b`).test(src)) {
			methods.push(m);
		}
	}
	const tables: Record<string, Set<'r' | 'w'>> = {};
	for (const tsName of Object.keys(KNOWN_TABLES)) {
		if (!new RegExp(`\\b${tsName}\\b`).test(src)) continue;
		const reads = new RegExp(`\\.from\\(\\s*${tsName}\\s*[,)]`).test(src) || new RegExp(`\\.innerJoin!?\\(\\s*${tsName}`).test(src);
		const writes =
			new RegExp(`\\.insert\\(\\s*${tsName}\\s*\\)`).test(src) ||
			new RegExp(`\\.update\\(\\s*${tsName}\\s*\\)`).test(src) ||
			new RegExp(`\\.delete\\(\\s*${tsName}\\s*\\)`).test(src);
		if (!reads && !writes) continue;
		const set = new Set<'r' | 'w'>();
		if (reads) set.add('r');
		if (writes) set.add('w');
		tables[KNOWN_TABLES[tsName]] = set;
	}
	const bindings = KNOWN_BINDINGS.filter((b) =>
		new RegExp(`platform[^\\n]*\\.${b}\\b`).test(src) || new RegExp(`env[^\\n]*\\.${b}\\b`).test(src)
	);
	return {
		route: routePathOf(absPath),
		methods,
		tables,
		bindings
	};
}

function fmtTables(row: RouteRow): string {
	const entries = Object.entries(row.tables).sort(([a], [b]) => a.localeCompare(b));
	if (!entries.length) return '—';
	return entries.map(([name, rw]) => `${name} (${[...rw].sort().join('/')})`).join(', ');
}

function fmtBindings(row: RouteRow): string {
	return row.bindings.length ? row.bindings.join(', ') : '—';
}

function fmtRouteKey(row: RouteRow): string {
	return `${row.methods.join(',')} ${row.route}`;
}

function main() {
	const files = walk(API_DIR).sort();
	const rows = files.map(parseRoute);

	const existingManual = readManualBlocks(OUT);

	const header = [
		'# API routes',
		'',
		'_Generated from `src/routes/api/**/+server.ts`._',
		'_Regenerate: `npm run docs:api`. The generated table is overwritten on every run; per-route MANUAL blocks are preserved._',
		'',
		'See [architecture.md](architecture.md) for trust-boundary and request-lifecycle context. See [schema.md](schema.md) for table definitions.',
		'',
		'## Routes',
		'',
		'| Route | Methods | DB tables (r/w) | CF bindings |',
		'|---|---|---|---|'
	];
	const tableRows = rows.map((r) => `| \`${r.route}\` | ${r.methods.join(', ') || '—'} | ${fmtTables(r)} | ${fmtBindings(r)} |`);

	const annotationsHeader = [
		'',
		'## Route annotations (manual)',
		'',
		'Each block below is preserved across regenerations. Edit freely.',
		'Two fields per route:',
		'- **Error responses** — status codes returned besides 200 / 201.',
		'- **List bounds** — for list-returning GET endpoints, max page size or "unbounded".',
		''
	];

	const annotations: string[] = [];
	for (const r of rows) {
		const key = fmtRouteKey(r);
		annotations.push(`### \`${r.methods.join(', ')} ${r.route}\``);
		annotations.push('');
		annotations.push(
			manualBlock(
				key,
				existingManual,
				'\n- **Error responses:** _not documented_\n- **List bounds:** _n/a_\n'
			)
		);
		annotations.push('');
	}

	const out = [...header, ...tableRows, ...annotationsHeader, ...annotations].join('\n').replace(/\n{3,}/g, '\n\n');
	const result = writeIfChanged(OUT, out.endsWith('\n') ? out : out + '\n');
	console.log(`[docs:api] ${result} ${path.relative(ROOT, OUT)}`);
}

main();
