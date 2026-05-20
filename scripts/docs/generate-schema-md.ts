// Regenerates docs/schema.md from src/lib/server/db/schema.ts + drizzle/*.sql.
// Run: npm run docs:schema
//
// Idempotent: re-running against unchanged sources produces byte-identical
// output. No manual-annotation block — schema.md is fully generated.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeIfChanged } from './lib/sentinel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA = path.join(ROOT, 'src/lib/server/db/schema.ts');
const MIGR_DIR = path.join(ROOT, 'drizzle');
const OUT = path.join(ROOT, 'docs/schema.md');

interface Table {
	tsName: string;
	dbName: string;
	leadingComment: string;
	body: string;
	tableExpr: string;
}

function parseSchema(src: string): Table[] {
	const tables: Table[] = [];
	const re = /export const (\w+) = pgTable\(\s*'([^']+)'\s*,\s*\{/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(src)) !== null) {
		const tsName = m[1];
		const dbName = m[2];
		const startOfDecl = src.lastIndexOf('export const', m.index);
		const leadingComment = grabLeadingComment(src, startOfDecl);
		// Walk balanced braces from the opening `{` of column block.
		const openBrace = src.indexOf('{', m.index + m[0].lastIndexOf('{'));
		let depth = 1;
		let i = openBrace + 1;
		while (i < src.length && depth > 0) {
			const c = src[i];
			if (c === '{') depth++;
			else if (c === '}') depth--;
			i++;
		}
		const body = src.slice(openBrace + 1, i - 1);
		// Optional table-expr (third arg): (table) => [ ... ]
		let tableExpr = '';
		const afterBody = src.slice(i);
		const teMatch = afterBody.match(/^\s*,\s*\(table\)\s*=>\s*\[/);
		if (teMatch) {
			const teStart = i + teMatch[0].length - 1;
			let bd = 1;
			let j = teStart + 1;
			while (j < src.length && bd > 0) {
				const c = src[j];
				if (c === '[') bd++;
				else if (c === ']') bd--;
				j++;
			}
			tableExpr = src.slice(teStart + 1, j - 1);
		}
		tables.push({ tsName, dbName, leadingComment, body, tableExpr });
	}
	return tables;
}

function grabLeadingComment(src: string, startIdx: number): string {
	let i = startIdx - 1;
	while (i > 0 && /[\s]/.test(src[i])) i--;
	if (i <= 1) return '';
	const end = i + 1;
	// Walk back through // lines OR /* */ block.
	if (src[i] === '/' && src[i - 1] === '*') {
		const open = src.lastIndexOf('/*', i);
		if (open === -1) return '';
		return src.slice(open, end).trim();
	}
	// Line comments — walk backwards line-by-line while each line starts with //.
	const lines: string[] = [];
	let lineEnd = end;
	while (lineEnd > 0) {
		const lineStart = src.lastIndexOf('\n', lineEnd - 1) + 1;
		const line = src.slice(lineStart, lineEnd).trimEnd();
		if (/^\s*\/\//.test(line)) {
			lines.unshift(line);
			lineEnd = lineStart - 1;
			if (lineEnd < 0) break;
		} else break;
	}
	return lines.join('\n').trim();
}

interface Column {
	tsName: string;
	dbName: string;
	type: string;
	notNull: boolean;
	defaultExpr: string | null;
	unique: boolean;
	primaryKey: boolean;
	references: string | null;
	onDelete: string | null;
}

function parseColumns(body: string): Column[] {
	const cols: Column[] = [];
	// Top-level commas only (depth zero). Track depth across () and {}.
	const fields = splitTopLevel(body, ',');
	for (const raw of fields) {
		const f = raw.trim();
		if (!f) continue;
		// Strip leading line comments.
		const cleaned = f.replace(/^(\s*\/\/.*\n)+/, '').trim();
		if (!cleaned) continue;
		const nameM = cleaned.match(/^(\w+)\s*:/);
		if (!nameM) continue;
		const tsName = nameM[1];
		const expr = cleaned.slice(nameM[0].length).trim();
		const dbNameM = expr.match(/^\w+\(\s*'([^']+)'/);
		const dbName = dbNameM ? dbNameM[1] : tsName;
		const typeM = expr.match(/^(\w+)\s*\(/);
		let type = typeM ? typeM[1] : 'unknown';
		if (/\.\$type<([^>]+)>\(\)/.test(expr)) {
			type += ` <${expr.match(/\.\$type<([^>]+)>/)![1]}>`;
		}
		const notNull = /\.notNull\(\)/.test(expr);
		const unique = /\.unique\(\)/.test(expr);
		const primaryKey = /\.primaryKey\(\)/.test(expr);
		const defaultM = expr.match(/\.default(?:Now|Random)?\(([^)]*)\)/);
		const defaultExpr = defaultM ? (defaultM[0].includes('defaultNow') ? 'now()' : defaultM[0].includes('defaultRandom') ? 'gen_random_uuid()' : defaultM[1].trim()) : null;
		const refM = expr.match(/\.references\(\s*\(\)[^=]*=>\s*([\w.]+)/);
		const odM = expr.match(/onDelete:\s*'([^']+)'/);
		cols.push({
			tsName,
			dbName,
			type,
			notNull,
			defaultExpr,
			unique,
			primaryKey,
			references: refM ? refM[1] : null,
			onDelete: odM ? odM[1] : null
		});
	}
	return cols;
}

