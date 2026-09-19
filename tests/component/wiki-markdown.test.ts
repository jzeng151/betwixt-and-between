import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { writable } from 'svelte/store';

vi.mock('$lib/stores/entities.js', () => ({ entities: writable([{ id: 'mara', name: 'Mara', type: 'Character' }]) }));
vi.mock('$lib/navigation.js', () => ({ openEntity: vi.fn() }));
import { openEntity } from '$lib/navigation.js';
import WikiLinkText from '../../src/lib/components/WikiLinkText.svelte';
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('renders formatting, nested lists and entity links while leaving code literal', async () => {
	const view = render(WikiLinkText, { body: '# Departure\n\n**[[Mara]]** &amp; *company*\n\n- First\n  - Second\n\n> A quote\n\n`[[Mara]]`\n\n```txt\n<script>example</script>\n```' });
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
	const view = render(WikiLinkText, { body: '<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1)) [encoded](javascript&#58;alert(1)) [data](data:text/html,test) [relative](/auth/login)\n\n[safe](https://example.com/?a=1&amp;b=2) ![picture](https://example.com/picture.png)' });
	expect(view.container.querySelector('img, script, iframe')).toBeNull();
	expect(view.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
	expect(view.getAllByRole('link')).toHaveLength(2);
	expect(view.getByRole('link', { name: 'safe' })).toHaveAttribute('href', 'https://example.com/?a=1&b=2');
	expect(view.getByRole('link', { name: 'safe' })).toHaveAttribute('rel', 'noopener noreferrer');
	expect(view.getByRole('link', { name: 'picture' })).toHaveAttribute('href', 'https://example.com/picture.png');
});

it('renders tables and tasks without nesting entity buttons inside links', () => {
	const view = render(WikiLinkText, { body: '| Who | Where |\n| --- | --- |\n| [[Mara]] | Home |\n\n- [x] Finished\n- [ ] Later\n\n[[Unknown]] [**[[Mara]]**](https://example.com)' });
	expect(view.getAllByRole('cell').map(cell => cell.textContent?.trim())).toEqual(['Mara', 'Home']);
	expect(view.getByRole('checkbox', { name: 'Completed task' })).toBeChecked();
	expect(view.getByRole('checkbox', { name: 'Incomplete task' })).toBeDisabled();
	expect(view.getByTitle("No entity named 'Unknown'")).toHaveTextContent('[[Unknown]]');
	expect(view.getByRole('link').querySelector('button')).toBeNull();
	expect(view.getByRole('link')).toHaveTextContent('[[Mara]]');
});
