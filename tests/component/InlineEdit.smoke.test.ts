import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import InlineEdit from '$lib/components/InlineEdit.svelte';

describe('component test infra smoke test', () => {
	it('mounts InlineEdit and renders its value text', () => {
		const { getByText } = render(InlineEdit, {
			props: { value: 'hello', onSave: () => {} }
		});
		expect(getByText('hello')).toBeInTheDocument();
	});
});
