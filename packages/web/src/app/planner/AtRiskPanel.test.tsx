import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UnscheduledItem } from '../../api/types';
import { AtRiskPanel } from './AtRiskPanel';

const item = (over: Partial<UnscheduledItem> = {}): UnscheduledItem => ({
  sourceType: 'task', sourceId: 't1', title: 'Tax filing', reason: 'no free time before due', remainingMs: 90 * 60000, ...over,
});

describe('AtRiskPanel', () => {
  it('lists unscheduled items with reason and remaining time', () => {
    render(<AtRiskPanel items={[item(), item({ sourceId: 't2', title: 'Read paper', remainingMs: 2 * 3600000 })]} />);
    const rows = screen.getAllByTestId('at-risk-item');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Tax filing');
    expect(rows[0]).toHaveTextContent('no free time before due');
    expect(rows[0]).toHaveTextContent('1h 30m unplaced');
    expect(rows[1]).toHaveTextContent('Read paper');
    expect(rows[1]).toHaveTextContent('2h unplaced');
  });

  it('shows an empty state when nothing is at risk', () => {
    render(<AtRiskPanel items={[]} />);
    expect(screen.getByText('Nothing at risk.')).toBeInTheDocument();
    expect(screen.queryByTestId('at-risk-item')).toBeNull();
  });
});
