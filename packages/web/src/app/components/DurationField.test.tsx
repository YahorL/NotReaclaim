import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DurationField } from './DurationField';

describe('DurationField', () => {
  it('shows hours/minutes from a ms value', () => {
    render(<DurationField valueMs={5_400_000} onChange={vi.fn()} testid="dur" />);
    expect((screen.getByTestId('dur-h') as HTMLInputElement).value).toBe('1');
    expect((screen.getByTestId('dur-m') as HTMLInputElement).value).toBe('30');
  });

  it('emits ms when hours change', () => {
    const onChange = vi.fn();
    render(<DurationField valueMs={5_400_000} onChange={onChange} testid="dur" />);
    fireEvent.change(screen.getByTestId('dur-h'), { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith(9_000_000); // 2h30m
  });

  it('emits ms when minutes change', () => {
    const onChange = vi.fn();
    render(<DurationField valueMs={3_600_000} onChange={onChange} testid="dur" />);
    fireEvent.change(screen.getByTestId('dur-m'), { target: { value: '15' } });
    expect(onChange).toHaveBeenCalledWith(4_500_000); // 1h15m
  });
});
