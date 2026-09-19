import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { writable } from 'svelte/store';

vi.mock('$lib/stores/entities.js', () => ({ entities: writable([{ id: 'mara', name: 'Mara', type: 'Character', data: { body: '# Departure', synopsis: '# Literal **text** [[Mara]]' } }]) }));
vi.mock('$lib/navigation.js', () => ({ openEntity: vi.fn() }));
import { openEntity } from '$lib/navigation.js';
import EditableField from '../../src/lib/components/EditableField.svelte';
import WikiLinkText from '../../src/lib/components/WikiLinkText.svelte';
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('renders formatting, nested lists and entity links while leaving code literal', async () => {
	const view = render(WikiLinkText, { renderMarkdown: true, body: '# Departure\n\n**[[Mara]]** &amp; *company*\n\n- First\n  - Second\n\n> A quote\n\n`[[Mara]]`\n\n```txt\n<script>example</script>\n```' });
	expect(view.getByRole('heading', { name: 'Departure', level: 2 })).toBeInTheDocument();
	expect(view.container.querySelector('strong button')).toHaveTextContent('Mara');
	expect(view.container.querySelector('em')).toHaveTextContent('company');
	expect(view.container.querySelector('ul ul')).toHaveTextContent('Second');
	expect(view.container.querySelector('blockquote')).toHaveTextContent('A quote');
	expect(view.container.querySelector('pre code')).toHaveTextContent('<script>example</script>');
	expect(view.container.textContent).toContain('& company');
	expect(view.container.querySelector('code')).toHaveTextContent('[[Mara]]');
	await fireEvent.click(view.getByRole('button', { name: 'Mara' }));
	expect(openEntity).toHaveBeenCalledWith('mara');
});

it('keeps raw HTML inert and rejects unsafe and encoded link destinations', () => {
	const view = render(WikiLinkText, { renderMarkdown: true, body: '<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1)) [encoded](javascript&#58;alert(1)) [data](data:text/html,test) [relative](/auth/login)\n\n[safe](https://example.com/?a=1&amp;b=2) ![picture](https://example.com/picture.png)' });
	expect(view.container.querySelector('img, script, iframe')).toBeNull();
	expect(view.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
	expect(view.getAllByRole('link')).toHaveLength(2);
	expect(view.getByRole('link', { name: 'safe' })).toHaveAttribute('href', 'https://example.com/?a=1&b=2');
	expect(view.getByRole('link', { name: 'safe' })).toHaveAttribute('rel', 'noopener noreferrer');
	expect(view.getByRole('link', { name: 'picture' })).toHaveAttribute('href', 'https://example.com/picture.png');
});

it('renders tables and tasks without nesting entity buttons inside links', () => {
	const view = render(WikiLinkText, { renderMarkdown: true, body: '| Who | Where |\n| --- | --- |\n| [[Mara]] | Home |\n\n- [x] Finished\n- [ ] Later\n\n[[Unknown]] [**[[Mara]]**](https://example.com)' });
	expect(view.getAllByRole('cell').map(cell => cell.textContent?.trim())).toEqual(['Mara', 'Home']);
	expect(view.getByRole('checkbox', { name: 'Completed task' })).toBeChecked();
	expect(view.getByRole('checkbox', { name: 'Incomplete task' })).toBeDisabled();
	expect(view.getByTitle("No entity named 'Unknown'")).toHaveTextContent('[[Unknown]]');
	expect(view.getByRole('link').querySelector('button')).toBeNull();
	expect(view.getByRole('link')).toHaveTextContent('[[Mara]]');
});

it('preserves semicolon-less entities in prose, link destinations and titles', () => {
	const view = render(WikiLinkText, { renderMarkdown: true, body: '&not &amp; &#65; [query](https://example.com/?x=1&not=2 "&not &amp;")' });
	expect(view.container.textContent).toContain('&not & A');
	expect(view.getByRole('link')).toHaveAttribute('href', 'https://example.com/?x=1&not=2');
	expect(view.getByRole('link')).toHaveAttribute('title', '&not &');
});

it('formats body fields while preserving structured textarea text and mentions', () => {
	const body = render(EditableField, { entityId: 'mara', field: 'body', kind: 'textarea', readOnly: true });
	expect(body.getByRole('heading', { name: 'Departure' })).toBeInTheDocument();
	body.unmount();
	const synopsis = render(EditableField, { entityId: 'mara', field: 'synopsis', kind: 'textarea', readOnly: true });
	expect(synopsis.queryByRole('heading')).toBeNull();
	expect(synopsis.container.textContent).toContain('# Literal **text**');
	expect(synopsis.getByRole('button', { name: 'Mara' })).toBeInTheDocument();
});
