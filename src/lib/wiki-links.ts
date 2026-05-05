/**
 * Wiki-link parser. Splits a body string at `[[Name]]` markers and
 * resolves each marker against the supplied entity pool by name match
 * (case-insensitive). Pure — no Svelte / store dependencies — so it
 * lives outside `components/` and can be unit-tested directly.
 *
 * Resolution rules (Phase 1 wiki-rework slice 3):
 *   - Match is whole-string-equal on the trimmed name, lower-cased.
 *   - Duplicate names: last entity in the pool wins. The design specs
 *     defer ambiguity disambiguation (e.g. `[[Aragorn (Character)]]`)
 *     to a later slice; this parser resolves the simple case only.
 *   - Unknown names render as a segment with `entity: null`; the
 *     viewer renders those as strikethrough fallback text per spec.
 *   - Markers with newlines inside them (`[[bad\ntext]]`) do NOT match;
 *     the regex is intentionally non-greedy and excludes \n / \].
 */

export type WikiLinkSegment =
	| { kind: 'text'; text: string }
	| {
			kind: 'link';
			/** The literal `[[Name]]` substring including brackets. */
			raw: string;
			/** Trimmed name as written between the brackets. */
			name: string;
			/** Resolved entity, or null if no match in the pool. */
			entity: WikiLinkEntity | null;
	  };

export interface WikiLinkEntity {
	id: string;
	name: string;
	type: string;
}

const LINK_RE = /\[\[([^\]\n]+?)\]\]/g;

export function parseWikiLinks(
	body: string,
	entities: readonly WikiLinkEntity[]
): WikiLinkSegment[] {
	if (!body) return [];

	const byName = new Map<string, WikiLinkEntity>();
	for (const e of entities) {
		byName.set(e.name.toLowerCase(), e);
	}

	const out: WikiLinkSegment[] = [];
	let lastIndex = 0;
	for (const m of body.matchAll(LINK_RE)) {
		const start = m.index ?? 0;
		if (start > lastIndex) {
			out.push({ kind: 'text', text: body.slice(lastIndex, start) });
		}
		const raw = m[0];
		const name = m[1].trim();
		const found = byName.get(name.toLowerCase()) ?? null;
		out.push({ kind: 'link', raw, name, entity: found });
		lastIndex = start + raw.length;
	}
	if (lastIndex < body.length) {
		out.push({ kind: 'text', text: body.slice(lastIndex) });
	}
	return out;
}
