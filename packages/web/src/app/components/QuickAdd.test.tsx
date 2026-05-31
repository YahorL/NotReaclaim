import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickAdd } from './QuickAdd';

describe('QuickAdd', () => {
  it('calls onAdd with the trimmed title on Enter and clears', () => {
    const onAdd = vi.fn();
    render(<QuickAdd placeholder="+ Add a task…" onAdd={onAdd} />);
    const input = screen.getByPlaceholderText('+ Add a task…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Write spec  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledWith('Write spec');
    expect(input.value).toBe('');
  });

  it('calls onAdd on button click and ignores empty input', () => {
    const onAdd = vi.fn();
    render(<QuickAdd placeholder="+ Add…" onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('+ Add…'), { target: { value: 'Run' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).toHaveBeenCalledWith('Run');
  });
});
