/** Wiki links resolve only against the supplied story's entities.
 * Name matches ignore case; the last duplicate wins. ID links disambiguate
 * and display the current name unless an explicit label is supplied.
 */

export type WikiLinkSegment =
	| { kind: 'text'; text: string }
	| {
			kind: 'link';
			/** The literal `[[Name]]` substring including brackets. */
			raw: string;
			/** Display label, or the current entity name for an ID link. */
			name: string;
			target: string;
			/** Resolved entity, or null if no match in the pool. */
			entity: WikiLinkEntity | null;
	  };

export interface WikiLinkEntity {
	id: string;
	name: string;
	type: string;
}

const LINK_RE = /\[\[([^\]\r\n]+?)\]\]/g;

/** Index the supplied story's entities once for a whole document. */
export function createWikiLinkResolver(entities: readonly WikiLinkEntity[]) {
	const byName = new Map(entities.map((e) => [e.name.toLowerCase(), e]));
	const byId = new Map(entities.map((e) => [e.id, e]));
	return (raw: string): Extract<WikiLinkSegment, { kind: 'link' }> => {
		const contents = raw.slice(2, -2).replace(/\\\|/g, '|');
		const fullName = contents.trim();
		// Preserve existing links to names containing pipes. IDs keep explicit targeting.
		const separator = !fullName.startsWith('#') && byName.has(fullName.toLowerCase())
			? -1
			: contents.indexOf('|');
		const target = (separator < 0 ? contents : contents.slice(0, separator)).trim();
		const label = separator < 0 ? '' : contents.slice(separator + 1).trim();
		const isId = target.startsWith('#');
		const entity = (isId ? byId.get(target.slice(1)) : byName.get(target.toLowerCase())) ?? null;
		return { kind: 'link', raw, target, name: label || (isId ? entity?.name : target) || target, entity };
	};
}

export function parseWikiLinks(
	body: string,
	entities: readonly WikiLinkEntity[]
): WikiLinkSegment[] {
	if (!body) return [];

	const resolve = createWikiLinkResolver(entities);

	const out: WikiLinkSegment[] = [];
	let lastIndex = 0;
	for (const m of body.matchAll(LINK_RE)) {
		const start = m.index ?? 0;
		if (start > lastIndex) {
			out.push({ kind: 'text', text: body.slice(lastIndex, start) });
		}
		out.push(resolve(m[0]));
		lastIndex = start + m[0].length;
	}
	if (lastIndex < body.length) {
		out.push({ kind: 'text', text: body.slice(lastIndex) });
	}
	return out;
}
