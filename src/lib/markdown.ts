import { Marked } from 'marked';
import { decodeHTML } from 'entities';

export const markdown = new Marked({
	gfm: true,
	breaks: true,
	extensions: [{
		name: 'wikilink',
		level: 'inline',
		start: (source) => source.indexOf('[['),
		tokenizer(source) {
			const match = /^\[\[([^\]\n]+?)\]\]/.exec(source);
			if (match) return { type: 'wikilink', raw: match[0], text: match[1].trim() };
		}
	}]
});

export function markdownHref(raw: string, autolink = false): string | undefined {
	const href = autolink ? raw : decodeHTML(raw);
	try {
		const url = new URL(href);
		if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return url.href;
	} catch { /* Relative and malformed destinations stay plain text. */ }
	return undefined;
}