function splitTopLevel(s: string, sep: string): string[] {
	const out: string[] = [];
	let depth = 0;      // bracket depth: {} () []
	let generic = 0;    // generic depth: TS Foo<A, B>
	let start = 0;
	let inStr: string | null = null;
	let inLineComment = false;
	let inBlockComment = false;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (inLineComment) {
			if (c === '\n') inLineComment = false;
			continue;
		}
		if (inBlockComment) {
			if (c === '*' && s[i + 1] === '/') { inBlockComment = false; i++; }
			continue;
		}
		if (inStr) {
			if (c === inStr && s[i - 1] !== '\\') inStr = null;
			continue;
		}
		if (c === '/' && s[i + 1] === '/') { inLineComment = true; i++; continue; }
		if (c === '/' && s[i + 1] === '*') { inBlockComment = true; i++; continue; }
		if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
		if (c === '{' || c === '(' || c === '[') depth++;
		else if (c === '}' || c === ')' || c === ']') depth--;
		else if (c === '<' && /[A-Za-z0-9_.]/.test(s[i - 1] ?? '')) generic++;
		else if (c === '>' && generic > 0 && s[i - 1] !== '=') generic--;
		else if (depth === 0 && generic === 0 && c === sep) {
			out.push(s.slice(start, i));
			start = i + 1;
		}
	}
	out.push(s.slice(start));
	return out;
}

