import { it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import InlineEdit from '$lib/components/InlineEdit.svelte';

it('commits a trimmed rename with Enter and discards a cancelled edit', async () => {
  const onSave = vi.fn();
  const ui = render(InlineEdit, { value: 'Opening', onSave });
  await fireEvent.click(ui.getByRole('button', { name: 'Rename' }));
  await fireEvent.input(ui.getByRole('textbox'), { target: { value: '  Departure  ' } });
  await fireEvent.keyDown(ui.getByRole('textbox'), { key: 'Enter' });
  expect(onSave).toHaveBeenCalledExactlyOnceWith('Departure');
  await ui.rerender({ value: 'Departure', onSave });
  await fireEvent.click(ui.getByRole('button', { name: 'Rename' }));
  await fireEvent.input(ui.getByRole('textbox'), { target: { value: 'Discard this' } });
  await fireEvent.keyDown(ui.getByRole('textbox'), { key: 'Escape' });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(ui.getByText('Departure')).toBeInTheDocument();
});
