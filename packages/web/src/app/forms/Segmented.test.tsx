import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Segmented } from './Segmented';

const OPTS = [{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }, { key: 'c', label: 'Gamma' }] as const;

function Harness({ kind, onChange = () => {} }: { kind: 'tablist' | 'radiogroup'; onChange?: (k: string) => void }) {
  const [v, setV] = useState<'a' | 'b' | 'c'>('a');
  return <Segmented kind={kind} label="Pick" idBase="seg" options={[...OPTS]} value={v} onChange={(k) => { setV(k); onChange(k); }} />;
}

describe('Segmented', () => {
  it('as a tablist: tabs with aria-selected, ids and aria-controls', () => {
    render(<Harness kind="tablist" />);
    expect(screen.getByRole('tablist', { name: 'Pick' })).toBeInTheDocument();
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    expect(alpha).toHaveAttribute('aria-selected', 'true');
    expect(alpha).toHaveAttribute('aria-controls', 'seg-panel-a');
    expect(alpha.id).toBe('seg-tab-a');
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'false');
  });

  it('only the selected tab points aria-controls at a panel (the others\' panels are not rendered)', () => {
    render(<Harness kind="tablist" />);
    expect(screen.getByRole('tab', { name: 'Beta' })).not.toHaveAttribute('aria-controls');
    fireEvent.click(screen.getByRole('tab', { name: 'Beta' }));
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-controls', 'seg-panel-b');
    expect(screen.getByRole('tab', { name: 'Alpha' })).not.toHaveAttribute('aria-controls');
  });

  it('as a radiogroup: radios with aria-checked', () => {
    render(<Harness kind="radiogroup" />);
    expect(screen.getByRole('radiogroup', { name: 'Pick' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Gamma' }));
    expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'false');
  });

  it('roves: only the selected option is tabbable; arrows/Home/End move selection and focus, wrapping', () => {
    const onChange = vi.fn();
    render(<Harness kind="radiogroup" onChange={onChange} />);
    const alpha = screen.getByRole('radio', { name: 'Alpha' });
    expect(alpha).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('tabindex', '-1');
    alpha.focus();
    fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('b');
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Beta' }), { key: 'End' });
    expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Gamma' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Alpha' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Gamma' }), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });
});