function parseTableExpr(te: string): string[] {
	if (!te.trim()) return [];
	const items = splitTopLevel(te, ',').map((s) => s.trim()).filter(Boolean);
	const out: string[] = [];
	for (const it of items) {
		// e.g. index('entities_parent_idx').on(table.parentId)
		// or check('intervals_position_order', sql`...`)
		// or primaryKey({ columns: [...] })
		const kind = it.match(/^(\w+)\(/)?.[1] ?? '?';
		out.push(`\`${kind}\` ${oneLine(it)}`);
	}
	return out;
}

function oneLine(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

interface MigrationItem {
	kind: 'CREATE INDEX' | 'CREATE UNIQUE INDEX' | 'CREATE TRIGGER' | 'ADD CONSTRAINT' | 'DROP INDEX' | 'CREATE EXTENSION';
	table: string;
	name: string;
	body: string;
	migration: string;
}

function parseMigrations(): MigrationItem[] {
	const out: MigrationItem[] = [];
	const files = fs.readdirSync(MIGR_DIR).filter((f) => f.endsWith('.sql')).sort();
	for (const f of files) {
		const sql = fs.readFileSync(path.join(MIGR_DIR, f), 'utf8');
		const stmts = sql.split('--> statement-breakpoint');
		for (const raw of stmts) {
			const stmt = stripSqlComments(raw).trim();
			if (!stmt) continue;
			let m;
			if ((m = stmt.match(/^CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+"?(\w+)"?\s*\(([\s\S]+?)\)(?:\s*WHERE\s+([\s\S]+))?\s*$/i))) {
				const name = m[1];
				const table = m[2];
				const where = m[4] ? ` WHERE ${oneLine(m[4])}` : '';
				out.push({ kind: 'CREATE UNIQUE INDEX', table, name, body: `(${oneLine(m[3])})${where}`, migration: f });
			} else if ((m = stmt.match(/^CREATE\s+INDEX\s+"?(\w+)"?\s+ON\s+"?(\w+)"?[\s\S]*$/i))) {
				out.push({ kind: 'CREATE INDEX', table: m[2], name: m[1], body: oneLine(stmt), migration: f });
			} else if ((m = stmt.match(/^ALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+CONSTRAINT\s+"?(\w+)"?\s+([\s\S]+)$/i))) {
				out.push({ kind: 'ADD CONSTRAINT', table: m[1], name: m[2], body: oneLine(m[3]), migration: f });
			} else if ((m = stmt.match(/^DROP\s+INDEX(?:\s+IF\s+EXISTS)?\s+"?(\w+)"?/i))) {
				out.push({ kind: 'DROP INDEX', table: '', name: m[1], body: '', migration: f });
			} else if ((m = stmt.match(/^CREATE\s+TRIGGER\s+"?(\w+)"?[\s\S]+?ON\s+"?(\w+)"?/i))) {
				out.push({ kind: 'CREATE TRIGGER', table: m[2], name: m[1], body: oneLine(stmt), migration: f });
			} else if (/^CREATE\s+EXTENSION/i.test(stmt)) {
				const ext = stmt.match(/EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/i)?.[1] ?? '?';
				out.push({ kind: 'CREATE EXTENSION', table: '', name: ext, body: '', migration: f });
			}
		}
	}
	return out;
}

function stripSqlComments(s: string): string {
	// Strip leading SQL comment block from each migration chunk so the regex
	// matchers see only the actual statement.
	return s.replace(/(?:^|\n)\s*--[^\n]*/g, '\n').trim();
}

function fmtCol(c: Column): string {
	const flags: string[] = [];
	if (c.primaryKey) flags.push('PK');
	if (c.unique) flags.push('UNIQUE');
	if (c.notNull) flags.push('NOT NULL');
	if (c.defaultExpr) flags.push(`DEFAULT ${c.defaultExpr}`);
	let fk = '';
	if (c.references) {
		fk = ` → ${c.references}${c.onDelete ? ` (ON DELETE ${c.onDelete.toUpperCase()})` : ''}`;
	}
	return `| \`${c.dbName}\` | \`${c.type}\` | ${flags.join(', ') || '—'} | ${fk || '—'} |`;
}

function fmtTable(t: Table, mig: MigrationItem[]): string {
	const cols = parseColumns(t.body);
	const inlineConstraints = parseTableExpr(t.tableExpr);
	const tableMig = mig.filter((m) => m.table === t.dbName);
	const drops = mig.filter((m) => m.kind === 'DROP INDEX').map((m) => `- \`DROP INDEX ${m.name}\` (${m.migration})`);

	const lines: string[] = [];
	lines.push(`### \`${t.dbName}\` (ts: \`${t.tsName}\`)`);
	lines.push('');
	if (t.leadingComment) {
		lines.push('<details><summary>Inline comment from <code>schema.ts</code></summary>');
		lines.push('');
		lines.push('```');
		lines.push(t.leadingComment);
		lines.push('```');
		lines.push('');
		lines.push('</details>');
		lines.push('');
	}
	lines.push('| Column | Type | Modifiers | FK |');
	lines.push('|---|---|---|---|');
	for (const c of cols) lines.push(fmtCol(c));
	lines.push('');
	if (inlineConstraints.length) {
		lines.push('**Inline constraints / indexes (schema.ts):**');
		lines.push('');
		for (const ic of inlineConstraints) lines.push(`- ${ic}`);
		lines.push('');
	}
	if (tableMig.length) {
		lines.push('**Constraints / indexes from migrations:**');
		lines.push('');
		for (const m of tableMig) {
			lines.push(`- **${m.kind}** \`${m.name}\` (${m.migration})${m.body ? ` — ${m.body}` : ''}`);
		}
		lines.push('');
		// Drops affecting this table — match by name suffix heuristic.
		const tableDrops = drops.filter((d) => d.includes(t.dbName.replace(/s$/, '')) || mig.some((mm) => mm.kind === 'DROP INDEX' && mig.find((kk) => kk.name === mm.name && kk.table === t.dbName)));
		if (tableDrops.length) {
			lines.push('**Dropped:**');
			lines.push('');
			for (const d of tableDrops) lines.push(d);
			lines.push('');
		}
	}
	return lines.join('\n');
}

function main() {
	const src = fs.readFileSync(SCHEMA, 'utf8');
	const tables = parseSchema(src);
	const migrations = parseMigrations();
	const exts = migrations.filter((m) => m.kind === 'CREATE EXTENSION');
	const drops = migrations.filter((m) => m.kind === 'DROP INDEX');

	const header = [
		'# Schema',
		'',
		'_Generated from `src/lib/server/db/schema.ts` and `drizzle/*.sql`._',
		'_Regenerate: `npm run docs:schema`. Do not edit by hand — changes will be overwritten._',
		'',
		'See [architecture.md](architecture.md) for design context.',
		''
	].join('\n');

	const ext = exts.length
		? ['## Postgres extensions', '', ...exts.map((e) => `- \`${e.name}\` (${e.migration})`), ''].join('\n')
		: '';

	const dropped = drops.length
		? ['## Dropped indexes', '', ...drops.map((d) => `- \`${d.name}\` (${d.migration})`), ''].join('\n')
		: '';

	const body = tables.map((t) => fmtTable(t, migrations)).join('\n');

	const out = [header, '## Tables', '', body, ext, dropped].filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
	const result = writeIfChanged(OUT, out);
	console.log(`[docs:schema] ${result} ${path.relative(ROOT, OUT)}`);
}

main();
